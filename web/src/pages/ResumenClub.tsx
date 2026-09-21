import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";
import { ClubPicker } from "../components/ClubPicker";

/**
 * "Resumen por club" — reproduce el bloque "RESUMEN DEL CLUB" de la planilla "automatizacion
 * clubes" (una pestana RESUMEN_TB/RESUMEN_FENIX/RESUMEN_GG/RESUMEN_FENIX_GG por club),
 * confirmado formula por formula contra esa planilla el 14/09/2026. Muestra el desglose por
 * agente de la semana elegida y, debajo, el total del club (ganancia por rake + los dos datos
 * externos que no salen de ningun cierre — Ganancia Rodeo Club e Ingreso por ventas — mas el
 * fee fijo semanal del club si tiene, ej. Tasa semanal GG).
 */

// Exporta el desglose completo de "Resumen por club" a PDF: por-agente + resumen del club +
// (si es Tiny) el panel de conciliacion Settlement/Rake share, para poder comparar a mano
// contra el cierre que nos manda el club/plataforma y encontrar diferencias.
async function generarPdfResumenClub(resumen: any, tinyExtra: any | null) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const margen = 14;
  let y = 18;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(
    `${resumen.clubName} · Resumen semanal ${dateShort(resumen.weekStart)} - ${dateShort(resumen.weekEnd ?? resumen.weekStart)}`,
    margen,
    y
  );
  y += 9;

  // Tabla por agente (mismas columnas que se ven en pantalla segun la familia del club)
  if (resumen.filas.length > 0) {
    if (resumen.clubFamily === "SUPREMA") {
      autoTable(doc, {
        startY: y,
        margin: { left: margen, right: margen },
        head: [["Agente", "Jugadores", "Resultado", "Rake total", "% RB", "Com. agente", "Com. plataforma", "Ganancia rake", "Cierre final"]],
        body: resumen.filas.map((f: any) => [
          f.agentName,
          f.jugadores ?? "-",
          usd(f.resultado),
          usd(f.rakeTotal),
          pct(f.rakebackPct),
          usd(f.rakebackAgente),
          usd(f.comisionPlataforma),
          usd(f.gananciaPorRake),
          usd(f.cierreFinalAgente),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [40, 50, 90] },
      });
    } else {
      autoTable(doc, {
        startY: y,
        margin: { left: margen, right: margen },
        head: [["Agente", "Resultado", "Rake total", "% RB", "Rakeback agente", "Com. plataforma", "Rebate", "Ganancia rake", "Cierre final"]],
        body: resumen.filas.map((f: any) => [
          f.agentName,
          usd(f.resultado),
          usd(f.rakeTotal),
          pct(f.rakebackPct),
          usd(f.rakebackAgente),
          usd(f.comisionPlataforma),
          f.rebate !== 0 ? usd(f.rebate) : "-",
          usd(f.gananciaPorRake),
          usd(f.cierreFinalAgente),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [40, 50, 90] },
      });
    }
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  // Resumen del club: mismo desglose ingresos/egresos + tabla final que se ve en pantalla
  const nuestraParteDelRake = Number(resumen.gananciaPorRake) + Number(resumen.comisionesAgentes);
  const ingresos: { label: string; monto: number }[] = [
    { label: "Rake generado — nuestra parte", monto: nuestraParteDelRake },
  ];
  if (Number(resumen.gananciaRodeoClub) !== 0) ingresos.push({ label: "Ganancia Rodeo Club", monto: Number(resumen.gananciaRodeoClub) });
  if (Number(resumen.ingresoPorVentas) !== 0) ingresos.push({ label: "Ajuste manual Promociones", monto: Number(resumen.ingresoPorVentas) });
  if (Number(resumen.tasaSemanalFija) > 0) ingresos.push({ label: "Tasa semanal fija", monto: Number(resumen.tasaSemanalFija) });
  const egresos: { label: string; monto: number }[] = [
    { label: "Rakeback pagado a agentes", monto: Number(resumen.comisionesAgentes) },
  ];
  if (Number(resumen.tasaSemanalFija) < 0) egresos.push({ label: "Tasa semanal fija", monto: Math.abs(Number(resumen.tasaSemanalFija)) });

  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Resumen del club", margen, y);
  y += 7;

  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Qué nos hizo ganar", "Monto"]],
    body: [...ingresos.map((f) => [f.label, usd(f.monto)]), ["TOTAL INGRESOS", usd(ingresos.reduce((s, f) => s + f.monto, 0))]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 120, 60] },
    tableWidth: 90,
  });
  const yIngresos = (doc as any).lastAutoTable.finalY;

  autoTable(doc, {
    startY: y,
    margin: { left: margen + 96, right: margen },
    head: [["Qué nos hizo perder", "Monto"]],
    body: [...egresos.map((f) => [f.label, usd(f.monto)]), ["TOTAL EGRESOS", usd(egresos.reduce((s, f) => s + f.monto, 0))]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [150, 40, 40] },
    tableWidth: 90,
  });
  const yEgresos = (doc as any).lastAutoTable.finalY;

  y = Math.max(yIngresos, yEgresos) + 10;

  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    body: [
      ["GANANCIA NETA (ingresos − egresos)", usd(resumen.gananciaNeta)],
      ["Agentes", String(resumen.agentesConCierre)],
      ["Jugadores", resumen.jugadoresTotal ?? "-"],
      ["Resultado", usd(resumen.resultadoTotal)],
      ["Rake total generado por el club", usd(resumen.rakeTotal)],
      ["Comisiones agentes (rakeback pagado)", usd(resumen.comisionesAgentes)],
      ["Comisión del club/plataforma (no es nuestra)", usd(resumen.comisionPlataformaTotal)],
      ["Ventas/VIP", usd(resumen.ajusteManualTotal)],
      ["Ajuste manual Promociones", usd(resumen.ingresoPorVentas)],
      ["Tasa semanal fija (Tasas)", usd(resumen.tasaSemanalFija)],
      ["Cierre total agentes", usd(resumen.cierreTotalAgentes)],
    ],
    styles: { fontSize: 9 },
    didParseCell: (data: any) => {
      if (data.row.index === 0) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [230, 245, 230];
      }
    },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  // Panel Tiny: la parte pensada especificamente para comparar contra el cierre que nos manda
  // Tiny/GG y detectar si liquidaron bien -- se resalta Settlement, USDT y la diferencia.
  if (resumen.clubFamily === "TINY") {
    if (y > 240) { doc.addPage(); y = 18; }
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("Tiny · Cierre semanal (conciliación contra Tiny/GG)", margen, y);
    y += 7;

    if (!tinyExtra) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("Sin datos de Rebate Union/Settlement guardados para esta semana todavía.", margen, y);
      y += 8;
    } else {
      autoTable(doc, {
        startY: y,
        margin: { left: margen, right: margen },
        body: [
          ["Agentes", String(tinyExtra.agentesConCierre)],
          ["Jugadores", tinyExtra.jugadoresTotal ?? "-"],
          ["Resultado Tiny", usd(tinyExtra.resultadoTiny)],
          ["Rake Tiny", usd(tinyExtra.rakeTiny)],
          ["BBJ Contribution", usd(tinyExtra.bbjContribution)],
          ["Base rebate global", tinyExtra.baseRebateGlobal == null ? "-" : usd(tinyExtra.baseRebateGlobal)],
          ["Rebate global", usd(tinyExtra.rebateGlobal)],
          ["Rake share (Tiny)", usd(tinyExtra.rakeShareTotal)],
          ["Settlement Tiny", usd(tinyExtra.settlementTiny)],
          ["Rate semanal", tinyExtra.rateSemanal ?? "-"],
          ["Settlement USDT", usd(tinyExtra.settlementUsdt)],
          ["Cierre agentes USDT", usd(tinyExtra.cierreAgentesUsdt)],
          ["Ganancia nuestra USDT", usd(tinyExtra.gananciaNuestraUsdt)],
          [
            "Weekly Settlement oficial (Tiny)",
            tinyExtra.weeklySettlementOficialTotal == null ? "Sin dato oficial de Tiny" : usd(tinyExtra.weeklySettlementOficialTotal),
          ],
          [
            "Diferencia cierre Tiny (nuestro Settlement − oficial)",
            tinyExtra.diferenciaCierreTiny == null ? "Sin dato oficial de Tiny" : usd(tinyExtra.diferenciaCierreTiny),
          ],
          ["Estado control", tinyExtra.estadoControl === "SIN_DATO" ? "Sin dato" : tinyExtra.estadoControl],
        ],
        styles: { fontSize: 9 },
        didParseCell: (data: any) => {
          if (data.row.index === 8 || data.row.index === 10 || data.row.index >= 13) {
            data.cell.styles.fontStyle = "bold";
          }
          if (data.row.index === 14) {
            const estado = tinyExtra.estadoControl;
            data.cell.styles.fillColor = estado === "OK" ? [220, 245, 220] : estado === "REVISAR" ? [250, 220, 220] : [235, 235, 235];
          }
        },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Generado ${dateShort(new Date().toISOString().slice(0, 10))}`, margen, 290);
  doc.setTextColor(0);

  const nombreArchivo = `resumen-club_${resumen.clubName.replace(/[^a-z0-9]+/gi, "-")}_${resumen.weekStart}.pdf`;
  doc.save(nombreArchivo);
}

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
  // Resumen extra de Tiny GG (18/09/2026): Settlement/Rebate Union/Rake share -- ver
  // repo/tinyResumen.ts. Solo se pide (y se muestra) cuando el club es de familia TINY.
  const [tinyExtra, setTinyExtra] = useState<any>(null);
  const [generandoPdf, setGenerandoPdf] = useState(false);

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
    setTinyExtra(null);
    api
      .resumenClub(clubId, weekStart)
      .then((r: any) => {
        setResumen(r);
        setVentasInput(String(r.ingresoPorVentas));
        if (r.clubFamily === "TINY") {
          api.resumenTinyExtra(clubId, weekStart).then(setTinyExtra).catch(() => setTinyExtra(null));
        }
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
      <div className="topbar" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Resumen por club</h2>
      </div>
      <div style={{ display: "flex", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
        <ClubPicker clubes={clubes} value={clubId} onChange={setClubId} />
        <div className="field" style={{ margin: 0, minWidth: 240 }}>
          <label>Semana</label>
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
          <div className="topbar" style={{ marginBottom: 10 }}>
            <div />
            <button
              className="btn secondary small"
              disabled={generandoPdf}
              onClick={async () => {
                setGenerandoPdf(true);
                try {
                  await generarPdfResumenClub(resumen, tinyExtra);
                } catch (err: any) {
                  await alertDialog(err.message || "No se pudo generar el PDF.");
                } finally {
                  setGenerandoPdf(false);
                }
              }}
              title="Exporta este resumen a PDF para comparar contra el cierre que nos manda el club/plataforma"
            >
              {generandoPdf ? "Generando..." : "Descargar PDF"}
            </button>
          </div>
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
                  Cargar Ajuste manual Promociones
                </button>
              )}
            </div>
            {resumen.clubFamily === "TINY" ? (
              <div className="muted" style={{ marginBottom: 12 }}>
                Tiny no reparte un % fijo del rake como los demás clubes: la Ganancia Neta de abajo sale del Settlement
                (lo que nos liquida la Unión/GG) menos lo que le pagamos a los agentes — ver el desglose completo en el
                panel "Tiny · Cierre semanal" más abajo.
              </div>
            ) : (
              <div className="muted" style={{ marginBottom: 12 }}>
                Cómo se arma la Ganancia Neta de esta semana: todo lo que sumó menos todo lo que restó. La "Comisión del
                club/plataforma" no entra en ninguna de las dos columnas porque nunca fue plata nuestra — es la parte del
                rake que se queda el club, no algo que ganamos ni que perdimos.
              </div>
            )}
            {resumen.clubFamily !== "TINY" && (() => {
              // gananciaPorRake ya viene neto (rake*ratio - rakeback) sumado de todos los agentes —
              // se reconstruye la parte bruta (rake*ratio, "nuestra parte del rake") sumándole de
              // vuelta el rakeback, así se puede mostrar cada lado por separado sin duplicar nada.
              const nuestraParteDelRake = Number(resumen.gananciaPorRake) + Number(resumen.comisionesAgentes);
              const ingresos: { label: string; monto: number }[] = [
                { label: "Rake generado — nuestra parte", monto: nuestraParteDelRake },
              ];
              if (Number(resumen.gananciaRodeoClub) !== 0) ingresos.push({ label: "Ganancia Rodeo Club", monto: Number(resumen.gananciaRodeoClub) });
              if (Number(resumen.ingresoPorVentas) !== 0) ingresos.push({ label: "Ajuste manual Promociones", monto: Number(resumen.ingresoPorVentas) });
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
                          <tr key={f.label}><td>{f.label}</td><td className={f.monto >= 0 ? "pos" : "neg"}>{usd(f.monto)}</td></tr>
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
                          <tr key={f.label}><td>{f.label}</td><td className={f.monto >= 0 ? "neg" : "pos"}>{usd(f.monto)}</td></tr>
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
                    <td>Ajuste manual Promociones</td>
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
                <tr><td className="muted">Agentes</td><td className="muted">{resumen.agentesConCierre}</td></tr>
                <tr><td className="muted">Jugadores</td><td className="muted">{resumen.jugadoresTotal ?? "-"}</td></tr>
                <tr><td className="muted">Resultado</td><td className={Number(resumen.resultadoTotal) >= 0 ? "pos" : "neg"}>{usd(resumen.resultadoTotal)}</td></tr>
                <tr><td className="muted">Rake total generado por el club</td><td className={Number(resumen.rakeTotal) >= 0 ? "pos" : "neg"}>{usd(resumen.rakeTotal)}</td></tr>
                <tr><td className="muted">Comisiones agentes (rakeback pagado)</td><td className={Number(resumen.comisionesAgentes) >= 0 ? "pos" : "neg"}>{usd(resumen.comisionesAgentes)}</td></tr>
                <tr><td className="muted">Comisión del club/plataforma (no es nuestra, no suma ni resta)</td><td className={Number(resumen.comisionPlataformaTotal) >= 0 ? "pos" : "neg"}>{usd(resumen.comisionPlataformaTotal)}</td></tr>
                <tr>
                  <td className="muted">Ventas/VIP</td>
                  <td className={Number(resumen.ajusteManualTotal) === 0 ? "muted" : Number(resumen.ajusteManualTotal) >= 0 ? "pos" : "neg"}>
                    {usd(resumen.ajusteManualTotal)}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Ajuste manual Promociones</td>
                  <td className={Number(resumen.ingresoPorVentas) === 0 ? "muted" : Number(resumen.ingresoPorVentas) >= 0 ? "pos" : "neg"}>
                    {usd(resumen.ingresoPorVentas)}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Tasa semanal fija (Tasas)</td>
                  <td className={Number(resumen.tasaSemanalFija) === 0 ? "muted" : Number(resumen.tasaSemanalFija) >= 0 ? "pos" : "neg"}>
                    {usd(resumen.tasaSemanalFija)}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Cierre total agentes</td>
                  <td className={Number(resumen.cierreTotalAgentes) >= 0 ? "pos" : "neg"}>{usd(resumen.cierreTotalAgentes)}</td>
                </tr>
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

          {resumen.clubFamily === "TINY" && (
            <div className="panel">
              <h3>Tiny · Cierre semanal</h3>
              <div className="muted" style={{ marginBottom: 12 }}>
                A diferencia de los demas clubes, la ganancia de Tiny no sale de un % fijo sobre el rake: sale de la
                diferencia entre lo que la Union/GG nos liquida a nosotros (Settlement) y lo que nosotros les pagamos a
                los agentes (Cierre agentes).
              </div>
              {!tinyExtra ? (
                <div className="muted">Sin datos de Rebate Union/Settlement guardados para esta semana todavia.</div>
              ) : (
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 320px" }}>
                    <table>
                      <tbody>
                        <tr><td className="muted">Agentes</td><td className="muted">{tinyExtra.agentesConCierre}</td></tr>
                        <tr><td className="muted">Jugadores</td><td className="muted">{tinyExtra.jugadoresTotal ?? "-"}</td></tr>
                        <tr>
                          <td className="muted">Resultado Tiny</td>
                          <td className={Number(tinyExtra.resultadoTiny) >= 0 ? "pos" : "neg"}>{usd(tinyExtra.resultadoTiny)}</td>
                        </tr>
                        <tr><td className="muted">Rake Tiny</td><td className={Number(tinyExtra.rakeTiny) >= 0 ? "pos" : "neg"}>{usd(tinyExtra.rakeTiny)}</td></tr>
                        <tr><td className="muted">BBJ Contribution</td><td className="muted">{usd(tinyExtra.bbjContribution)}</td></tr>
                        <tr>
                          <td className="muted">Base rebate global</td>
                          <td className={tinyExtra.baseRebateGlobal == null ? "muted" : Number(tinyExtra.baseRebateGlobal) >= 0 ? "pos" : "neg"}>
                            {tinyExtra.baseRebateGlobal == null ? "-" : usd(tinyExtra.baseRebateGlobal)}
                          </td>
                        </tr>
                        <tr><td className="muted">Rebate global</td><td className="pos">{usd(tinyExtra.rebateGlobal)}</td></tr>
                        <tr><td className="muted">Rake share (Tiny)</td><td className="pos">{usd(tinyExtra.rakeShareTotal)}</td></tr>
                        <tr>
                          <td><strong>Settlement Tiny</strong></td>
                          <td><strong className={Number(tinyExtra.settlementTiny) >= 0 ? "pos" : "neg"}>{usd(tinyExtra.settlementTiny)}</strong></td>
                        </tr>
                        <tr><td className="muted">Rate semanal</td><td className="muted">{tinyExtra.rateSemanal ?? "-"}</td></tr>
                        <tr>
                          <td><strong>Settlement USDT</strong></td>
                          <td><strong className={Number(tinyExtra.settlementUsdt) >= 0 ? "pos" : "neg"}>{usd(tinyExtra.settlementUsdt)}</strong></td>
                        </tr>
                        <tr><td className="muted">USDT absoluto</td><td className="muted">{usd(Math.abs(Number(tinyExtra.settlementUsdt)))}</td></tr>
                        <tr>
                          <td className="muted">Movimiento</td>
                          <td className="muted">{Number(tinyExtra.settlementUsdt) < 0 ? "Pagar a Tiny" : "Tiny nos paga"}</td>
                        </tr>
                        <tr>
                          <td className="muted">Diferencia cierre Tiny</td>
                          <td className={tinyExtra.diferenciaCierreTiny == null ? "muted" : Math.abs(tinyExtra.diferenciaCierreTiny) < 0.01 ? "muted" : "neg"}>
                            {tinyExtra.diferenciaCierreTiny == null ? "Sin dato oficial de Tiny" : usd(tinyExtra.diferenciaCierreTiny)}
                          </td>
                        </tr>
                        <tr>
                          <td><strong>Estado control</strong></td>
                          <td>
                            <span className={`badge ${tinyExtra.estadoControl === "OK" ? "pos" : tinyExtra.estadoControl === "REVISAR" ? "neg" : "neutral"}`}>
                              {tinyExtra.estadoControl === "SIN_DATO" ? "Sin dato" : tinyExtra.estadoControl}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div style={{ flex: "1 1 320px" }}>
                    <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>Resumen Tiny</div>
                    <table>
                      <tbody>
                        <tr><td className="muted">Semana activa</td><td className="muted">{dateShort(resumen.weekStart)} al {dateShort(resumen.weekEnd ?? resumen.weekStart)}</td></tr>
                        <tr><td className="muted">Rate semanal</td><td className="muted">{tinyExtra.rateSemanal ?? "-"}</td></tr>
                        <tr><td className="muted">Settlement Tiny</td><td className={Number(tinyExtra.settlementTiny) >= 0 ? "pos" : "neg"}>{usd(tinyExtra.settlementTiny)}</td></tr>
                        <tr><td className="muted">Settlement USDT</td><td className={Number(tinyExtra.settlementUsdt) >= 0 ? "pos" : "neg"}>{usd(tinyExtra.settlementUsdt)}</td></tr>
                        <tr><td className="muted">Rebate plataforma USDT</td><td className="pos">{tinyExtra.rateSemanal ? usd(tinyExtra.rebateGlobal / tinyExtra.rateSemanal) : "-"}</td></tr>
                        <tr><td className="muted">Rake share plataforma USDT</td><td className="pos">{tinyExtra.rateSemanal ? usd(tinyExtra.rakeShareTotal / tinyExtra.rateSemanal) : "-"}</td></tr>
                        <tr><td className="muted">Cierre agentes USDT</td><td className={Number(tinyExtra.cierreAgentesUsdt) >= 0 ? "pos" : "neg"}>{usd(tinyExtra.cierreAgentesUsdt)}</td></tr>
                        <tr>
                          <td><strong>Ganancia nuestra USDT</strong></td>
                          <td><strong className={Number(tinyExtra.gananciaNuestraUsdt) >= 0 ? "pos" : "neg"}>{usd(tinyExtra.gananciaNuestraUsdt)}</strong></td>
                        </tr>
                        <tr>
                          <td className="muted">Control conciliación</td>
                          <td className={tinyExtra.diferenciaCierreTiny == null ? "muted" : Math.abs(tinyExtra.diferenciaCierreTiny) < 0.01 ? "muted" : "neg"}>
                            {tinyExtra.diferenciaCierreTiny == null ? "-" : usd(tinyExtra.diferenciaCierreTiny)}
                          </td>
                        </tr>
                        <tr>
                          <td className="muted">Estado</td>
                          <td>
                            <span className={`badge ${tinyExtra.estadoControl === "OK" ? "pos" : tinyExtra.estadoControl === "REVISAR" ? "neg" : "neutral"}`}>
                              {tinyExtra.estadoControl === "SIN_DATO" ? "Sin dato" : tinyExtra.estadoControl}
                            </span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
