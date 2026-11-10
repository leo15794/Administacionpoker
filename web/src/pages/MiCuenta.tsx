import { useEffect, useState } from "react";
import { api } from "../api";
import { usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";
import MiCuentaAgente from "./MiCuentaAgente";
import CalculadoraCierre from "../components/CalculadoraCierre";
import { PortalTop, PortalHero, PortalMini, PortalTabs, PortalCols, PortalPane, PortalCard, BarraDivergente, MovRow, colorSigno, montoSigno } from "../components/PortalUI";

// Saldo neto por club (01/10/2026): para PREPAGO, balances.amount solo no alcanza -- hay que
// sumarle el resultado acumulado de mesas (ver fichasTotal() en Resumen.tsx, misma fórmula).
function saldoNeto(b: any): number {
  if (b.system === "PREPAGO") return Number(b.amount) + Number(b.total_fichas_ganadas_mesas || 0);
  return Number(b.amount);
}

// Cierre del agente de un supervisor (10/11/2026, mockup 86): se toca y muestra el desglose y sus jugadores.
const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const conSigno = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Number(n) > 0 ? "+" : Number(n) < 0 ? "−" : ""}${num(Math.abs(Number(n)))}`);
const claseSigno = (n: number | null | undefined) => (n === null || n === undefined || Number(n) === 0 ? "" : Number(n) < 0 ? "neg" : "pos");

function CierreAgenteCard({ c, abiertoInicial }: { c: any; abiertoInicial: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const jug: any[] = c.jugadores_detalle ?? [];
  const sinMonto = c.final_closing === null || c.final_closing === undefined;
  const pct = c.rakeback_pct === null || c.rakeback_pct === undefined ? "" : ` ${(Math.round(Number(c.rakeback_pct) * 10000) / 100).toLocaleString("es-AR")}%`;
  const sistema = c.system === "PREPAGO" ? "Prepago" : c.system === "WIN_LOSE" ? "Win/Lose" : null;
  const suma = (k: string) => jug.reduce((t, j) => t + Number(j[k] ?? 0), 0);
  return (
    <div className={`ca-card${abierto ? " open" : ""}`}>
      <button type="button" className="ca-h" onClick={() => setAbierto(!abierto)}>
        <span className="ca-car">{abierto ? "▾" : "▸"}</span>
        <span className="ca-t">
          <b>{dateShort(c.week_start).slice(0, 5)} al {dateShort(c.week_end).slice(0, 5)}</b>
          <small>{c.club_name}{sistema ? ` · ${sistema}` : ""}</small>
        </span>
        {jug.length > 0 && <span className="ca-pill">{jug.length} {jug.length === 1 ? "jugador" : "jugadores"}</span>}
        <span className={`ca-m ${sinMonto ? "" : claseSigno(c.final_closing)}`}>{sinMonto ? "Sin acuerdo" : usdCents(c.final_closing)}</span>
      </button>
      {abierto && (
        <div className="ca-body">
          {c.sin_acuerdo ? (
            <div className="ca-aviso">Este cierre todavía no tiene monto: faltan cargar tus % en este club.</div>
          ) : (
            <>
              <div className="ca-lbl">Desglose del cierre</div>
              <div className="ca-des">
                <div><small>Resultado</small><b className={claseSigno(c.result)}>{conSigno(c.result)}</b></div>
                <div><small>Rake</small><b>{num(c.rake_total)}</b></div>
                <div><small>Rakeback{pct}</small><b className={claseSigno(c.rakeback)}>{conSigno(c.rakeback)}</b></div>
                <div><small>Rebate</small><b className={claseSigno(c.rebate)}>{conSigno(c.rebate)}</b></div>
                <div className="tot"><small>Cierre</small><b className={claseSigno(c.final_closing)}>{conSigno(c.final_closing)}</b></div>
              </div>
            </>
          )}
          {jug.length === 0 ? (
            <div className="ca-aviso">Este club no informa el detalle por jugador: solo se ve el total del cierre.</div>
          ) : (
            <>
              <div className="ca-lbl">Mis jugadores</div>
              <table className="ca-tabla">
                <thead>
                  <tr><th>Jugador</th><th>Resultado</th><th>Rake</th><th>Rakeback</th><th>Rebate</th><th>Cierre</th></tr>
                </thead>
                <tbody>
                  {jug.map((j) => (
                    <tr key={j.id}>
                      <td><b>{j.nombre}</b><span className="id">{j.id}</span></td>
                      <td className={claseSigno(j.resultado)}>{conSigno(j.resultado)}</td>
                      <td>{num(j.rake)}</td>
                      <td className={claseSigno(j.rakeback)}>{conSigno(j.rakeback)}</td>
                      <td className={claseSigno(j.rebate)}>{conSigno(j.rebate)}</td>
                      <td className={claseSigno(j.cierre)}><b>{conSigno(j.cierre)}</b></td>
                    </tr>
                  ))}
                </tbody>
                {jug.length > 1 && (
                  <tfoot>
                    <tr>
                      <td>Total · {jug.length} jugadores</td>
                      <td className={claseSigno(suma("resultado"))}>{conSigno(suma("resultado"))}</td>
                      <td>{num(suma("rake"))}</td>
                      <td>{c.sin_acuerdo ? "—" : conSigno(suma("rakeback"))}</td>
                      <td>{c.sin_acuerdo ? "—" : conSigno(suma("rebate"))}</td>
                      <td className={c.sin_acuerdo ? "" : claseSigno(suma("cierre"))}>{c.sin_acuerdo ? "—" : conSigno(suma("cierre"))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
              <div className="ca-movil">
                {jug.map((j) => (
                  <div key={j.id} className="ca-j">
                    <div className="r1"><span>{j.nombre}</span><span className={claseSigno(j.cierre)}>{conSigno(j.cierre)}</span></div>
                    <div className="r2">
                      <span>Res {conSigno(j.resultado)} · Rake {num(j.rake)}</span>
                      <span>RB {conSigno(j.rakeback)}{j.rebate ? ` · Reb ${conSigno(j.rebate)}` : ""}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type Tab = "saldos" | "cierres" | "movimientos" | "calculadora";

// (19/10/2026, pedido de Leo, mockups aprobados) Portal del agente rediseñado: tarjeta principal con
// el saldo, cierres y movimientos como tarjetas/filas (en celular la tabla de movimientos cortaba la
// columna Monto y mostraba los tipos con el nombre interno), pestañas en celular y todo a la vista
// en escritorio. Mismos datos y endpoints de siempre.
export default function MiCuenta() {
  const [misAgentes, setMisAgentes] = useState<any[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("cierres");

  // La mayoría de los logins tienen una sola cuenta — el selector solo aparece si de verdad hay
  // más de una asociada (ver Usuarios y permisos → "Agentes/clubes que puede ver").
  useEffect(() => {
    api.misAgentes().then(setMisAgentes).catch(() => {});
  }, []);

  useEffect(() => {
    api.miCuenta(agentId || undefined).then(setData);
  }, [agentId]);

  if (!data) return <Loading />;
  // Agente con cuenta propia en la sección Agentes: "Mi cuenta" muestra esa cuenta (20/10/2026).
  if (data.cuenta && !data.solo_cierres) return <MiCuentaAgente data={data} misAgentes={misAgentes} agentId={agentId} setAgentId={setAgentId} />;

  const totalNeto = data.saldos.reduce((s: number, b: any) => s + saldoNeto(b), 0);
  const variosClubes = data.saldos.length > 1;
  const cierres: any[] = data.cierres ?? [];
  const ultimos = cierres.slice(0, 4);
  const sumaUltimos = ultimos.reduce((s, c) => s + Number(c.final_closing ?? 0), 0);
  // Acuerdo con su supervisor (05/11/2026): con % cargados por el supervisor, los cierres llegan ya calculados con esos %.
  const acuerdo = data.acuerdo_supervisor as { supervisor: string; clubes: any[] } | null;
  const pctTxt = (n: number) => `${(Math.round(Number(n) * 10000) / 100).toLocaleString("es-AR")}%`;
  const maxAbs = Math.max(...data.saldos.map((b: any) => Math.abs(saldoNeto(b))), 1);
  const sistema = data.agente.default_system === "PREPAGO" ? "Prepago" : "Win/Lose";

  // "Saldo por club" solo suma algo cuando hay más de un club -- con uno solo es el mismo número
  // de la tarjeta principal.
  const tabActual: Tab = !variosClubes && tab === "saldos" ? "cierres" : tab;
  const tabs = [
    ...(variosClubes ? [{ key: "saldos" as Tab, label: "Saldo por club", count: data.saldos.length }] : []),
    { key: "cierres" as Tab, label: "Cierres", count: cierres.length },
    { key: "movimientos" as Tab, label: "Movimientos", count: data.movimientos.length },
    { key: "calculadora" as Tab, label: "Calculadora" },
  ];

  const minis = [
    ...(ultimos[0]
      ? [
          <PortalMini key="u" label="Último cierre" value={usdCents(ultimos[0].final_closing)} sub={`${dateShort(ultimos[0].week_start).slice(0, 5)} al ${dateShort(ultimos[0].week_end).slice(0, 5)}`} color={colorSigno(Number(ultimos[0].final_closing))} />,
        ]
      : []),
    ...(ultimos.length > 1 ? [<PortalMini key="s" label={`Últimos ${ultimos.length} cierres`} value={montoSigno(sumaUltimos)} sub={`suma de las ${ultimos.length} semanas`} />] : []),
    ...(data.garantia ? [<PortalMini key="g" label="Garantía vigente" value={usdCents(data.garantia.amount)} />] : []),
  ];

  const saldosPane = (
    <PortalPane activa={tabActual === "saldos"} titulo="Mi saldo por club">
      {data.saldos.map((b: any) => (
        <PortalCard key={b.id} titulo={b.club_name} monto={saldoNeto(b)} izq={b.system === "PREPAGO" ? "Prepago" : "Win/Lose"} barra={<BarraDivergente monto={saldoNeto(b)} max={maxAbs} />} />
      ))}
    </PortalPane>
  );

  const cierresPane = (
    <PortalPane activa={tabActual === "cierres"} titulo="Mis últimos cierres semanales">
      {cierres.length === 0 ? (
        <div className="muted">Todavía no hay cierres semanales cargados.</div>
      ) : (
        cierres.map((c: any) => (
          <PortalCard
            key={c.id}
            titulo={`${dateShort(c.week_start).slice(0, 5)} al ${dateShort(c.week_end).slice(0, 5)}`}
            monto={Number(c.final_closing ?? 0)}
            izq={c.club_name}
            der={
              acuerdo
                ? c.sin_acuerdo
                  ? "Faltan cargar tus % en este club"
                  : `Resultado ${usdCents(c.result)} · rakeback ${pctTxt(c.rakeback_pct)} = ${usdCents(c.rakeback)}${Number(c.rebate) ? ` · rebate ${usdCents(c.rebate)}` : ""}`
                : "Cierre final"
            }
          />
        ))
      )}
    </PortalPane>
  );

  const acuerdoPane = acuerdo && (
    <PortalPane activa titulo="Tu acuerdo">
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Tus % por club. Con esto se calcula tu cierre de cada semana.</div>
      {acuerdo.clubes.map((c: any) => (
        <div key={c.club_id} className="pt-card">
          <div className="b">
            <div className="t1">
              <span className="n">{c.club_name}</span>
              <span className="pill">{c.system === "PREPAGO" ? "Prepago" : "Win/Lose"}</span>
            </div>
            <div className="t2">
              <span>Rakeback {pctTxt(c.rakeback_pct)}</span>
              <span>Rebate {pctTxt(c.rebate_pct)}</span>
            </div>
          </div>
        </div>
      ))}
    </PortalPane>
  );

  const movimientosPane = (
    <PortalPane activa={tabActual === "movimientos"} titulo="Mis movimientos recientes">
      {data.movimientos.length === 0 ? (
        <div className="muted">Todavía no hay movimientos registrados en el sistema nuevo.</div>
      ) : (
        <div className="mov-list">
          {data.movimientos.map((m: any) => (
            <MovRow key={m.id} type={m.type} detalle={`${m.club_name} · ${dateShort(m.occurred_at)}`} monto={Number(m.amount)} />
          ))}
        </div>
      )}
    </PortalPane>
  );

  // Agente de un supervisor (06/11/2026): solo sus cierres semanales, nada más.
  if (data.solo_cierres)
    return (
      <div>
        <div className="topbar" style={{ marginBottom: 14 }}>
          <div>
            <h2>Hola, {data.agente.name}</h2>
            <div className="muted">
              Tocá un cierre para ver el desglose y tus jugadores
            </div>
          </div>
        </div>
        {cierres.length === 0 ? (
          <div className="muted">Todavía no hay cierres semanales cargados.</div>
        ) : (
          cierres.map((c: any, i: number) => <CierreAgenteCard key={c.id} c={c} abiertoInicial={i === 0} />)
        )}
      </div>
    );

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <h2>Hola, {data.agente.name}</h2>
          <div className="muted">Sistema: {sistema}</div>
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
            label="Tu saldo neto"
            amount={montoSigno(totalNeto)}
            color={colorSigno(totalNeto)}
            foot={
              <>
                <span>{variosClubes ? `${data.saldos.length} clubes` : data.saldos[0]?.club_name ?? "Sin clubes todavía"}</span>
                <span>{sistema}</span>
              </>
            }
          />
        }
        minis={minis}
      />

      <PortalTabs tabs={tabs} value={tabActual} onChange={setTab} />

      <PortalCols
        left={
          <>
            {variosClubes && saldosPane}
            {cierresPane}
            <CalculadoraCierre activa={tabActual === "calculadora"} sistemaInicial={data.agente.default_system === "PREPAGO" ? "PREPAGO" : "WIN_LOSE"} perspectiva="agente" />
          </>
        }
        right={
          <>
            {acuerdoPane}
            {movimientosPane}
          </>
        }
      />
    </div>
  );
}
