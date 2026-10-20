import { cargarLibreriasPdf } from "./pdfLibs";
import { dateShort } from "./fmt";

// PDFs de las cuentas de agentes (sección Agentes, 20/10/2026, pedido de Leo): cierre semanal, estado de cuenta o todo
// junto, de uno o de todos los agentes con cuenta. Los datos vienen de GET /supervisores/cuentas-agentes/pdf-datos
// (ver repo/supervisores.ts datosPdfCuentasAgentes); acá solo se dibujan.
export type ContenidoPdf = "CIERRE" | "ESTADO" | "TODO";
export type FormatoPdf = "UNO" | "POR_AGENTE";

const TIPO: Record<string, string> = {
  CARGA: "Carga",
  DESCARGA: "Descarga",
  AJUSTE: "Ajuste",
  PAGO: "Pago USDT",
  COBRO: "Cobro USDT",
  DESCUENTO: "Descuento",
};

const m = (n: number) =>
  `${n < -0.004 ? "-" : ""}US$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

function dibujarCierre(doc: any, autoTable: any, c: any, semana: string, semanaFin: string, y: number): number {
  const margen = 14;
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(`${c.name} · Cierre ${dateShort(semana)} - ${dateShort(semanaFin)}`, margen, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const ci = c.cierre;
  if (!ci || ci.filas.length === 0) {
    doc.text(
      ci?.yaIncluidoEnSaldo
        ? "El cierre de esta semana ya está incluido en el saldo importado de la cuenta."
        : "No hay cierre cargado para esta semana.",
      margen,
      y
    );
    return y + 10;
  }

  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Club", "Jugadores", "Resultado", "Rake", "Rakeback", "Rebate", "Rodeo", "Cierre"]],
    body: ci.filas.map((f: any) => [f.club_name, f.jugadores ?? "-", m(f.result), m(f.rake_total), m(f.rakeback), m(f.rebate), m(f.rodeo), m(f.total)]),
    foot: [["TOTAL", "", "", "", "", "", "", m(ci.total)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 50, 90] },
    footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
  });
  y = doc.lastAutoTable.finalY + 8;

  const desc = c.descuentos ?? [];
  if (desc.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: margen, right: margen },
      head: [["Descuentos del cierre", "Detalle", "Importe"]],
      body: desc.map((d: any) => [d.concepto ?? "Descuento", d.notes ?? "", `-${m(d.amount)}`]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [120, 60, 60] },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  const totalDescuentos = desc.reduce((s: number, d: any) => s + Number(d.amount), 0);
  doc.setFontSize(10);
  if (c.sistema === "WIN_LOSE") {
    doc.text(`El cierre completo se suma a la cuenta corriente: ${m(ci.total)}`, margen, y);
  } else {
    doc.text(`Resultado de mesas (a fichas reales): ${m(ci.resultado)}   ·   Rakeback (a cuenta corriente): ${m(ci.rakeback)}`, margen, y);
  }
  y += 6;
  if (totalDescuentos > 0) {
    doc.text(`Descuentos de la semana: -${m(totalDescuentos)}`, margen, y);
    y += 6;
  }
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.text(ci.aplicado ? "Cierre aplicado a la cuenta." : "Cierre todavía no aplicado a la cuenta.", margen, y);
  doc.setFont("helvetica", "normal");
  return y + 10;
}

function dibujarEstado(doc: any, autoTable: any, c: any, y: number): number {
  const margen = 14;
  const hoy = new Date().toISOString().slice(0, 10);
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(`${c.name} · Estado de cuenta al ${dateShort(hoy)}`, margen, y);
  y += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  if (c.sistema === "WIN_LOSE") {
    const etiqueta = c.cuentaCorriente < -0.004 ? "El agente nos debe" : c.cuentaCorriente > 0.004 ? "Le debemos" : "Al día";
    doc.text(`Cuenta corriente (${etiqueta}): ${m(c.cuentaCorriente)}`, margen, y);
    y += 8;
  } else {
    doc.text(`Fichas reales: ${m(c.fichas)}    ·    Cuenta corriente: ${m(c.cuentaCorriente)}    ·    Saldo total: ${m(c.fichas + c.cuentaCorriente)}`, margen, y);
    y += 8;
    if (c.porClub.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: margen, right: margen },
        head: [["Club", "Cargas y descargas", "Resultado de mesas", "Fichas en el club"]],
        body: c.porClub.map((p: any) => [p.club, m(p.balance), m(p.mesas), m(p.fichas)]),
        foot: [["TOTAL", m(c.porClub.reduce((s: number, p: any) => s + p.balance, 0)), m(c.porClub.reduce((s: number, p: any) => s + p.mesas, 0)), m(c.porClub.reduce((s: number, p: any) => s + p.fichas, 0))]],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [40, 50, 90] },
        footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
      });
      y = doc.lastAutoTable.finalY + 8;
    }
  }

  if (c.movimientos.length === 0) {
    doc.setFontSize(10);
    doc.text("Sin movimientos registrados en la cuenta.", margen, y);
    return y + 10;
  }
  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Fecha", "Tipo", "Club", "Importe", "Fichas", "Cta. corriente", "Detalle"]],
    body: c.movimientos.map((x: any) => [
      dateShort(x.fecha),
      TIPO[x.type] ?? x.type,
      x.club ?? "-",
      m(x.amount),
      x.fichasDelta ? m(x.fichasDelta) : "-",
      x.ccDelta ? m(x.ccDelta) : "-",
      [x.concepto, x.notes].filter(Boolean).join(" · ") || (x.usdtReal ? "USDT real" : ""),
    ]),
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [40, 50, 90] },
    columnStyles: { 6: { cellWidth: 48 } },
  });
  return doc.lastAutoTable.finalY + 8;
}

function dibujarAgente(doc: any, autoTable: any, c: any, contenido: ContenidoPdf, semana: string, semanaFin: string) {
  let y = 18;
  if (contenido === "CIERRE" || contenido === "TODO") y = dibujarCierre(doc, autoTable, c, semana, semanaFin, y);
  if (contenido === "ESTADO" || contenido === "TODO") {
    if (contenido === "TODO" && y > 200) {
      doc.addPage();
      y = 18;
    }
    dibujarEstado(doc, autoTable, c, y + (contenido === "TODO" ? 4 : 0));
  }
}

export async function generarPdfCuentasAgentes(
  cuentas: any[],
  semana: string,
  semanaFin: string,
  contenido: ContenidoPdf,
  formato: FormatoPdf
): Promise<number> {
  if (cuentas.length === 0) throw new Error("No hay agentes elegidos.");
  const { jsPDF, autoTable } = await cargarLibreriasPdf();
  const etiqueta = contenido === "CIERRE" ? "cierre" : contenido === "ESTADO" ? "estado-de-cuenta" : "cierre-y-estado";

  if (formato === "POR_AGENTE") {
    for (const c of cuentas) {
      const doc = new jsPDF();
      dibujarAgente(doc, autoTable, c, contenido, semana, semanaFin);
      doc.save(`${slug(c.name)}_${etiqueta}_${semana}.pdf`);
      await new Promise((r) => setTimeout(r, 350)); // que el navegador no junte las descargas
    }
    return cuentas.length;
  }

  const doc = new jsPDF();
  cuentas.forEach((c, i) => {
    if (i > 0) doc.addPage();
    dibujarAgente(doc, autoTable, c, contenido, semana, semanaFin);
  });
  doc.save(`${cuentas.length === 1 ? slug(cuentas[0].name) : "agentes"}_${etiqueta}_${semana}.pdf`);
  return 1;
}
