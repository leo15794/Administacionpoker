import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";

// "Resumen por agente" (23/09/2026, pedido de Leo): réplica del "Estado de cuenta semanal" que
// ya arma a mano en Excel (PDF de referencia "Cierre El Latigo Loco") -- elegís semana + uno o
// varios agentes y baja un PDF con, para cada agente: resumen por club, detalle por jugador
// (solo para cierres aplicados desde que este sistema empezó a guardarlo -- ver
// repo/closings.ts), subagentes (jugadores con % de rakeback propio) y estado de cuenta. Es de
// SOLO LECTURA: no cambia nada del sistema, ver repo/agentesResumen.ts.
export default function ResumenAgentes() {
  const [agentes, setAgentes] = useState<any[] | null>(null);
  const [semanas, setSemanas] = useState<string[] | null>(null);
  const [weekStart, setWeekStart] = useState("");
  const [query, setQuery] = useState("");
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.agentes().then(setAgentes);
    api.semanasConResumenAgente().then((s: string[]) => {
      setSemanas(s);
      if (s.length > 0) setWeekStart(s[0]);
    });
  }, []);

  function toggle(agentId: string) {
    setSeleccionados((s) => {
      const next = new Set(s);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  const filtrados = (agentes ?? []).filter(
    (a: any) => !query.trim() || a.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  async function generar() {
    if (!weekStart) return setError("Elegí una semana.");
    if (seleccionados.size === 0) return setError("Elegí al menos un agente.");
    setGenerando(true);
    setError("");
    try {
      const resultados = await Promise.all(
        Array.from(seleccionados).map((agentId) => api.resumenAgentePDF(agentId, weekStart).catch(() => null))
      );
      const datos = resultados.filter((r: any) => r);
      if (datos.length === 0) {
        setError("Ninguno de los agentes elegidos tiene un cierre aplicado en esa semana.");
        return;
      }
      await generarResumenAgentesPdf(datos);
    } catch (err: any) {
      setError(err.message || "No se pudo generar el PDF.");
    } finally {
      setGenerando(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Resumen por agente</h2>
          <div className="muted">
            Estado de cuenta semanal en PDF, por agente — resumen por club, detalle por jugador (para cierres cargados
            desde ahora en adelante), subagentes y saldo. Elegí la semana y uno o varios agentes.
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="field">
          <label>Semana</label>
          {!semanas ? (
            <span className="muted">Cargando...</span>
          ) : semanas.length === 0 ? (
            <span className="muted">Todavía no hay ningún cierre aplicado.</span>
          ) : (
            <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
              {semanas.map((s) => (
                <option key={s} value={s}>{dateShort(s)}</option>
              ))}
            </select>
          )}
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Agentes ({seleccionados.size} elegido{seleccionados.size === 1 ? "" : "s"})</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar agente..." />
        </div>

        {!agentes ? (
          <div className="muted" style={{ marginTop: 10 }}>Cargando...</div>
        ) : (
          <>
            {filtrados.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn secondary small" onClick={() => setSeleccionados((s) => new Set([...s, ...filtrados.map((a: any) => a.id)]))}>
                  Seleccionar todos
                </button>
                <button className="btn secondary small" onClick={() => setSeleccionados((s) => new Set([...s].filter((id) => !filtrados.some((a: any) => a.id === id))))}>
                  Deseleccionar todos
                </button>
              </div>
            )}
            <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {filtrados.map((a: any) => (
                <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={seleccionados.has(a.id)} onChange={() => toggle(a.id)} />
                  {a.name}
                </label>
              ))}
              {filtrados.length === 0 && <div className="muted">Sin resultados.</div>}
            </div>
          </>
        )}

        {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

        <button className="btn" style={{ marginTop: 14 }} disabled={generando} onClick={generar}>
          {generando ? "Generando..." : "Generar PDF"}
        </button>
      </div>
    </div>
  );
}

// Arma el PDF: una "portada" (estado de cuenta) por agente, seguida de una página por club con
// resumen + detalle por jugador (si hay), y una página de subagentes (si el agente tiene
// alguno) -- todo en UN SOLO archivo con un agente atrás del otro, en el orden en que se
// eligieron.
async function generarResumenAgentesPdf(datos: any[]) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const margen = 14;

  function encabezado(titulo: string) {
    doc.setFillColor(40, 50, 90);
    doc.rect(0, 0, 210, 14, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(titulo, 105, 9.5, { align: "center" });
    doc.setTextColor(0);
  }

  datos.forEach((r: any, idx: number) => {
    if (idx > 0) doc.addPage();
    let y = 22;

    // --- Portada: estado de cuenta semanal ---
    encabezado("ESTADO DE CUENTA SEMANAL");
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Agente", margen, y);
    doc.setFont("helvetica", "normal");
    doc.text(r.agentName, margen + 26, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Período", margen, y);
    doc.setFont("helvetica", "normal");
    doc.text(`${dateShort(r.weekStart)} al ${dateShort(r.weekEnd)}`, margen + 26, y);
    y += 8;

    const mostrarRodeo = r.clubes.some((c: any) => Number(c.rodeo) !== 0);
    // Ajuste manual (24/09/2026, pedido de Leo): sin esto "Total club" no cerraba contra
    // Resultado+Rebate+Rakeback y no había forma de ver por qué (ej. un descuento de "tarjeta
    // vip" cargado al cierre) -- se muestra la columna solo si hay algún ajuste distinto de 0.
    const mostrarAjuste = r.clubes.some((c: any) => Number(c.ajusteManual) !== 0);
    const headResumen = [
      "Club", "Resultado", "Rebate", "Rakeback bruto", "Rakeback neto",
      ...(mostrarRodeo ? ["Rodeo"] : []), ...(mostrarAjuste ? ["Ajuste"] : []), "Total club",
    ];
    const bodyResumen = r.clubes.map((c: any) => [
      c.clubName, usd(c.resultado), usd(c.rebate), usd(c.rakebackBruto), usd(c.rakebackNeto),
      ...(mostrarRodeo ? [usd(c.rodeo)] : []), ...(mostrarAjuste ? [usd(c.ajusteManual)] : []), usd(c.totalClub),
    ]);
    const sumClub = (fn: (c: any) => number) => r.clubes.reduce((s: number, c: any) => s + fn(c), 0);
    const footResumen = [
      "TOTAL SEMANAL", usd(sumClub((c: any) => c.resultado)), usd(sumClub((c: any) => c.rebate)),
      usd(sumClub((c: any) => c.rakebackBruto)), usd(sumClub((c: any) => c.rakebackNeto)),
      ...(mostrarRodeo ? [usd(sumClub((c: any) => c.rodeo))] : []),
      ...(mostrarAjuste ? [usd(sumClub((c: any) => c.ajusteManual))] : []),
      usd(sumClub((c: any) => c.totalClub)),
    ];
    autoTable(doc, {
      startY: y,
      margin: { left: margen, right: margen },
      head: [headResumen],
      body: bodyResumen,
      foot: [footResumen],
      styles: { fontSize: 8.5 },
      headStyles: { fillColor: [40, 50, 90] },
      footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
    });
    y = (doc as any).lastAutoTable.finalY + 4;

    // Notas de los ajustes (el motivo cargado al momento del cierre, ej. "tarjeta vip") -- la
    // columna de arriba solo tiene el número, esto explica el POR QUÉ club por club.
    const notasAjuste = r.clubes.filter((c: any) => Number(c.ajusteManual) !== 0 && c.ajusteManualNota);
    if (notasAjuste.length > 0) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(90);
      notasAjuste.forEach((c: any) => {
        doc.text(`Ajuste ${c.clubName} (${usd(c.ajusteManual)}): ${c.ajusteManualNota}`, margen, y);
        y += 4;
      });
      doc.setTextColor(0);
      doc.setFont("helvetica", "normal");
    }
    y += 6;

    const ec = r.estadoCuenta;
    autoTable(doc, {
      startY: y,
      margin: { left: margen, right: margen },
      head: [["Estado de cuenta", "Importe"]],
      body: [
        ["Saldo anterior", usd(ec.saldoAnterior)],
        ["Cierre semanal", usd(ec.cierreSemanal)],
        ["Pagos / movimientos posteriores", usd(ec.pagosPosteriores)],
        ["Saldo operativo final", usd(ec.saldoOperativoFinal)],
        ["Nos debe", usd(ec.nosDebe)],
        ["Debemos / saldo a favor", usd(ec.debemos)],
        ["Situación", ec.situacion],
      ],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 50, 90] },
      didParseCell: (data: any) => {
        if (data.row.section === "body" && data.row.index === 3) data.cell.styles.fontStyle = "bold";
      },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text("Saldo anterior y pagos posteriores reconstruidos del historial de movimientos; no incluye pagos financieros de rakeback pendiente.", margen, y);
    doc.setTextColor(0);

    // --- Detalle por club (solo si hay desglose de jugadores guardado) ---
    for (const club of r.detallePorClub) {
      if (club.jugadores.length === 0) continue;
      doc.addPage();
      encabezado(`CIERRE GENERAL ${club.clubName.toUpperCase()} · ${r.agentName.toUpperCase()}`);
      y = 22;
      doc.setFontSize(9);
      doc.text(`Semana: ${dateShort(r.weekStart)} al ${dateShort(r.weekEnd)}`, margen, y);
      y += 6;
      const headDet = ["Jugador / Cuenta", "Resultado", "Rake", "% Rebate", "Rebate", "Resultado ajustado", "% Rakeback", "Rakeback", "Cierre", "Subagente"];
      const bodyDet = club.jugadores.map((j: any) => [
        j.playerName, usd(j.resultado), usd(j.rake), pct(club.rebatePctAgente), usd(j.rebate),
        usd(j.resultadoAjustado), pct(j.rakebackPct), usd(j.rakeback), usd(j.cierre), j.subagenteName ?? "-",
      ]);
      const sumJ = (fn: (j: any) => number) => club.jugadores.reduce((s: number, j: any) => s + fn(j), 0);
      autoTable(doc, {
        startY: y,
        margin: { left: margen, right: margen },
        head: [headDet],
        body: bodyDet,
        foot: [["TOTAL", usd(sumJ((j: any) => j.resultado)), usd(sumJ((j: any) => j.rake)), "", usd(sumJ((j: any) => j.rebate)), usd(sumJ((j: any) => j.resultadoAjustado)), "", usd(sumJ((j: any) => j.rakeback)), usd(sumJ((j: any) => j.cierre)), ""]],
        styles: { fontSize: 7.5 },
        headStyles: { fillColor: [40, 50, 90] },
        footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
      });
    }

    // --- Subagentes ---
    if (r.subagentes.length > 0) {
      doc.addPage();
      encabezado(`LIQUIDACIÓN DE SUBAGENTES · ${r.agentName.toUpperCase()}`);
      y = 26;
      autoTable(doc, {
        startY: y,
        margin: { left: margen, right: margen },
        head: [["Subagente", "Club", "Resultado", "Rake", "% RB principal", "RB principal", "% RB subagente", "RB subagente", "Margen principal", "Cierre subagente", "Impacto principal"]],
        body: r.subagentes.map((s: any) => [
          s.subagenteName, s.clubName, usd(s.resultado), usd(s.rake), pct(s.rakebackPctPrincipal), usd(s.rakebackPrincipal),
          pct(s.rakebackPctSubagente), usd(s.rakebackSubagente), usd(s.margenPrincipal), usd(s.cierreSubagente), usd(s.impactoPrincipal),
        ]),
        styles: { fontSize: 7.5 },
        headStyles: { fillColor: [40, 50, 90] },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
      doc.setFontSize(7.5);
      doc.setTextColor(120);
      for (const s of r.subagentes) {
        doc.text(`${s.subagenteName}: ${s.jugadores.join(" + ")}.`, margen, y);
        y += 4;
      }
      doc.setTextColor(0);
    }
  });

  const nombreArchivo = datos.length === 1
    ? `Cierre_${datos[0].agentName.replace(/\s+/g, "_")}_${datos[0].weekStart}_al_${datos[0].weekEnd}.pdf`
    : `Resumen_agentes_${datos[0].weekStart}_al_${datos[0].weekEnd}.pdf`;
  doc.save(nombreArchivo);
}
