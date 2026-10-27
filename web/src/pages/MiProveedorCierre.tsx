import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";
import { colorSigno, montoSigno } from "../components/PortalUI";
import Cifra from "../components/Cifra";

// Desglose completo de un cierre semanal del proveedor (19/10/2026, pedido de Leo: una página aparte para no
// cargar el panel). Por cada línea del cierre muestra los agentes del club esa semana (línea de club) o el
// agente de la línea (línea de agente), con lo que cada uno generó. Solo lectura, solo cierres propios.
const SISTEMA: Record<string, string> = { PREPAGO: "Prepago", WIN_LOSE: "Win/Lose" };
const dato = (x: any) => x !== null && x !== undefined;

const sinMov = (j: any) => Math.abs(Number(j.resultado)) < 0.005 && Math.abs(Number(j.rake)) < 0.005;
const colorMonto = (n: number) => (n > 0.004 ? "var(--green)" : n < -0.004 ? "var(--red)" : "var(--text-dim)");

// Jugadores de un agente esa semana (19/10/2026, pedido de Leo). Por defecto solo los que tuvieron movimiento
// (los que están en cero se ven con "Todos"). El rakeback ya viene calculado por el servidor con el % del proveedor.
function JugadoresPanel({ a, todos, setTodos, mobile }: { a: any; todos: boolean; setTodos: (v: boolean) => void; mobile: boolean }) {
  const j: any[] = a.jugadores_detalle ?? [];
  const conMov = j.filter((x) => !sinMov(x));
  const lista = todos ? j : conMov;
  const pct = `${Math.round(Number(a.rakeback_pct) * 10000) / 100}%`;
  const tot = j.reduce((s, x) => ({ r: s.r + Number(x.resultado), k: s.k + Number(x.rake), b: s.b + Number(x.rakeback), c: s.c + Number(x.cierre) }), { r: 0, k: 0, b: 0, c: 0 });
  const selector = (
    <span className="seg">
      <button className={!todos ? "on" : ""} onClick={() => setTodos(false)}>Con movimiento<span className="n">{conMov.length}</span></button>
      <button className={todos ? "on" : ""} onClick={() => setTodos(true)}>Todos<span className="n">{j.length}</span></button>
    </span>
  );
  const nota = Number(a.rodeo)
    ? `El rodeo (${usdCents(Number(a.rodeo))}) se suma a nivel agente, no por jugador. Por eso el cierre del agente (${montoSigno(Number(a.final_closing))}) = jugadores (${montoSigno(tot.c)}) + rodeo.`
    : null;
  if (mobile) {
    return (
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <b style={{ fontSize: 13 }}>Jugadores de {a.agent_name}</b>
          {selector}
        </div>
        {lista.map((x, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "7px 0", borderTop: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontWeight: 650, fontSize: 13 }}>{x.nombre}</div>
              <div className="saldo-sub" style={{ margin: 0 }}>ID {x.id} · rake {usdCents(Number(x.rake))}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <b style={{ color: colorMonto(Number(x.cierre)) }}>{montoSigno(Number(x.cierre))}</b>
              <div className="saldo-sub" style={{ margin: 0 }}>res. <span style={{ color: colorMonto(Number(x.resultado)) }}>{montoSigno(Number(x.resultado))}</span></div>
            </div>
          </div>
        ))}
        <div className="saldo-sub" style={{ marginTop: 8 }}>Total {j.length} jugadores: <b>{montoSigno(tot.c)}</b></div>
        {nota && <div className="saldo-sub" style={{ marginTop: 4 }}>{nota}</div>}
      </div>
    );
  }
  return (
    <div style={{ padding: "14px 16px 12px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <div><b style={{ fontSize: 14 }}>Jugadores de {a.agent_name}</b> <span className="muted">· {conMov.length} con movimiento de {j.length} · rakeback al {pct}</span></div>
        {selector}
      </div>
      <table className="saldos-table" style={{ width: "100%" }}>
        <thead>
          <tr><th>Jugador</th><th>ID</th><th className="num">Resultado</th><th className="num">Rake</th><th className="num">Rakeback {pct}</th><th className="num">Cierre del jugador</th></tr>
        </thead>
        <tbody>
          {lista.map((x, i) => (
            <tr key={i}>
              <td><div className="saldo-name">{x.nombre}</div></td>
              <td className="muted">{x.id}</td>
              <td className="num" style={{ color: colorMonto(Number(x.resultado)) }}>{montoSigno(Number(x.resultado))}</td>
              <td className="num">{usdCents(Number(x.rake))}</td>
              <td className="num">{usdCents(Number(x.rakeback))}</td>
              <td className="num"><b style={{ color: colorMonto(Number(x.cierre)) }}>{montoSigno(Number(x.cierre))}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700 }}>
            <td>Total ({j.length} jugadores)</td><td></td>
            <td className="num">{montoSigno(tot.r)}</td><td className="num">{usdCents(tot.k)}</td><td className="num">{usdCents(tot.b)}</td><td className="num">{montoSigno(tot.c)}</td>
          </tr>
        </tfoot>
      </table>
      {nota && <div className="saldo-sub" style={{ margin: "10px 0 0" }}>{nota}</div>}
    </div>
  );
}

export default function MiProveedorCierre() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [verTodos, setVerTodos] = useState<Record<string, boolean>>({});
  const alternar = (k: string) => setAbiertos((s) => ({ ...s, [k]: !s[k] }));

  useEffect(() => {
    if (!id) return;
    api.miProveedorDetalleCierre(id).then(setData).catch((e: any) => setError(e.message || "No se pudo cargar el desglose."));
  }, [id]);

  if (error) {
    return (
      <div>
        <button className="btn secondary small" onClick={() => nav("/mi-proveedor")}>← Volver</button>
        <div className="error" style={{ marginTop: 12 }}>No se pudo cargar: {error}</div>
      </div>
    );
  }
  if (!data) return <Loading />;

  const c = data.cierre;
  const monto = Number(c.cierre);
  return (
    <div>
      <button className="btn secondary small" onClick={() => nav("/mi-proveedor")}>← Mis cierres</button>
      <div className="panel" style={{ marginTop: 12, padding: 16 }}>
        <div className="deals-eyebrow">Cierre semanal</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 22, fontWeight: 750 }}>{dateShort(c.week_start)} al {dateShort(c.week_end)}</div>
          <div className="saldo-big" style={{ fontSize: 26, color: colorSigno(monto) }}><Cifra texto={montoSigno(monto)} /></div>
        </div>
        <div className="saldo-sub" style={{ marginTop: 4 }}>
          {c.status === "REVERTIDO" ? <span className="pill r">Revertido</span> : <span className="pill g">Aplicado</span>} · saldo antes {usdCents(Number(c.saldo_anterior))} → después {usdCents(Number(c.saldo_nuevo))}
        </div>
      </div>

      {data.lineas.map((l: any, i: number) => {
        const esAgente = l.tipo === "AGENTE";
        const resultado = esAgente ? l.wc_result : l.resultado_total;
        const rake = esAgente ? l.wc_rake_total : l.rake_total;
        const pctRb = esAgente ? l.wc_rakeback_pct : l.rakeback_pct;
        const rodeo = esAgente ? l.wc_rodeo : l.impacto_rodeo;
        const aplicado = Number(l.monto_aplicado);
        const ag: any[] = l.agentes ?? [];
        return (
          <div key={l.id ?? i} className="panel" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 17, fontWeight: 750 }}>{l.club_name}{esAgente && l.agent_name ? ` · ${l.agent_name}` : ""}</div>
              <span className="pill">{esAgente ? "Agente" : "Club total"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "10px 16px", margin: "12px 0" }}>
              <div><div className="saldo-sub" style={{ margin: 0 }}>Resultado</div><b>{dato(resultado) ? usdCents(Number(resultado)) : "—"}</b></div>
              <div><div className="saldo-sub" style={{ margin: 0 }}>Rake</div><b>{dato(rake) ? usdCents(Number(rake)) : "—"}</b></div>
              <div><div className="saldo-sub" style={{ margin: 0 }}>% rakeback</div><b>{dato(pctRb) ? `${Math.round(Number(pctRb) * 10000) / 100}%` : "—"}</b></div>
              <div><div className="saldo-sub" style={{ margin: 0 }}>Rebate del club</div><b>{dato(l.club_rebate) ? usdCents(Number(l.club_rebate)) : "—"}</b></div>
              <div><div className="saldo-sub" style={{ margin: 0 }}>Rodeo</div><b>{dato(rodeo) ? usdCents(Number(rodeo)) : "—"}</b></div>
              <div><div className="saldo-sub" style={{ margin: 0 }}>Monto bruto</div><b>{usdCents(Number(l.monto_crudo))}</b></div>
            </div>
            <div className="saldo-sub" style={{ marginBottom: 12 }}>
              Aplicado a tu saldo: <b style={{ color: colorSigno(aplicado) }}>{montoSigno(aplicado)}</b>
            </div>

            <h4 style={{ margin: "0 0 8px" }}>{esAgente ? "Agente" : `Agentes de ${l.club_name} esa semana`} <span className="muted" style={{ fontWeight: 400 }}>({ag.length})</span></h4>
            {ag.length === 0 ? (
              <div className="muted">Sin cierres de agentes cargados para esta línea.</div>
            ) : (
              <>
                <div className="ag-table-wrap">
                  <table className="saldos-table">
                    <thead>
                      <tr>
                        <th>Agente</th><th>Sistema</th><th className="num">Jugadores</th><th className="num">Resultado</th><th className="num">Rake</th>
                        <th className="num">% rakeback</th><th className="num">Rakeback</th><th className="num">Rodeo</th><th className="num">Cierre final</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ag.map((a: any, j: number) => {
                        const k = `${i}-${j}`;
                        const conJug = (a.jugadores_detalle?.length ?? 0) > 0;
                        const abierto = !!abiertos[k];
                        return (
                          <Fragment key={j}>
                            <tr
                              onClick={conJug ? () => alternar(k) : undefined}
                              style={{ cursor: conJug ? "pointer" : undefined, background: abierto ? "var(--accent-soft)" : undefined }}
                            >
                              <td>
                                <div className="saldo-name" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  {conJug && <span style={{ color: abierto ? "var(--accent)" : "var(--text-faint)", fontSize: 11 }}>{abierto ? "▼" : "▶"}</span>}
                                  {a.agent_name}
                                </div>
                                {conJug && <div className="saldo-sub" style={{ margin: "2px 0 0 19px", color: abierto ? "var(--accent)" : undefined }}>{abierto ? "Ocultar jugadores" : `Ver jugadores (${a.jugadores_detalle.length})`}</div>}
                              </td>
                              <td className="muted">{SISTEMA[a.system] ?? a.system}</td>
                              <td className="num muted">{a.jugadores ?? "-"}</td>
                              <td className="num" style={{ color: colorSigno(Number(a.result)) }}>{montoSigno(Number(a.result))}</td>
                              <td className="num">{usdCents(Number(a.rake_total))}</td>
                              <td className="num muted">{Math.round(Number(a.rakeback_pct) * 10000) / 100}%</td>
                              <td className="num">{usdCents(Number(a.rakeback))}</td>
                              <td className="num muted">{Number(a.rodeo) ? usdCents(Number(a.rodeo)) : "—"}</td>
                              <td className="num"><b style={{ color: colorSigno(Number(a.final_closing)) }}>{montoSigno(Number(a.final_closing))}</b></td>
                            </tr>
                            {conJug && abierto && (
                              <tr>
                                <td colSpan={9} style={{ padding: 0, background: "var(--panel-2)" }}>
                                  <JugadoresPanel a={a} todos={!!verTodos[k]} setTodos={(v) => setVerTodos((s) => ({ ...s, [k]: v }))} mobile={false} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    {ag.length > 1 && (
                      <tfoot>
                        <tr style={{ fontWeight: 700 }}>
                          <td>Total</td><td></td><td className="num">{ag.some((a) => a.jugadores != null) ? ag.reduce((s, a) => s + (Number(a.jugadores) || 0), 0) : "-"}</td>
                          <td className="num">{montoSigno(ag.reduce((s, a) => s + Number(a.result), 0))}</td>
                          <td className="num">{usdCents(ag.reduce((s, a) => s + Number(a.rake_total), 0))}</td><td></td>
                          <td className="num">{usdCents(ag.reduce((s, a) => s + Number(a.rakeback), 0))}</td>
                          <td className="num">{usdCents(ag.reduce((s, a) => s + Number(a.rodeo), 0))}</td>
                          <td className="num">{montoSigno(ag.reduce((s, a) => s + Number(a.final_closing), 0))}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                <div className="ag-cards">
                  {ag.map((a: any, j: number) => {
                    const k = `${i}-${j}`;
                    const conJug = (a.jugadores_detalle?.length ?? 0) > 0;
                    const abierto = !!abiertos[k];
                    return (
                    <div key={j} className={`saldo-card ${Number(a.final_closing) > 0.004 ? "is-pos" : Number(a.final_closing) < -0.004 ? "is-neg" : ""}`}>
                      <div className="saldo-card-body">
                        <div className="saldo-card-top" onClick={conJug ? () => alternar(k) : undefined} style={{ cursor: conJug ? "pointer" : undefined }}>
                          <div className="saldo-name">{conJug && <span style={{ color: abierto ? "var(--accent)" : "var(--text-faint)", fontSize: 11, marginRight: 6 }}>{abierto ? "▼" : "▶"}</span>}{a.agent_name}</div>
                          <div className="saldo-big" style={{ color: colorSigno(Number(a.final_closing)) }}>{montoSigno(Number(a.final_closing))}</div>
                        </div>
                        <div className="saldo-card-mid">
                          <div className="saldo-sub">{SISTEMA[a.system] ?? a.system} · {a.jugadores ?? "-"} jugadores · {Math.round(Number(a.rakeback_pct) * 10000) / 100}% rakeback</div>
                        </div>
                        <div className="saldo-card-foot" style={{ gap: 14, flexWrap: "wrap" }}>
                          <span>Resultado <b style={{ color: colorSigno(Number(a.result)) }}>{montoSigno(Number(a.result))}</b></span>
                          <span>Rake <b>{usdCents(Number(a.rake_total))}</b></span>
                          <span>Rakeback <b>{usdCents(Number(a.rakeback))}</b></span>
                          {Number(a.rodeo) !== 0 && <span>Rodeo <b>{usdCents(Number(a.rodeo))}</b></span>}
                        </div>
                        {conJug && !abierto && (
                          <div className="saldo-sub" style={{ marginTop: 8, color: "var(--accent)", cursor: "pointer" }} onClick={() => alternar(k)}>Ver jugadores ({a.jugadores_detalle.length})</div>
                        )}
                        {conJug && abierto && <JugadoresPanel a={a} todos={!!verTodos[k]} setTodos={(v) => setVerTodos((s) => ({ ...s, [k]: v }))} mobile />}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
