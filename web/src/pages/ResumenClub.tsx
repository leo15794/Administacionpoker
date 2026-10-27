import { Fragment, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { cargarLibreriasPdf } from "../pdfLibs";
import { usd, usdCents, pct, dateShort } from "../fmt";
import ActionsMenu from "../components/ActionsMenu";
import { useConfirmDialog } from "../components/ConfirmProvider";
import { ClubPicker } from "../components/ClubPicker";
import Ayuda from "../components/Ayuda";
import Cifra from "../components/Cifra";

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
  const { jsPDF, autoTable } = await cargarLibreriasPdf();
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
      const guardado = await api.guardarExtrasResumenClub({
        clubId: resumen.clubId,
        weekStart: resumen.weekStart,
        weekEnd: resumen.weekEnd ?? resumen.weekStart,
        ingresoPorVentas: Number(ventasInput) || 0,
        observaciones: observaciones || undefined,
      });
      const r = await api.resumenClub(clubId, weekStart);
      setResumen(r);
      setEditandoExtras(false);
      // Auto-cierre de proveedores (22/09/2026): si este club tiene algún proveedor asociado,
      // guardar acá también dispara solo su cierre semanal -- se avisa para que quede claro
      // que ya quedó todo cerrado, sin tener que ir a la pestaña Proveedores a confirmarlo.
      const cerrados = (guardado?.proveedoresCerrados ?? []).filter((p: any) => p.applied);
      if (cerrados.length > 0) {
        await alertDialog(
          `Resumen guardado. También se aplicó solo el cierre de proveedor: ${cerrados
            .map((p: any) => `${p.proveedorName} (${usd(p.cierre)})`)
            .join(", ")}.`
        );
      }
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  // ---- Pantalla (19/10/2026, mockup aprobado): ganancia neta arriba, agentes ordenados, detalle plegable ----
  const [verSinMov, setVerSinMov] = useState(false);
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [agentesAbiertos, setAgentesAbiertos] = useState<Set<string>>(new Set());
  function toggleAgenteRc(id: string) {
    setAgentesAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const diaMesRc = (s: string) => {
    const [, m, d] = String(s).slice(0, 10).split("-");
    return `${d}/${m}`;
  };
  const cls = (n: number) => (n > 0.004 ? "pos" : n < -0.004 ? "neg" : "neutral");
  const usdSigno = (n: number) => `${n < -0.004 ? "−" : ""}${usd(Math.abs(n))}`;
  const nuestraParteRc = resumen ? Number(resumen.gananciaPorRake) + Number(resumen.comisionesAgentes) : 0;
  const ingresosRc: { label: string; monto: number }[] = [];
  const egresosRc: { label: string; monto: number }[] = [];
  if (resumen) {
    // gananciaPorRake ya viene neto (rake*ratio - rakeback) sumado de todos los agentes —
    // se reconstruye la parte bruta (rake*ratio, "nuestra parte del rake") sumándole de
    // vuelta el rakeback, así se puede mostrar cada lado por separado sin duplicar nada.
    ingresosRc.push({ label: "Rake generado — nuestra parte", monto: nuestraParteRc });
    if (Number(resumen.gananciaRodeoClub) !== 0) ingresosRc.push({ label: "Ganancia Rodeo Club", monto: Number(resumen.gananciaRodeoClub) });
    if (Number(resumen.ingresoPorVentas) !== 0) ingresosRc.push({ label: "Ajuste manual Promociones", monto: Number(resumen.ingresoPorVentas) });
    if (Number(resumen.tasaSemanalFija) > 0) ingresosRc.push({ label: "Tasa semanal fija", monto: Number(resumen.tasaSemanalFija) });
    egresosRc.push({ label: "Rakeback pagado a agentes", monto: Number(resumen.comisionesAgentes) });
    if (Number(resumen.tasaSemanalFija) < 0) egresosRc.push({ label: "Tasa semanal fija", monto: Math.abs(Number(resumen.tasaSemanalFija)) });
  }
  const totalIngresosRc = ingresosRc.reduce((s, f) => s + f.monto, 0);
  const totalEgresosRc = egresosRc.reduce((s, f) => s + f.monto, 0);
  const sinMov = (f: any) => !(Number(f.rakeTotal) > 0) && Math.abs(Number(f.resultado)) <= 0.005;
  const sinMovimientoRc = resumen ? resumen.filas.filter(sinMov).length : 0;
  const filasRc = resumen
    ? [...resumen.filas]
        .filter((f: any) => verSinMov || !sinMov(f))
        .sort((a: any, b: any) => Math.abs(Number(b.cierreFinalAgente)) - Math.abs(Number(a.cierreFinalAgente)))
    : [];
  // Desglose que antes eran columnas sueltas de la tabla (Ring Game/MTT/SNG/Spin/comisión plataforma/rodeo/rebate).
  const desgloseAgenteRc = (f: any) => (
    <div style={{ display: "flex", gap: 22, flexWrap: "wrap", padding: "6px 2px", fontSize: 13 }}>
      {resumen.clubFamily === "SUPREMA" ? (
        <>
          <span className="muted">Ring Game <b>{f.ringGame !== null ? usd(f.ringGame) : "-"}</b></span>
          <span className="muted">MTT <b>{f.mtt !== null ? usd(f.mtt) : "-"}</b></span>
          <span className="muted">SNG <b>{f.sng !== null ? usd(f.sng) : "-"}</b></span>
          <span className="muted">Spin <b>{f.spin !== null ? usd(f.spin) : "-"}</b></span>
          <span className="muted">Comisión plataforma <b>{usd(f.comisionPlataforma)}</b></span>
          <span className="muted">Rodeo agente <b>{f.rodeoAgente !== 0 ? usd(f.rodeoAgente) : "-"}</b></span>
        </>
      ) : (
        <>
          <span className="muted">Comisión plataforma <b>{usd(f.comisionPlataforma)}</b></span>
          <span className="muted">Rebate <b>{f.rebate !== 0 ? usd(f.rebate) : "-"}</b></span>
        </>
      )}
    </div>
  );

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Resumen por club</h2>
        {resumen && (
          <ActionsMenu
            title="Más acciones"
            items={[
              {
                label: generandoPdf ? "Generando PDF..." : "Descargar PDF",
                disabled: generandoPdf,
                onClick: async () => {
                  setGenerandoPdf(true);
                  try {
                    await generarPdfResumenClub(resumen, tinyExtra);
                  } catch (err: any) {
                    await alertDialog(err.message || "No se pudo generar el PDF.");
                  } finally {
                    setGenerandoPdf(false);
                  }
                },
              },
            ]}
          />
        )}
      </div>

      {clubes.length > 0 && clubes.length <= 8 ? (
        <div className="tb-week-chips" style={{ justifyContent: "flex-start", marginBottom: 8 }}>
          {clubes.map((c) => (
            <button key={c.id} className={`chip${clubId === c.id ? " chip-active" : ""}`} onClick={() => setClubId(c.id)}>{c.name}</button>
          ))}
        </div>
      ) : (
        <div style={{ marginBottom: 8 }}>
          <ClubPicker clubes={clubes} value={clubId} onChange={setClubId} />
        </div>
      )}
      <div className="tb-week-chips" style={{ justifyContent: "flex-start", marginBottom: 14, alignItems: "center" }}>
        {semanas.length === 0 && <span className="muted">Sin cierres cargados</span>}
        {semanas.slice(0, 8).map((s) => (
          <button key={s.week_start} className={`chip${weekStart === s.week_start ? " chip-active" : ""}`} onClick={() => setWeekStart(s.week_start)}>
            {diaMesRc(s.week_start)} – {diaMesRc(s.week_end)}
          </button>
        ))}
        {semanas.length > 8 && (
          <select
            value={semanas.slice(8).some((s) => s.week_start === weekStart) ? weekStart : ""}
            onChange={(e) => e.target.value && setWeekStart(e.target.value)}
            style={{ width: "auto" }}
          >
            <option value="">Anteriores…</option>
            {semanas.slice(8).map((s) => (
              <option key={s.week_start} value={s.week_start}>{diaMesRc(s.week_start)} – {diaMesRc(s.week_end)}</option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {!resumen && !error && <div className="muted">Elegi un club y una semana con cierres cargados.</div>}

      {resumen && (
        <>
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="deals-eyebrow">Ganancia neta · {resumen.clubName}</div>
                <div className={`saldo-big ${cls(Number(resumen.gananciaNeta))}`} style={{ fontSize: 32 }}><Cifra texto={usdCents(Number(resumen.gananciaNeta))} /></div>
                {resumen.clubFamily !== "TINY" && (
                  <div className="saldo-sub">ingresos {usd(totalIngresosRc)} − egresos {usd(totalEgresosRc)} · semana {dateShort(resumen.weekStart)} al {dateShort(resumen.weekEnd ?? resumen.weekStart)}</div>
                )}
              </div>
              {!editandoExtras && (
                <button className="btn secondary small" onClick={() => { setEditandoExtras(true); setDetalleAbierto(true); }}>
                  Cargar ajuste manual Promociones
                </button>
              )}
            </div>
          </div>

          <div className="stat-row">
            <div className="stat-card">
              <div className="l">Rake generado</div>
              <div className="v"><Cifra texto={usd(resumen.rakeTotal)} /></div>
              <div className="s">nuestra parte {usd(nuestraParteRc)}</div>
            </div>
            <div className="stat-card">
              <div className="l">Resultado de mesas</div>
              <div className={`v ${cls(Number(resumen.resultadoTotal))}`}><Cifra texto={usdSigno(Number(resumen.resultadoTotal))} /></div>
              <div className="s">{resumen.jugadoresTotal ?? "-"} jugadores · {resumen.agentesConCierre} agentes</div>
            </div>
            <div className="stat-card">
              <div className="l">Cierre total agentes</div>
              <div className={`v ${cls(Number(resumen.cierreTotalAgentes))}`}><Cifra texto={usdSigno(Number(resumen.cierreTotalAgentes))} /></div>
              <div className="s">lo que se les liquida</div>
            </div>
            <div className="stat-card">
              <div className="l">Rakeback pagado</div>
              <div className="v"><Cifra texto={usd(resumen.comisionesAgentes)} /></div>
              <div className="s">a los agentes</div>
            </div>
          </div>

          {resumen.clubFamily === "TINY" ? (
            <div className="muted" style={{ margin: "0 0 14px" }}>
              Tiny no reparte un % fijo del rake como los demás clubes: la Ganancia Neta sale del Settlement (lo que nos liquida la
              Unión/GG) menos lo que le pagamos a los agentes — ver el desglose completo en el panel "Tiny · Cierre semanal" más abajo.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, marginBottom: 14 }}>
              <div className="panel" style={{ margin: 0, padding: "14px 16px" }}>
                <div className="deals-eyebrow">Qué nos hizo ganar</div>
                {ingresosRc.map((f) => (
                  <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span>{f.label}</span><b className={f.monto >= 0 ? "pos" : "neg"}>{usd(f.monto)}</b>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0" }}><b>Total ingresos</b><b className="pos">{usd(totalIngresosRc)}</b></div>
              </div>
              <div className="panel" style={{ margin: 0, padding: "14px 16px" }}>
                <div className="deals-eyebrow">Qué nos hizo perder</div>
                {egresosRc.map((f) => (
                  <div key={f.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span>{f.label}</span><b className={f.monto >= 0 ? "neg" : "pos"}>{usd(f.monto)}</b>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0 0" }}><b>Total egresos</b><b className="neg">{usd(totalEgresosRc)}</b></div>
                <div className="saldo-sub" style={{ marginTop: 10 }}>
                  La comisión del club/plataforma ({usd(resumen.comisionPlataformaTotal)}) no entra: nunca fue plata nuestra.
                </div>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="ag-toolbar" style={{ marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Cierres de la semana</h3>
              <span className="ag-toolbar-spacer" />
              {sinMovimientoRc > 0 && (
                <label className="switch">
                  <input type="checkbox" checked={verSinMov} onChange={(e) => setVerSinMov(e.target.checked)} />
                  <i />
                  Mostrar los {sinMovimientoRc} sin movimiento
                </label>
              )}
            </div>
            {resumen.filas.length === 0 ? (
              <div className="muted">Sin cierres cargados para este club en esta semana.</div>
            ) : (
              <>
                <div className="ag-table-wrap">
                  <table className="saldos-table">
                    <thead>
                      <tr>
                        <th>Agente</th><th className="num">Resultado</th><th className="num">Rake total</th><th className="num">Rakeback agente</th>
                        <th className="num">Ganancia por rake</th><th className="num">Cierre final</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filasRc.map((f) => {
                        const cierre = Number(f.cierreFinalAgente);
                        const abierto = agentesAbiertos.has(f.agentId);
                        return (
                          <Fragment key={f.agentId}>
                            <tr className={`row-click ${cierre > 0.004 ? "row-pos" : cierre < -0.004 ? "row-neg" : ""}`} onClick={() => toggleAgenteRc(f.agentId)}>
                              <td>
                                <div className="saldo-name">{f.agentName}</div>
                                <div className="saldo-sub">{f.jugadores ?? "-"} jugadores{f.system ? ` · ${f.system === "PREPAGO" ? "Prepago" : "Win/Lose"}` : ""}</div>
                              </td>
                              <td className="num money">{usdSigno(Number(f.resultado))}</td>
                              <td className="num money">{usd(f.rakeTotal)}</td>
                              <td className="num"><b>{usd(f.rakebackAgente)}</b><div className="saldo-sub">{pct(f.rakebackPct)}</div></td>
                              <td className="num money">{usd(f.gananciaPorRake)}</td>
                              <td className="num"><span className={`saldo-big ${cls(cierre)}`}>{usdSigno(cierre)}</span></td>
                              <td style={{ width: 40, textAlign: "right", color: "var(--text-faint)" }}>{abierto ? "▴" : "▾"}</td>
                            </tr>
                            {abierto && (
                              <tr>
                                <td colSpan={7} style={{ background: "var(--panel-2)" }}>{desgloseAgenteRc(f)}</td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="ag-cards">
                  {filasRc.map((f) => {
                    const cierre = Number(f.cierreFinalAgente);
                    const abierto = agentesAbiertos.has(f.agentId);
                    return (
                      <div key={f.agentId} className={`saldo-card ${cierre > 0.004 ? "is-pos" : cierre < -0.004 ? "is-neg" : ""}`} onClick={() => toggleAgenteRc(f.agentId)}>
                        <div className="saldo-card-body">
                          <div className="saldo-card-top">
                            <div className="saldo-name">{f.agentName}</div>
                            <div className={`saldo-big ${cls(cierre)}`}>{usdSigno(cierre)}</div>
                          </div>
                          <div className="saldo-card-mid">
                            <div className="saldo-sub">{f.jugadores ?? "-"} jugadores{f.system ? ` · ${f.system === "PREPAGO" ? "Prepago" : "Win/Lose"}` : ""} · {pct(f.rakebackPct)} rakeback</div>
                          </div>
                          <div className="saldo-card-foot" style={{ gap: 14 }}>
                            <span>Resultado <b style={{ color: Number(f.resultado) < 0 ? "var(--red)" : undefined }}>{usdSigno(Number(f.resultado))}</b></span>
                            <span>Rake <b>{usd(f.rakeTotal)}</b></span>
                            <span>Rakeback <b>{usd(f.rakebackAgente)}</b></span>
                          </div>
                          {abierto && <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>{desgloseAgenteRc(f)}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                  Mostrando {filasRc.length} de {resumen.filas.length} · tocá una fila para ver el desglose
                  {resumen.clubFamily === "SUPREMA" ? " (Ring Game, MTT, SNG, Spin, comisión plataforma y rodeo)" : " (comisión plataforma y rebate)"}.
                </div>
              </>
            )}
          </div>

          <div className="panel">
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => setDetalleAbierto((v) => !v)}
            >
              <b>Detalle del cálculo</b>
              <span style={{ color: "var(--text-faint)" }}>{detalleAbierto ? "▴" : "▾"}</span>
            </div>
            {!detalleAbierto && (
              <div className="saldo-sub" style={{ marginTop: 4 }}>
                Ventas/VIP, ajuste manual, cargas de fichas de la semana ({usd(resumen.cargasTesoreriaTotal)}), tasa semanal fija, rodeo pagado ({usd(resumen.rodeoPagadoAgentes)}).
              </div>
            )}
            {detalleAbierto && (
              <div style={{ marginTop: 10 }}>
                {Number(resumen.rebateTotal) !== 0 && (
                  <div className="muted" style={{ marginBottom: 10 }}>
                    Rebate total de la semana: {usd(resumen.rebateTotal)} — informativo, no está restado de la Ganancia Neta.
                  </div>
                )}
                {Number(resumen.rodeoPagadoAgentes) !== 0 && (
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
                    <tr><td className="muted">Agentes</td><td className="num muted">{resumen.agentesConCierre}</td></tr>
                    <tr><td className="muted">Jugadores</td><td className="num muted">{resumen.jugadoresTotal ?? "-"}</td></tr>
                    <tr><td className="muted">Resultado</td><td className={`num ${Number(resumen.resultadoTotal) >= 0 ? "pos" : "neg"}`}>{usd(resumen.resultadoTotal)}</td></tr>
                    <tr><td className="muted">Rake total generado por el club</td><td className="num">{usd(resumen.rakeTotal)}</td></tr>
                    <tr><td className="muted">Comisiones agentes (rakeback pagado)</td><td className="num">{usd(resumen.comisionesAgentes)}</td></tr>
                    <tr><td className="muted">Comisión del club/plataforma (no es nuestra, no suma ni resta)</td><td className="num muted">{usd(resumen.comisionPlataformaTotal)}</td></tr>
                    <tr>
                      <td className="muted">Ventas/VIP</td>
                      <td className={`num ${Number(resumen.ajusteManualTotal) === 0 ? "muted" : Number(resumen.ajusteManualTotal) >= 0 ? "pos" : "neg"}`}>{usd(resumen.ajusteManualTotal)}</td>
                    </tr>
                    <tr>
                      <td className="muted">Ajuste manual Promociones</td>
                      <td className={`num ${Number(resumen.ingresoPorVentas) === 0 ? "muted" : Number(resumen.ingresoPorVentas) >= 0 ? "pos" : "neg"}`}>{usd(resumen.ingresoPorVentas)}</td>
                    </tr>
                    {Number(resumen.cargasTesoreriaTotal) !== 0 && (
                      <tr>
                        <td className="muted" title="Suma de las cargas de fichas a los agentes de este club con fecha de esta semana: las que se cargan a mano y las que genera el pago de liquidaciones o de rakeback pendiente en fichas. Es solo informativo: no entra en ningún total de esta pantalla.">Cargas de fichas de la semana (informativo)</td>
                        <td className="num muted">{usd(resumen.cargasTesoreriaTotal)}</td>
                      </tr>
                    )}
                    <tr>
                      <td className="muted">Tasa semanal fija (Tasas)</td>
                      <td className={`num ${Number(resumen.tasaSemanalFija) === 0 ? "muted" : Number(resumen.tasaSemanalFija) >= 0 ? "pos" : "neg"}`}>{usd(resumen.tasaSemanalFija)}</td>
                    </tr>
                    <tr>
                      <td className="muted">Cierre total agentes</td>
                      <td className={`num ${Number(resumen.cierreTotalAgentes) >= 0 ? "pos" : "neg"}`}>{usd(resumen.cierreTotalAgentes)}</td>
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
            )}
          </div>

          {resumen.clubFamily === "TINY" && (
            <div className="panel">
              <h3>Tiny · Cierre semanal <Ayuda>A diferencia de los demas clubes, la ganancia de Tiny no sale de un % fijo sobre el rake: sale de la
                diferencia entre lo que la Union/GG nos liquida a nosotros (Settlement) y lo que nosotros les pagamos a
                los agentes (Cierre agentes).</Ayuda></h3>
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
