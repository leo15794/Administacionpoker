import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";

/**
 * "Resumen por club" — reproduce el bloque "RESUMEN DEL CLUB" de la planilla "automatizacion
 * clubes" (una pestana RESUMEN_TB/RESUMEN_FENIX/RESUMEN_GG/RESUMEN_FENIX_GG por club),
 * confirmado formula por formula contra esa planilla el 14/09/2026. Muestra el desglose por
 * agente de la semana elegida y, debajo, el total del club (ganancia por rake + los dos datos
 * externos que no salen de ningun cierre — Ganancia Rodeo Club e Ingreso por ventas — mas el
 * fee fijo semanal del club si tiene, ej. Tasa semanal GG).
 */
export default function ResumenClub() {
  const { alertDialog } = useConfirmDialog();
  // Deep-link desde Resumen financiero (fila de "Cierre semanal" → ver el desglose):
  // ?club=<clubId>&week=<weekStart> — precarga ese club y esa semana en vez de los defaults
  // (primer club de la lista / semana más reciente).
  const [searchParams] = useSearchParams();
  const clubObjetivo = searchParams.get("club");
  const weekObjetivo = searchParams.get("week");
  const [clubes, setClubes] = useState<any[]>([]);
  const [clubId, setClubId] = useState("");
  const [semanas, setSemanas] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [resumen, setResumen] = useState<any>(null);
  const [error, setError] = useState("");
  const [editandoExtras, setEditandoExtras] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [ventasInput, setVentasInput] = useState("0");
  const [observaciones, setObservaciones] = useState("");

  useEffect(() => {
    api.clubes().then((cs: any[]) => {
      setClubes(cs);
      if (clubObjetivo && cs.some((c) => c.id === clubObjetivo)) setClubId(clubObjetivo);
      else if (cs.length > 0) setClubId(cs[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!clubId) return;
    api.semanasResumenClub(clubId).then((s: any[]) => {
      setSemanas(s);
      if (weekObjetivo && s.some((sem) => sem.week_start === weekObjetivo)) setWeekStart(weekObjetivo);
      else setWeekStart(s[0]?.week_start ?? "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        ingresoPorVentas: Number(ventasInput) || 0,
        observaciones: observaciones || undefined,
      });
      const r = await api.resumenClub(clubId, weekStart);
      setResumen(r);
      setEditandoExtras(false);
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo guardar.");
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
                {resumen.clubFamily === "SUPREMA" ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Agente</th><th>Jugadores</th><th>Resultado</th><th>Ring Game</th><th>MTT</th><th>SNG</th>
                        <th>Rake total</th><th>% Rakeback</th><th>Comisión agente</th><th>Comisión plataforma</th>
                        <th>Ganancia por rake</th><th>Rodeo agente</th><th>Cierre final agente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumen.filas.map((f: any) => (
                        <tr key={f.agentId}>
                          <td>{f.agentName}</td>
                          <td className="muted">{f.jugadores ?? "-"}</td>
                          <td>{usd(f.resultado)}</td>
                          <td className="muted">{f.ringGame !== null ? usd(f.ringGame) : "-"}</td>
                          <td className="muted">{f.mtt !== null ? usd(f.mtt) : "-"}</td>
                          <td className="muted">{f.sng !== null ? usd(f.sng) : "-"}</td>
                          <td>{usd(f.rakeTotal)}</td>
                          <td className="muted">{pct(f.rakebackPct)}</td>
                          <td>{usd(f.rakebackAgente)}</td>
                          <td className="muted">{usd(f.comisionPlataforma)}</td>
                          <td>{usd(f.gananciaPorRake)}</td>
                          <td className="muted">{f.rodeoAgente !== 0 ? usd(f.rodeoAgente) : "-"}</td>
                          <td><span className={`badge ${Number(f.cierreFinalAgente) >= 0 ? "pos" : "neg"}`}>{usd(f.cierreFinalAgente)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Agente</th><th>Resultado</th><th>Rake total</th><th>% Rakeback</th>
                        <th>Rakeback agente</th><th>Comisión plataforma</th><th>Rebate</th><th>Ganancia por rake</th><th>Cierre final agente</th>
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
                          <td className="muted">{usd(f.comisionPlataforma)}</td>
                          <td className="muted">{f.rebate !== 0 ? usd(f.rebate) : "-"}</td>
                          <td>{usd(f.gananciaPorRake)}</td>
                          <td><span className={`badge ${Number(f.cierreFinalAgente) >= 0 ? "pos" : "neg"}`}>{usd(f.cierreFinalAgente)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="topbar" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Resumen del club — {resumen.clubName}</h3>
              {!editandoExtras && (
                <button className="btn secondary small" onClick={() => setEditandoExtras(true)}>
                  Cargar Ingreso por ventas
                </button>
              )}
            </div>
            <div className="muted" style={{ marginBottom: 12 }}>
              Cómo se arma la Ganancia Neta de esta semana: todo lo que sumó menos todo lo que restó. La "Comisión del
              club/plataforma" no entra en ninguna de las dos columnas porque nunca fue plata nuestra — es la parte del
              rake que se queda el club, no algo que ganamos ni que perdimos.
            </div>
            {(() => {
              // gananciaPorRake ya viene neto (rake*ratio - rakeback) sumado de todos los agentes —
              // se reconstruye la parte bruta (rake*ratio, "nuestra parte del rake") sumándole de
              // vuelta el rakeback, así se puede mostrar cada lado por separado sin duplicar nada.
              const nuestraParteDelRake = Number(resumen.gananciaPorRake) + Number(resumen.comisionesAgentes);
              const ingresos: { label: string; monto: number }[] = [
                { label: "Rake generado — nuestra parte", monto: nuestraParteDelRake },
              ];
              if (Number(resumen.gananciaRodeoClub) !== 0) ingresos.push({ label: "Ganancia Rodeo Club", monto: Number(resumen.gananciaRodeoClub) });
              if (Number(resumen.ingresoPorVentas) !== 0) ingresos.push({ label: "Ingreso por ventas", monto: Number(resumen.ingresoPorVentas) });
              if (Number(resumen.tasaSemanalFija) > 0) ingresos.push({ label: "Tasa semanal fija", monto: Number(resumen.tasaSemanalFija) });

              const egresos: { label: string; monto: number }[] = [
                { label: "Rakeback pagado a agentes", monto: Number(resumen.comisionesAgentes) },
              ];
              if (Number(resumen.tasaSemanalFija) < 0) egresos.push({ label: "Tasa semanal fija", monto: Math.abs(Number(resumen.tasaSemanalFija)) });

              const totalIngresos = ingresos.reduce((s, f) => s + f.monto, 0);
              const totalEgresos = egresos.reduce((s, f) => s + f.monto, 0);

              return (
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 12 }}>
                  <div style={{ flex: "1 1 280px" }}>
                    <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>Qué nos hizo ganar</div>
                    <table>
                      <tbody>
                        {ingresos.map((f) => (
                          <tr key={f.label}><td>{f.label}</td><td className="pos">{usd(f.monto)}</td></tr>
                        ))}
                        <tr><td><strong>Total ingresos</strong></td><td className="pos"><strong>{usd(totalIngresos)}</strong></td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div style={{ flex: "1 1 280px" }}>
                    <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>Qué nos hizo perder</div>
                    <table>
                      <tbody>
                        {egresos.map((f) => (
                          <tr key={f.label}><td>{f.label}</td><td className="neg">{usd(f.monto)}</td></tr>
                        ))}
                        <tr><td><strong>Total egresos</strong></td><td className="neg"><strong>{usd(totalEgresos)}</strong></td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
            {resumen.rebateTotal !== 0 && (
              <div className="muted" style={{ marginBottom: 10 }}>
                Rebate total de la semana: {usd(resumen.rebateTotal)} — informativo, no está restado de la Ganancia Neta de abajo.
              </div>
            )}
            {resumen.rodeoPagadoAgentes !== 0 && (
              <div className="muted" style={{ marginBottom: 10 }}>
                Rodeo pagado a agentes: {usd(resumen.rodeoPagadoAgentes)} — ya incluido en el cierre final de cada agente, no es un costo aparte del club.
              </div>
            )}
            {editandoExtras && (
              <table style={{ marginBottom: 10 }}>
                <tbody>
                  <tr>
                    <td>Ingreso por ventas</td>
                    <td><input type="number" step="0.01" value={ventasInput} onChange={(e) => setVentasInput(e.target.value)} style={{ width: 120 }} /></td>
                  </tr>
                  <tr>
                    <td>Observaciones</td>
                    <td><input type="text" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} style={{ width: 220 }} /></td>
                  </tr>
                </tbody>
              </table>
            )}
            <table>
              <tbody>
                <tr className="panel" style={{ background: "rgba(120,200,120,0.08)" }}>
                  <td><strong>GANANCIA NETA (ingresos − egresos)</strong></td>
                  <td><strong className={Number(resumen.gananciaNeta) >= 0 ? "pos" : "neg"}>{usd(resumen.gananciaNeta)}</strong></td>
                </tr>
                <tr><td className="muted">Comisión del club/plataforma (no es nuestra, no suma ni resta)</td><td className="muted">{usd(resumen.comisionPlataformaTotal)}</td></tr>
                <tr><td className="muted">Cierre total agentes</td><td className="muted">{usd(resumen.cierreTotalAgentes)}</td></tr>
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
