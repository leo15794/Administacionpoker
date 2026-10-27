import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";
import Ayuda from "../components/Ayuda";
import Cifra from "../components/Cifra";

// "Resumen de Rodeo" (23/09/2026, pedido de Leo): una fila por agente+club con la memoria
// vigente y el acumulado histórico de rodeo pagado -- para poder ver de un vistazo si la
// memoria se está comportando bien, mismo criterio que el panel de resumen de Jugadores
// Bancados (JugadoresBancados.tsx). La memoria en sí (rodeo_agent_memory) y toda la lógica de
// cálculo están en engine/rodeo.ts y repo/rodeo.ts -- acá solo se lee y se muestra, no se
// edita nada (no hay, por ahora, una forma de corregir la memoria a mano como sí existe para
// el capital/makeup de bancados).
//
// 19/10/2026 (pedido de Leo: "un desplegable para ver las diferentes semanas"): cada agente se despliega
// con el rodeo semana por semana (bruto, memoria antes/después, reparto y jugadores que lo generaron).
const signo = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${usdCents(Math.abs(n)).replace("US$", "").trim()}`;
const fechaCorta = (s: string) => dateShort(s).slice(0, 5);

function Semanas({ a }: { a: any }) {
  const sem: any[] = a.semanas ?? [];
  if (sem.length === 0) return <div className="muted" style={{ padding: "12px 0" }}>Sin semanas con rodeo cargadas.</div>;
  return (
    <>
      <div className="rd-tabla">
        <table className="saldos-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Semana</th><th className="num">Rodeo bruto</th><th className="num">Memoria antes</th><th className="num">A repartir</th>
              <th className="num">Agente 15%</th><th className="num">Club 20% (info.)</th><th className="num">Memoria después</th><th>Jugadores que lo generaron</th>
            </tr>
          </thead>
          <tbody>
            {sem.map((w) => (
              <tr key={w.weekStart}>
                <td><b>{fechaCorta(w.weekStart)} al {dateShort(w.weekEnd).slice(0, 5)}</b></td>
                {w.manual ? (
                  <td className="muted" colSpan={3} style={{ whiteSpace: "normal" }}>Rodeo cargado a mano (sin detalle de jugadores)</td>
                ) : (
                  <>
                    <td className="num" style={{ color: w.rodeoBruto < 0 ? "var(--red)" : undefined }}>{signo(w.rodeoBruto)}</td>
                    <td className="num muted">{usdCents(w.memoriaAntes)}</td>
                    <td className="num">{usdCents(w.aRepartir)}</td>
                  </>
                )}
                <td className="num"><b style={{ color: w.rodeoAgente > 0 ? "var(--green)" : "var(--text-dim)" }}>{usdCents(w.rodeoAgente)}</b></td>
                <td className="num muted">{usdCents(w.rodeoClub)}</td>
                <td className="num">
                  {w.memoriaDespues === null ? <span className="muted">—</span> : <b style={{ color: w.memoriaDespues > 0 ? "var(--red)" : "var(--text-dim)" }}>{usdCents(w.memoriaDespues)}</b>}
                </td>
                <td className="muted" style={{ fontSize: 12.5 }}>
                  {w.jugadores.map((j: any, i: number) => (
                    <Fragment key={j.id}>
                      {i > 0 && " · "}{j.nombre} <span style={{ color: j.base < 0 ? "var(--red)" : "var(--text-dim)" }}>{signo(j.base)}</span>
                    </Fragment>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ fontWeight: 700 }}>
              <td>Total ({sem.length} sem.)</td><td></td><td></td><td></td>
              <td className="num">{usdCents(a.rodeoPagadoAgenteTotal)}</td><td className="num">{usdCents(a.rodeoClubTotal)}</td><td className="num">{usdCents(a.memoriaActual)}</td><td></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="rd-lista">
        {sem.map((w) => (
          <div key={w.weekStart} className="rd-sem">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <b>{fechaCorta(w.weekStart)} al {dateShort(w.weekEnd).slice(0, 5)}</b>
              <b style={{ color: w.rodeoAgente > 0 ? "var(--green)" : "var(--text-dim)" }}>{usdCents(w.rodeoAgente)}</b>
            </div>
            <div className="saldo-sub" style={{ margin: "2px 0 0" }}>
              {w.manual
                ? `Rodeo cargado a mano · club ${usdCents(w.rodeoClub)}`
                : `Bruto ${signo(w.rodeoBruto)} · memoria ${usdCents(w.memoriaAntes)} → ${usdCents(w.memoriaDespues)} · club ${usdCents(w.rodeoClub)}`}
            </div>
            {w.jugadores.length > 0 && <div className="saldo-sub" style={{ margin: "2px 0 0" }}>{w.jugadores.map((j: any) => `${j.nombre} ${signo(j.base)}`).join(" · ")}</div>}
          </div>
        ))}
      </div>
    </>
  );
}

export default function Rodeo() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});

  useEffect(() => {
    api.resumenRodeo().then(setRows).catch((e) => setError(e.message));
  }, []);

  const ordenadas = useMemo(
    () => (rows ?? []).slice().sort((x, y) => Number(y.rodeoPagadoAgenteTotal) - Number(x.rodeoPagadoAgenteTotal) || x.agentName.localeCompare(y.agentName)),
    [rows]
  );
  const totAgente = ordenadas.reduce((s, r) => s + Number(r.rodeoPagadoAgenteTotal), 0);
  const totClub = ordenadas.reduce((s, r) => s + Number(r.rodeoClubTotal), 0);
  const conMemoria = ordenadas.filter((r) => Number(r.memoriaActual) > 0.004);
  const totMemoria = conMemoria.reduce((s, r) => s + Number(r.memoriaActual), 0);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Resumen de Rodeo <Ayuda>Memoria vigente y acumulado de Rodeo por agente y club (solo SupremaPoker: Fénix, TeamBack) — para chequear
            que la memoria se esté comportando como corresponde. Cuando el agente viene ganando en mesas, esa pérdida
            se acumula acá como memoria pendiente y se descuenta de lo que genere en semanas futuras antes de repartir
            nada.</Ayuda></h2>
        </div>
      </div>

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

      <div style={{ marginTop: 16 }}>
        {!rows ? (
          <div className="panel"><Loading /></div>
        ) : rows.length === 0 ? (
          <div className="panel"><div className="muted">Todavía no hay ningún agente con Rodeo cargado.</div></div>
        ) : (
          <>
            <div className="stat-row" style={{ marginBottom: 14 }}>
              <div className="stat-card">
                <div className="l">Rodeo pagado a agentes</div>
                <div className="v pos">{usdCents(totAgente)}</div>
                <div className="s">acumulado, {ordenadas.length} agente{ordenadas.length === 1 ? "" : "s"}</div>
              </div>
              <div className="stat-card">
                <div className="l">Rodeo del club</div>
                <div className="v"><Cifra texto={usdCents(totClub)} /></div>
                <div className="s">informativo, no se acredita</div>
              </div>
              <div className="stat-card">
                <div className="l">Memoria pendiente</div>
                <div className={`v ${totMemoria > 0.004 ? "neg" : "pos"}`}><Cifra texto={usdCents(totMemoria)} /></div>
                <div className="s">{conMemoria.length === 0 ? "ningún agente" : `${conMemoria.length} agente${conMemoria.length === 1 ? "" : "s"} (${conMemoria.map((r) => r.agentName).join(", ")})`}</div>
              </div>
            </div>
            <div className="muted" style={{ margin: "0 0 10px" }}>Tocá un agente para ver el rodeo semana por semana.</div>
            {ordenadas.map((r) => {
              const k = `${r.agentId}_${r.clubId}`;
              const ab = !!abiertos[k];
              const mem = Number(r.memoriaActual);
              const pag = Number(r.rodeoPagadoAgenteTotal);
              return (
                <div key={k} className={`rd-ag${ab ? " ab" : ""}`}>
                  <div className="rd-cab" onClick={() => setAbiertos((s) => ({ ...s, [k]: !s[k] }))}>
                    <span className={`chev${ab ? " on" : ""}`}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <b style={{ fontSize: 15 }}>{r.agentName}</b>
                        <span className="pill">{r.clubName}</span>
                        {mem > 0.004 ? <span className="pill r">Memoria {usdCents(mem)}</span> : <span className="pill g">Sin memoria</span>}
                      </div>
                      <div className="saldo-sub" style={{ margin: "3px 0 0" }}>
                        {r.semanasConRodeo} semana{r.semanasConRodeo === 1 ? "" : "s"} con rodeo · última {r.ultimaSemana ? dateShort(r.ultimaSemana) : "-"}
                      </div>
                    </div>
                    <div className="rd-nums">
                      <div><div className="saldo-sub" style={{ margin: 0 }}>Pagado a agente</div><b style={{ color: pag > 0 ? "var(--green)" : "var(--text-dim)" }}>{usdCents(pag)}</b></div>
                      <div><div className="saldo-sub" style={{ margin: 0 }}>Club (info.)</div><b>{usdCents(Number(r.rodeoClubTotal))}</b></div>
                    </div>
                  </div>
                  {ab && (
                    <div className="rd-det">
                      <Semanas a={r} />
                      {mem > 0.004 && (
                        <div className="saldo-sub" style={{ margin: "10px 0 0" }}>
                          La memoria de {usdCents(mem)} se descuenta del rodeo que genere {r.agentName} en las próximas semanas, antes de repartir nada.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
