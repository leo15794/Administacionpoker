import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";
import { PortalTop, PortalHero, PortalMini, PortalTabs, PortalPane, montoSigno } from "../components/PortalUI";

type Tab = "cierres" | "jugadores" | "movimientos";

// Portal del rol SOCIO (27/10/2026, pedido de Leo: "crearle cuenta a los socios y que vean su desglose, sus cierres y sus jugadores"). Solo lectura:
// el socio ve TODO lo de su cuenta (saldo, movimientos, cierres de los agentes que se rutean a ella y el detalle por jugador). Ver GET /portal/mi-socio.
// Convención de la cuenta (igual que Cuentas de socios): saldo POSITIVO = le debe a la empresa, NEGATIVO = a favor del socio.
const estadoSaldo = (n: number) => (n > 0.004 ? "le debés a la empresa" : n < -0.004 ? "a tu favor" : "en cero");
const colorDeuda = (n: number) => (n > 0.004 ? "var(--red)" : n < -0.004 ? "var(--green)" : "var(--text-dim)");
const colorCierre = (n: number) => (n < -0.004 ? "var(--red)" : n > 0.004 ? "var(--green)" : "var(--text-dim)");
const ARS = (n: number) => `${n > 0 ? "+ " : n < 0 ? "− " : ""}${usdCents(Math.abs(n))}`;

export default function MiSocio() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("cierres");
  const [semanasAbiertas, setSemanasAbiertas] = useState<Set<string>>(new Set());
  const [agentesAbiertos, setAgentesAbiertos] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.miSocio().then((d: any) => {
      setData(d);
      if (d.semanas?.[0]) setSemanasAbiertas(new Set([d.semanas[0].weekStart]));
    }).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <Loading />;

  const cuenta = data.cuenta;
  const semanas: any[] = data.semanas ?? [];
  const movimientos: any[] = data.movimientos ?? [];
  const ultima = semanas[0];
  const cantAgentes = new Set(semanas.flatMap((s) => s.agentes.map((a: any) => a.agente))).size;

  // Jugadores: se juntan los de todos los cierres (un jugador puede repetirse en varias semanas).
  const jugadoresMap = new Map<string, { id: string; nombre: string; agente: string; club: string; semanas: number; resultado: number; rake: number; rakeback: number }>();
  for (const s of semanas) {
    for (const a of s.agentes) {
      for (const j of a.jugadores) {
        const k = `${a.agente}|${a.club}|${j.id}`;
        const prev = jugadoresMap.get(k) ?? { id: j.id, nombre: j.nombre, agente: a.agente, club: a.club, semanas: 0, resultado: 0, rake: 0, rakeback: 0 };
        prev.semanas += 1;
        prev.resultado += j.resultado;
        prev.rake += j.rake;
        prev.rakeback += j.rakeback;
        jugadoresMap.set(k, prev);
      }
    }
  }
  const jugadores = Array.from(jugadoresMap.values()).sort((a, b) => b.rake - a.rake);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "cierres", label: "Cierres", count: semanas.length },
    { key: "jugadores", label: "Jugadores", count: jugadores.length },
    { key: "movimientos", label: "Movimientos", count: movimientos.length },
  ];

  function alternar(set: Set<string>, setSet: (s: Set<string>) => void, k: string) {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSet(next);
  }

  const minis = [
    ...(ultima
      ? [
          <PortalMini
            key="u"
            label="Última semana"
            value={ARS(ultima.efectoCuenta * -1)}
            sub={`${dateShort(ultima.weekStart).slice(0, 5)} al ${dateShort(ultima.weekEnd).slice(0, 5)} · ${ultima.agentes.length} agente${ultima.agentes.length === 1 ? "" : "s"}`}
            color={colorCierre(ultima.efectoCuenta * -1)}
          />,
        ]
      : []),
    <PortalMini key="a" label="Agentes a tu cuenta" value={String(cantAgentes)} sub={`${semanas.length} semana${semanas.length === 1 ? "" : "s"} cargada${semanas.length === 1 ? "" : "s"}`} />,
  ];

  const cierresPane = (
    <PortalPane activa={tab === "cierres"} titulo="Cierres semanales">
      {semanas.length === 0 ? (
        <div className="muted">Todavía no hay ningún cierre cargado en tu cuenta.</div>
      ) : (
        <>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Tocá una semana para ver cómo se calcula el cierre de cada agente y sus jugadores.</div>
          {semanas.map((s) => {
            const abierta = semanasAbiertas.has(s.weekStart);
            const aTuFavor = -s.efectoCuenta; // cierre del agente positivo = baja lo que debés
            return (
              <div key={s.weekStart} className="sc-sem">
                <div className="sc-sem-h" onClick={() => alternar(semanasAbiertas, setSemanasAbiertas, s.weekStart)}>
                  <div>
                    <div className="sc-t"><span className="sc-caret">{abierta ? "▾" : "▸"}</span>Semana {dateShort(s.weekStart).slice(0, 5)} al {dateShort(s.weekEnd).slice(0, 5)}</div>
                    <div className="sc-s">{s.agentes.length} agente{s.agentes.length === 1 ? "" : "s"}{s.jugadores ? ` · ${s.jugadores} jugador${s.jugadores === 1 ? "" : "es"}` : ""}</div>
                  </div>
                  <div className="sc-r">
                    <div className="sc-l">EFECTO EN TU CUENTA</div>
                    <div className="sc-m" style={{ color: colorCierre(aTuFavor) }}>{usdCents(Math.abs(aTuFavor))}</div>
                    <div className="sc-s">{aTuFavor > 0.004 ? "baja lo que le debés a la empresa" : aTuFavor < -0.004 ? "suma a lo que le debés a la empresa" : "sin efecto"}</div>
                  </div>
                </div>
                {abierta && s.agentes.map((a: any) => {
                  const k = a.id;
                  const jug = a.jugadores as any[];
                  const abiertoAg = agentesAbiertos.has(k);
                  const hayRebate = Math.abs(a.rebate) > 0.004;
                  const hayRodeo = Math.abs(a.rodeo) > 0.004;
                  const hayAjuste = Math.abs(a.ajusteManual) > 0.004;
                  return (
                    <div key={k} className="sc-ag">
                      <div className="sc-ag-h">
                        <div>
                          <b>{a.agente}</b> <span className="muted">· {a.club}{a.cantJugadores != null ? ` · ${a.cantJugadores} jugador${a.cantJugadores === 1 ? "" : "es"}` : ""}</span>
                        </div>
                        <div className="sc-r">
                          <div className="sc-l">CIERRE DEL AGENTE</div>
                          <div className="sc-m" style={{ color: colorCierre(a.cierreFinal) }}>{ARS(a.cierreFinal)}</div>
                        </div>
                      </div>
                      <div className="sc-hint">
                        Los jugadores de este agente {a.resultado < 0 ? "perdieron" : "ganaron"} {usdCents(Math.abs(a.resultado))} en total. Generaron {usdCents(a.rake)} de rake y el agente recibe el {Math.round(a.rakebackPct * 10000) / 100}% de eso.
                      </div>
                      <div className="sc-eq">
                        <div className="sc-b"><small>Resultado de los jugadores</small><b style={{ color: colorCierre(a.resultado) }}>{ARS(a.resultado)}</b><em>lo que ganó o perdió el club con ellos</em></div>
                        <span className="sc-op">+</span>
                        <div className="sc-b"><small>Rakeback</small><b style={{ color: colorCierre(a.rakeback) }}>{ARS(a.rakeback)}</b><em>{Math.round(a.rakebackPct * 10000) / 100}% de {usdCents(a.rake)} de rake</em></div>
                        {hayRebate && (<><span className="sc-op">+</span><div className="sc-b"><small>Rebate</small><b style={{ color: colorCierre(a.rebate) }}>{ARS(a.rebate)}</b><em>rebate de la semana</em></div></>)}
                        {hayRodeo && (<><span className="sc-op">+</span><div className="sc-b"><small>Rodeo</small><b style={{ color: colorCierre(a.rodeo) }}>{ARS(a.rodeo)}</b><em>parte del agente</em></div></>)}
                        {hayAjuste && (<><span className="sc-op">+</span><div className="sc-b"><small>Ajuste manual</small><b style={{ color: colorCierre(a.ajusteManual) }}>{ARS(a.ajusteManual)}</b><em>{a.ajusteManualNota || "ajuste"}</em></div></>)}
                        <span className="sc-op">=</span>
                        <div className="sc-b sc-fin"><small>Cierre final</small><b style={{ color: colorCierre(a.cierreFinal) }}>{ARS(a.cierreFinal)}</b><em>{a.cierreFinal >= 0 ? "baja lo que le debés a la empresa" : "suma a lo que le debés a la empresa"}</em></div>
                      </div>
                      <div className="sc-more" onClick={() => alternar(agentesAbiertos, setAgentesAbiertos, k)}>
                        {abiertoAg ? "▾ Ocultar jugadores" : `▸ Ver jugadores${jug.length ? ` (${jug.length})` : ""}`}
                      </div>
                      {abiertoAg && (
                        jug.length === 0 ? (
                          <div className="sc-hint">Esta semana se cargó sin el detalle por jugador.</div>
                        ) : (
                          <div className="sc-tabla">
                            <table className="saldos-table">
                              <thead><tr><th>Jugador</th><th>ID</th><th className="num">Resultado</th><th className="num">Rake</th><th className="num">Rakeback</th></tr></thead>
                              <tbody>
                                {jug.map((j) => (
                                  <tr key={j.id}>
                                    <td>{j.nombre}</td><td className="muted">{j.id}</td>
                                    <td className="num" style={{ color: colorCierre(j.resultado) }}>{ARS(j.resultado)}</td>
                                    <td className="num">{usdCents(j.rake)}</td>
                                    <td className="num">{usdCents(j.rakeback)}</td>
                                  </tr>
                                ))}
                                <tr style={{ fontWeight: 700 }}>
                                  <td colSpan={2}>Total · {jug.length} jugador{jug.length === 1 ? "" : "es"}</td>
                                  <td className="num" style={{ color: colorCierre(jug.reduce((t, j) => t + j.resultado, 0)) }}>{ARS(jug.reduce((t, j) => t + j.resultado, 0))}</td>
                                  <td className="num">{usdCents(jug.reduce((t, j) => t + j.rake, 0))}</td>
                                  <td className="num">{usdCents(jug.reduce((t, j) => t + j.rakeback, 0))}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}
    </PortalPane>
  );

  const jugadoresPane = (
    <PortalPane activa={tab === "jugadores"} titulo="Jugadores">
      {jugadores.length === 0 ? (
        <div className="muted">Todavía no hay jugadores con detalle cargado. El detalle por jugador se guarda desde los cierres nuevos.</div>
      ) : (
        <div className="sc-tabla">
          <table className="saldos-table">
            <thead><tr><th>Jugador</th><th>Agente</th><th>Club</th><th className="num">Semanas</th><th className="num">Resultado</th><th className="num">Rake</th><th className="num">Rakeback</th></tr></thead>
            <tbody>
              {jugadores.map((j) => (
                <tr key={`${j.agente}|${j.club}|${j.id}`}>
                  <td>{j.nombre} <span className="muted">· {j.id}</span></td>
                  <td>{j.agente}</td><td className="muted">{j.club}</td>
                  <td className="num">{j.semanas}</td>
                  <td className="num" style={{ color: colorCierre(j.resultado) }}>{ARS(j.resultado)}</td>
                  <td className="num">{usdCents(j.rake)}</td>
                  <td className="num">{usdCents(j.rakeback)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalPane>
  );

  const movimientosPane = (
    <PortalPane activa={tab === "movimientos"} titulo="Movimientos de tu cuenta">
      {movimientos.length === 0 ? (
        <div className="muted">Todavía no hay movimientos en tu cuenta.</div>
      ) : (
        <div style={{ maxHeight: 640, overflowY: "auto" }}>
          {movimientos.map((m) => (
            <div key={m.id} className={`pt-card${m.monto < 0 ? "" : " ng"}`}>
              <div className="b">
                <div className="t1">
                  <span className="n">{m.concepto}</span>
                  <span className="amt" style={{ color: colorDeuda(m.monto) }}>{montoSigno(m.monto)}</span>
                </div>
                <div className="t2">
                  <span>{dateShort(m.fecha)} · {m.categoria.toLowerCase()}{m.notas ? ` · ${m.notas}` : ""}</span>
                  <span>{m.monto > 0 ? "suma a lo que debés" : m.monto < 0 ? "a tu favor" : ""}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PortalPane>
  );

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <h2>Hola, {cuenta.nombre}</h2>
          <div className="muted">Tu cuenta, tus cierres semanales y tus jugadores.</div>
        </div>
      </div>

      <PortalTop
        hero={
          <PortalHero
            label="Saldo de tu cuenta"
            amount={usd(Math.abs(cuenta.saldo))}
            color={colorDeuda(cuenta.saldo)}
            foot={<span>{estadoSaldo(cuenta.saldo)}</span>}
          />
        }
        minis={minis}
      />

      <PortalTabs tabs={tabs} value={tab} onChange={setTab} />

      {cierresPane}
      {jugadoresPane}
      {movimientosPane}
    </div>
  );
}
