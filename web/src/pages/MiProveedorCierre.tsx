import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";
import { colorSigno, montoSigno } from "../components/PortalUI";

// Desglose completo de un cierre semanal del proveedor (19/10/2026, pedido de Leo: una página aparte para no
// cargar el panel). Por cada línea del cierre muestra los agentes del club esa semana (línea de club) o el
// agente de la línea (línea de agente), con lo que cada uno generó. Solo lectura, solo cierres propios.
const SISTEMA: Record<string, string> = { PREPAGO: "Prepago", WIN_LOSE: "Win/Lose" };
const dato = (x: any) => x !== null && x !== undefined;

export default function MiProveedorCierre() {
  const { id } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

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
          <div className="saldo-big" style={{ fontSize: 26, color: colorSigno(monto) }}>{montoSigno(monto)}</div>
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
                      {ag.map((a: any, j: number) => (
                        <tr key={j}>
                          <td><div className="saldo-name">{a.agent_name}</div></td>
                          <td className="muted">{SISTEMA[a.system] ?? a.system}</td>
                          <td className="num muted">{a.jugadores ?? "-"}</td>
                          <td className="num" style={{ color: colorSigno(Number(a.result)) }}>{montoSigno(Number(a.result))}</td>
                          <td className="num">{usdCents(Number(a.rake_total))}</td>
                          <td className="num muted">{Math.round(Number(a.rakeback_pct) * 10000) / 100}%</td>
                          <td className="num">{usdCents(Number(a.rakeback))}</td>
                          <td className="num muted">{Number(a.rodeo) ? usdCents(Number(a.rodeo)) : "—"}</td>
                          <td className="num"><b style={{ color: colorSigno(Number(a.final_closing)) }}>{montoSigno(Number(a.final_closing))}</b></td>
                        </tr>
                      ))}
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
                  {ag.map((a: any, j: number) => (
                    <div key={j} className={`saldo-card ${Number(a.final_closing) > 0.004 ? "is-pos" : Number(a.final_closing) < -0.004 ? "is-neg" : ""}`}>
                      <div className="saldo-card-body">
                        <div className="saldo-card-top">
                          <div className="saldo-name">{a.agent_name}</div>
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
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
