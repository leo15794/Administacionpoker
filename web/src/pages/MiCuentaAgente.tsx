import { useState } from "react";
import { usdCents, dateShort } from "../fmt";
import CalculadoraCierre from "../components/CalculadoraCierre";
import { PortalTop, PortalHero, PortalMini, PortalTabs, PortalCols, PortalPane, MovRow, colorSigno, montoSigno } from "../components/PortalUI";

// "Mi cuenta" de un agente que tiene su cuenta en la sección Agentes (20/10/2026, pedido de Leo: que el usuario vea lo
// mismo que se ve en Agentes, y que cada cierre se pueda abrir con su desglose como en TeamBack Afiliados). Muestra el
// saldo de la cuenta, los cierres semanales (por club y por jugador) y los movimientos de la cuenta. Solo lectura.
type Tab = "clubes" | "cierres" | "movimientos" | "calculadora";

const ESTADO_SEMANA: Record<string, { texto: string; clase: string }> = {
  APLICADO: { texto: "Aplicada a tu cuenta", clase: "pill g" },
  INCLUIDO: { texto: "Incluida en tu saldo inicial", clase: "pill" },
  ANTERIOR: { texto: "Anterior a tu cuenta", clase: "pill" },
  PENDIENTE: { texto: "Todavía no aplicada a tu cuenta", clase: "pill" },
};

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

// Cómo se ve cada movimiento desde el lado del agente (qué recibe, qué se le descuenta).
function movimientoParaAgente(m: any): { titulo: string; monto: number } {
  switch (m.type) {
    case "PAGO": return { titulo: "Te pagamos (USDT)", monto: Math.abs(Number(m.amount)) };
    case "COBRO": return { titulo: "Te cobramos (USDT)", monto: -Math.abs(Number(m.amount)) };
    case "CARGA": return { titulo: "Carga de fichas", monto: Math.abs(Number(m.amount)) };
    case "DESCARGA": return { titulo: "Descarga de fichas", monto: -Math.abs(Number(m.amount)) };
    case "DESCUENTO": return { titulo: `Descuento${m.concepto ? ` · ${m.concepto}` : ""}`, monto: -Math.abs(Number(m.amount)) };
    default: return { titulo: "Ajuste", monto: Number(m.amount) };
  }
}

export default function MiCuentaAgente({
  data,
  misAgentes,
  agentId,
  setAgentId,
}: {
  data: any;
  misAgentes: any[];
  agentId: string;
  setAgentId: (id: string) => void;
}) {
  const cta = data.cuenta;
  const winLose = cta.sistema === "WIN_LOSE";
  const cc = Number(cta.cuenta_corriente);
  const fichas = Number(cta.fichas_reales);
  const semanas: any[] = cta.semanas ?? [];
  const movs: any[] = cta.movimientos ?? [];
  const porClub: any[] = cta.por_club ?? [];
  const [tab, setTab] = useState<Tab>("cierres");
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set(semanas[0] ? [semanas[0].week_start] : []));

  const toggle = (ws: string) =>
    setAbiertas((prev) => {
      const n = new Set(prev);
      if (n.has(ws)) n.delete(ws);
      else n.add(ws);
      return n;
    });

  const total = winLose ? cc : fichas + cc;
  const etiqueta = winLose
    ? cc < -0.004 ? "Nos debés" : cc > 0.004 ? "Te debemos" : "Estás al día"
    : "Tu saldo total";
  const ultimas = semanas.slice(0, 4);
  const mostrarClubes = !winLose && porClub.length > 0;
  const tabActual: Tab = !mostrarClubes && tab === "clubes" ? "cierres" : tab;
  const tabs = [
    ...(mostrarClubes ? [{ key: "clubes" as Tab, label: "Fichas por club", count: porClub.length }] : []),
    { key: "cierres" as Tab, label: "Cierres", count: semanas.length },
    { key: "movimientos" as Tab, label: "Movimientos", count: movs.length },
    { key: "calculadora" as Tab, label: "Calculadora" },
  ];

  const minis = [
    ...(semanas[0]
      ? [<PortalMini key="u" label="Último cierre" value={montoSigno(Number(semanas[0].total))} sub={`${dateShort(semanas[0].week_start).slice(0, 5)} al ${dateShort(semanas[0].week_end).slice(0, 5)}`} color={colorSigno(Number(semanas[0].total))} />]
      : []),
    ...(ultimas.length > 1
      ? [<PortalMini key="s" label={`Últimos ${ultimas.length} cierres`} value={montoSigno(ultimas.reduce((s, x) => s + Number(x.total), 0))} sub={`suma de las ${ultimas.length} semanas`} />]
      : []),
    ...(!winLose ? [<PortalMini key="f" label="Fichas reales" value={montoSigno(fichas)} sub="en tus clubes" />, <PortalMini key="c" label="Cuenta corriente" value={montoSigno(cc)} sub="rakeback" />] : []),
    ...(data.garantia ? [<PortalMini key="g" label="Garantía vigente" value={usdCents(data.garantia.amount)} />] : []),
  ];

  const clubesPane = mostrarClubes && (
    <PortalPane activa={tabActual === "clubes"} titulo="Mis fichas por club">
      {porClub.map((c: any) => (
        <div key={c.club} className={`pt-card${Number(c.fichas) < 0 ? " ng" : ""}`}>
          <div className="b">
            <div className="t1">
              <span className="n">{c.club}</span>
              <span className="amt" style={{ color: colorSigno(Number(c.fichas)) }}>{montoSigno(Number(c.fichas))}</span>
            </div>
            <div className="t2">
              <span>Cargas y descargas {montoSigno(Number(c.balance))}</span>
              <span>Mesas {montoSigno(Number(c.mesas))}</span>
            </div>
          </div>
        </div>
      ))}
    </PortalPane>
  );

  const cierresPane = (
    <PortalPane activa={tabActual === "cierres"} titulo="Mis cierres semanales">
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        {winLose
          ? "Cada semana, el cierre completo se suma a tu cuenta corriente. Tocá una semana para ver el desglose por club y por jugador."
          : "Cada semana, tus fichas ganadas se suman a Fichas reales y tu rakeback a Cuenta corriente. Tocá una semana para ver el desglose por club y por jugador."}
      </div>
      {semanas.length === 0 ? (
        <div className="muted">Todavía no hay cierres semanales cargados.</div>
      ) : (
        semanas.map((s: any) => {
          const abierta = abiertas.has(s.week_start);
          const estado = ESTADO_SEMANA[s.estado] ?? ESTADO_SEMANA.PENDIENTE;
          const descuentos = movs.filter((m) => m.type === "DESCUENTO" && m.semana === s.week_start);
          return (
            <div key={s.week_start} className={`pt-card${Number(s.total) < 0 ? " ng" : ""}`} style={{ cursor: "pointer" }} onClick={() => toggle(s.week_start)}>
              <div className="b">
                <div className="t1">
                  <span className="n"><span style={{ color: "var(--text-faint)", marginRight: 6 }}>{abierta ? "▾" : "▸"}</span>{dateShort(s.week_start).slice(0, 5)} al {dateShort(s.week_end).slice(0, 5)}</span>
                  <span className="amt" style={{ color: colorSigno(Number(s.total)) }}>{montoSigno(Number(s.total))}</span>
                </div>
                <div className="t2">
                  <span className={estado.clase} style={{ fontSize: 10.5 }}>{estado.texto}</span>
                  <span>Resultado {montoSigno(Number(s.resultado))} · Rakeback {usdCents(Number(s.rakeback))}</span>
                </div>
                {abierta && (
                  <div onClick={(e) => e.stopPropagation()} style={{ cursor: "default" }}>
                    {s.clubes.map((c: any) => (
                      <div key={c.club} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ fontWeight: 650 }}>{c.club}</div>
                          <b style={{ color: colorSigno(Number(c.total)) }}>{montoSigno(Number(c.total))}</b>
                        </div>
                        <div className="saldo-sub" style={{ margin: "2px 0 8px" }}>{(c.jugadores ?? c.jugadores_detalle.length)} {(c.jugadores ?? c.jugadores_detalle.length) === 1 ? "jugador" : "jugadores"}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", fontSize: 12.5 }}>
                          <div><div className="saldo-sub" style={{ margin: 0 }}>Resultado de mesas</div><b style={{ color: colorSigno(Number(c.resultado)) }}>{montoSigno(Number(c.resultado))}</b></div>
                          <div><div className="saldo-sub" style={{ margin: 0 }}>Rake generado</div><b>{usdCents(Number(c.rake))}</b></div>
                          <div><div className="saldo-sub" style={{ margin: 0 }}>Rakeback ({pct(Number(c.rakeback_pct))})</div><b>{usdCents(Number(c.rakeback))}</b></div>
                          {Math.abs(Number(c.rebate)) > 0.004 && (
                            <div><div className="saldo-sub" style={{ margin: 0 }}>Rebate</div><b style={{ color: colorSigno(Number(c.rebate)) }}>{montoSigno(Number(c.rebate))}</b></div>
                          )}
                          {Math.abs(Number(c.rodeo)) > 0.004 && (
                            <div><div className="saldo-sub" style={{ margin: 0 }}>Rodeo</div><b style={{ color: colorSigno(Number(c.rodeo)) }}>{montoSigno(Number(c.rodeo))}</b></div>
                          )}
                        </div>
                        {c.jugadores_detalle.length > 0 && (
                          <div style={{ marginTop: 12 }}>
                            <div className="saldo-sub" style={{ margin: "0 0 4px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", fontSize: 11 }}>
                              Desglose por jugador
                            </div>
                            {c.jugadores_detalle.map((j: any) => (
                              <div key={j.id ?? j.nombre} style={{ padding: "8px 0", borderTop: "1px dashed var(--border)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                  <span style={{ fontWeight: 600 }}>{j.nombre}{j.id ? <span className="muted" style={{ fontWeight: 400, fontSize: 11.5 }}> · {j.id}</span> : null}</span>
                                  <b style={{ color: colorSigno(Number(j.cierre)) }}>{montoSigno(Number(j.cierre))}</b>
                                </div>
                                <div className="saldo-sub" style={{ margin: "2px 0 0", display: "flex", gap: 12, flexWrap: "wrap" }}>
                                  <span>Resultado {montoSigno(Number(j.resultado))}</span>
                                  <span>Rake {usdCents(Number(j.rake))}</span>
                                  <span>Rakeback {usdCents(Number(j.rakeback))} ({pct(Number(j.rakeback_pct))})</span>
                                  {Math.abs(Number(j.rebate)) > 0.004 && <span>Rebate {montoSigno(Number(j.rebate))}</span>}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {descuentos.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                        <div className="saldo-sub" style={{ margin: "0 0 4px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", fontSize: 11 }}>Descuentos de la semana</div>
                        {descuentos.map((d: any) => (
                          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "3px 0" }}>
                            <span>{d.concepto ?? "Descuento"}{d.notes ? ` · ${d.notes}` : ""}</span>
                            <b style={{ color: "var(--red)" }}>{montoSigno(-Math.abs(Number(d.amount)))}</b>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="saldo-sub" style={{ marginTop: 10 }}>
                      {winLose ? (
                        <>El cierre completo se suma a tu cuenta corriente: <b style={{ color: colorSigno(Number(s.total)) }}>{montoSigno(Number(s.total))}</b></>
                      ) : (
                        <>Fichas reales <b>{montoSigno(Number(s.resultado))}</b> · cuenta corriente <b>{usdCents(Number(s.rakeback))}</b></>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}
    </PortalPane>
  );

  const movimientosPane = (
    <PortalPane activa={tabActual === "movimientos"} titulo="Movimientos de mi cuenta">
      {movs.length === 0 ? (
        <div className="muted">Todavía no hay movimientos en tu cuenta.</div>
      ) : (
        <div className="mov-list">
          {movs.map((m: any) => {
            const v = movimientoParaAgente(m);
            const efecto = [
              Math.abs(Number(m.fichas_reales_delta)) > 0.004 ? `fichas ${montoSigno(Number(m.fichas_reales_delta))}` : "",
              Math.abs(Number(m.cuenta_corriente_delta)) > 0.004 ? `cuenta corriente ${montoSigno(Number(m.cuenta_corriente_delta))}` : "",
            ].filter(Boolean).join(" · ");
            return (
              <MovRow
                key={m.id}
                type={m.type}
                titulo={v.titulo}
                detalle={`${m.club_name ?? "Cuenta"} · ${dateShort(m.occurred_at)}`}
                detalle2={efecto || undefined}
                monto={v.monto}
                obs={[m.notes, m.payment_link ? `Link de pago: ${m.payment_link}` : ""].filter(Boolean).join(" · ") || null}
              />
            );
          })}
        </div>
      )}
    </PortalPane>
  );

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <h2>Hola, {data.agente.name}</h2>
          <div className="muted">Sistema: {winLose ? "Win/Lose" : "Prepago"}</div>
        </div>
        {misAgentes.length > 1 && (
          <div className="field" style={{ margin: 0 }}>
            <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Ver cuenta de</label>
            <select value={agentId || data.agente.id} onChange={(e) => setAgentId(e.target.value)}>
              {misAgentes.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <PortalTop
        hero={
          <PortalHero
            label={etiqueta}
            amount={montoSigno(total)}
            color={winLose ? colorSigno(cc) : colorSigno(total)}
            foot={
              winLose ? (
                <>
                  <span>Cuenta corriente · se salda con pagos y cobros en USDT</span>
                  <span>Win/Lose</span>
                </>
              ) : (
                <>
                  <span>Fichas reales {montoSigno(fichas)} · Cuenta corriente {montoSigno(cc)}</span>
                  <span>Prepago</span>
                </>
              )
            }
          />
        }
        minis={minis}
      />

      <PortalTabs tabs={tabs} value={tabActual} onChange={setTab} />

      <PortalCols
        left={
          <>
            {clubesPane}
            {cierresPane}
            <CalculadoraCierre activa={tabActual === "calculadora"} sistemaInicial={winLose ? "WIN_LOSE" : "PREPAGO"} perspectiva="agente" />
          </>
        }
        right={movimientosPane}
      />
    </div>
  );
}
