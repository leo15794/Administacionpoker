import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";

/**
 * "Resumen por club" — reproduce el bloque "RESUMEN DEL CLUB" de la planilla "automatizacion
 * clubes" (una pestana RESUMEN_TB/RESUMEN_FENIX/RESUMEN_GG/RESUMEN_FENIX_GG por club),
 * confirmado formula por formula contra esa planilla el 14/09/2026. Muestra el desglose por
 * agente de la semana elegida y, debajo, el total del club (ganancia por rake + los dos datos
 * externos que no salen de ningun cierre — Ganancia Rodeo Club e Ingreso por ventas — mas el
 * fee fijo semanal del club si tiene, ej. Tasa semanal GG).
 */
export default function ResumenClub() {
  const [clubes, setClubes] = useState<any[]>([]);
  const [clubId, setClubId] = useState("");
  const [semanas, setSemanas] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [resumen, setResumen] = useState<any>(null);
  const [error, setError] = useState("");
  const [editandoExtras, setEditandoExtras] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [rodeoInput, setRodeoInput] = useState("0");
  const [ventasInput, setVentasInput] = useState("0");
  const [observaciones, setObservaciones] = useState("");

  useEffect(() => {
    api.clubes().then((cs: any[]) => {
      setClubes(cs);
      if (cs.length > 0) setClubId(cs[0].id);
    });
  }, []);

  useEffect(() => {
    if (!clubId) return;
    api.semanasResumenClub(clubId).then((s: any[]) => {
      setSemanas(s);
      setWeekStart(s[0]?.week_start ?? "");
    });
  }, [clubId]);

  useEffect(() => {
    if (!clubId || !weekStart) {
      setResumen(null);
      return;
    }
    setError("");
    api
      .resumenClub(clubId, weekStart)
      .then((r: any) => {
        setResumen(r);
        setRodeoInput(String(r.gananciaRodeoClub));
        setVentasInput(String(r.ingresoPorVentas));
      })
      .catch((e: any) => setError(e.message));
  }, [clubId, weekStart]);

  async function guardarExtras() {
    if (!resumen) return;
    setGuardando(true);
    try {
      await api.guardarExtrasResumenClub({
        clubId: resumen.clubId,
        weekStart: resumen.weekStart,
        weekEnd: resumen.weekEnd ?? resumen.weekStart,
        gananciaRodeoClub: Number(rodeoInput) || 0,
        ingresoPorVentas: Number(ventasInput) || 0,
        observaciones: observaciones || undefined,
      });
      const r = await api.resumenClub(clubId, weekStart);
      setResumen(r);
      setEditandoExtras(false);
    } catch (err: any) {
      alert(err.message || "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Resumen por club</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            {clubes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
            {semanas.length === 0 && <option value="">Sin cierres cargados</option>}
            {semanas.map((s) => (
              <option key={s.week_start} value={s.week_start}>
                {dateShort(s.week_start)} - {dateShort(s.week_end)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {!resumen && !error && <div className="muted">Elegi un club y una semana con cierres cargados.</div>}

      {resumen && (
        <>
          <div className="panel">
            <h3>Cierres de la semana ({resumen.filas.length} agente{resumen.filas.length === 1 ? "" : "s"})</h3>
            {resumen.filas.length === 0 ? (
              <div className="muted">Sin cierres cargados para este club en esta semana.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Agente</th><th>Resultado</th><th>Rake total</th><th>% Rakeback</th>
                      <th>Rakeback agente</th><th>Rebate</th><th>Ganancia por rake</th><th>Cierre final agente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.filas.map((f: any) => (
                      <tr key={f.agentId}>
                        <td>{f.agentName}</td>
                        <td>{usd(f.resultado)}</td>
                        <td>{usd(f.rakeTotal)}</td>
                        <td className="muted">{pct(f.rakebackPct)}</td>
                        <td>{usd(f.rakebackAgente)}</td>
                        <td className="muted">{f.rebate !== 0 ? usd(f.rebate) : "-"}</td>
                        <td>{usd(f.gananciaPorRake)}</td>
                        <td><span className={`badge ${Number(f.cierreFinalAgente) >= 0 ? "pos" : "neg"}`}>{usd(f.cierreFinalAgente)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="topbar" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Resumen del club — {resumen.clubName}</h3>
              {!editandoExtras && (
                <button className="btn secondary small" onClick={() => setEditandoExtras(true)}>
                  Cargar Rodeo / Ventas
                </button>
              )}
            </div>
            <table>
              <tbody>
                <tr><td>Rake total</td><td>{usd(resumen.rakeTotal)}</td></tr>
                <tr><td>Comisiones / rakeback agentes</td><td>{usd(resumen.comisionesAgentes)}</td></tr>
                {resumen.rebateTotal !== 0 && <tr><td>Rebate total</td><td>{usd(resumen.rebateTotal)}</td></tr>}
                <tr><td><strong>Ganancia por rake</strong></td><td><strong>{usd(resumen.gananciaPorRake)}</strong></td></tr>
                <tr>
                  <td>Ganancia Rodeo Club</td>
                  <td>
                    {editandoExtras ? (
                      <input type="number" step="0.01" value={rodeoInput} onChange={(e) => setRodeoInput(e.target.value)} style={{ width: 120 }} />
                    ) : (
                      usd(resumen.gananciaRodeoClub)
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Ingreso por ventas</td>
                  <td>
                    {editandoExtras ? (
                      <input type="number" step="0.01" value={ventasInput} onChange={(e) => setVentasInput(e.target.value)} style={{ width: 120 }} />
                    ) : (
                      usd(resumen.ingresoPorVentas)
                    )}
                  </td>
                </tr>
                {resumen.tasaSemanalFija !== 0 && <tr><td>Tasa semanal fija</td><td>{usd(resumen.tasaSemanalFija)}</td></tr>}
                {editandoExtras && (
                  <tr>
                    <td>Observaciones</td>
                    <td><input type="text" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} style={{ width: 220 }} /></td>
                  </tr>
                )}
                <tr className="panel" style={{ background: "rgba(120,200,120,0.08)" }}>
                  <td><strong>GANANCIA NETA</strong></td>
                  <td><strong className={Number(resumen.gananciaNeta) >= 0 ? "pos" : "neg"}>{usd(resumen.gananciaNeta)}</strong></td>
                </tr>
                <tr><td>Cierre total agentes</td><td>{usd(resumen.cierreTotalAgentes)}</td></tr>
              </tbody>
            </table>
            {editandoExtras && (
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button className="btn small" disabled={guardando} onClick={guardarExtras}>
                  {guardando ? "Guardando..." : "Guardar"}
                </button>
                <button className="btn secondary small" onClick={() => setEditandoExtras(false)}>Cancelar</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
