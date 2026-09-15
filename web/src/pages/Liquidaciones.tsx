import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";

// Resumen de liquidación semanal por agente, para mandarle el pago: una fila por club con lo
// que generó en rakeback esa semana, un total, y (abajo) lo que efectivamente se le paga después
// de descontar adelantos pendientes — mismo formato que la planilla vieja ("PRODIGIO · CIERRE
// 07/09-13/09"). Todo en USD: weekly_closings ya guarda los montos convertidos con la tasa de
// esa semana, no el monto en moneda local original, así que cualquier aclaración de conversión
// (ej. "a la fecha de pago el TWD estaba distinto") se agrega a mano en la nota de abajo, no se
// calcula solo.
async function generarPdf(agente: any, data: any, adelantos: number, nota: string) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const margen = 14;
  let y = 18;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Liquidación — ${agente.name}`, margen, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text(`Cierre ${dateShort(data.weekStart)} - ${dateShort(data.weekEnd)}`, margen, y);
  doc.setTextColor(0);
  y += 9;

  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Club", "Ganancias/Pérdidas", "Rake", "Rakeback bruto", "Rebate", "Rakeback neto"]],
    body: data.filas.map((f: any) => [
      f.clubName,
      usd(f.resultado),
      usd(f.rakeTotal),
      usd(f.rakebackBruto),
      usd(f.rebate),
      usd(f.rakebackNeto),
    ]),
    foot: [["TOTAL", "", "", "", "", usd(data.total)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 50, 90] },
    footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  const totalAPagar = data.total - adelantos;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Después:", margen, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Rakeback / comisiones finales: ${usd(data.total)}`, margen, y);
  y += 6;
  doc.text(`Adelantos a descontar: ${usd(adelantos)}`, margen, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Total a pagar: ${usd(totalAPagar)}`, margen, y);
  y += 10;

  if (nota.trim()) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(90);
    const lineas = doc.splitTextToSize(nota.trim(), 180);
    doc.text(lineas, margen, y);
    doc.setTextColor(0);
  }

  const nombreArchivo = `liquidacion_${agente.name.replace(/[^a-z0-9]+/gi, "-")}_${data.weekStart}.pdf`;
  doc.save(nombreArchivo);
}

export default function Liquidaciones() {
  const [agentes, setAgentes] = useState<any[]>([]);
  const [agentId, setAgentId] = useState("");
  const [semanas, setSemanas] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [data, setData] = useState<any>(null);
  const [adelantos, setAdelantos] = useState<number>(0);
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);

  useEffect(() => {
    api.agentes().then(setAgentes).catch(() => {});
  }, []);

  useEffect(() => {
    setSemanas([]);
    setWeekStart("");
    setData(null);
    if (!agentId) return;
    api.semanasLiquidacion(agentId).then(setSemanas).catch(() => {});
  }, [agentId]);

  useEffect(() => {
    setData(null);
    setError("");
    if (!agentId || !weekStart) return;
    setCargando(true);
    api
      .liquidacion(agentId, weekStart)
      .then((d) => {
        setData(d);
        setAdelantos(Number(d.adelantosPendientes) || 0);
        setNota("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [agentId, weekStart]);

  const totalAPagar = data ? data.total - adelantos : 0;

  return (
    <div>
      <h2>Liquidaciones</h2>
      <p className="muted" style={{ marginTop: -6, marginBottom: 18 }}>
        Resumen de rakeback por club de una semana puntual, listo para mandarle el pago al agente.
      </p>

      <div className="panel" style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Agente</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Elegir agente...</option>
            {agentes.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Semana</label>
          <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)} disabled={!agentId || semanas.length === 0}>
            <option value="">{agentId ? (semanas.length === 0 ? "Sin cierres" : "Elegir semana...") : "Elegí un agente primero"}</option>
            {semanas.map((s) => (
              <option key={s.week_start} value={s.week_start}>
                {dateShort(s.week_start)} - {dateShort(s.week_end)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
      {cargando && <div className="muted" style={{ marginTop: 14 }}>Cargando...</div>}

      {data && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="topbar" style={{ marginBottom: 14 }}>
            <div>
              <strong>{data.agente.name}</strong>
              <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
                Cierre {dateShort(data.weekStart)} - {dateShort(data.weekEnd)}
              </span>
            </div>
            <button
              className="btn secondary small"
              disabled={generandoPdf}
              onClick={async () => {
                setGenerandoPdf(true);
                try {
                  await generarPdf(data.agente, data, adelantos, nota);
                } catch (err: any) {
                  alert(err.message || "No se pudo generar el PDF.");
                } finally {
                  setGenerandoPdf(false);
                }
              }}
            >
              {generandoPdf ? "Generando..." : "Descargar PDF"}
            </button>
          </div>

          <table>
            <thead>
              <tr>
                <th>Club</th>
                <th>Ganancias/Pérdidas</th>
                <th>Rake</th>
                <th>Rakeback bruto</th>
                <th>Rebate</th>
                <th>Rakeback neto</th>
              </tr>
            </thead>
            <tbody>
              {data.filas.map((f: any) => (
                <tr key={f.clubId}>
                  <td>{f.clubName}</td>
                  <td className={Number(f.resultado) >= 0 ? "pos" : "neg"}>{usd(f.resultado)}</td>
                  <td>{usd(f.rakeTotal)}</td>
                  <td>{usd(f.rakebackBruto)}</td>
                  <td>{usd(f.rebate)}</td>
                  <td><strong>{usd(f.rakebackNeto)}</strong></td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>TOTAL</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td>{usd(data.total)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <h3 style={{ marginTop: 0 }}>Después</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}>
              <div className="topbar" style={{ margin: 0 }}>
                <span className="muted">Rakeback / comisiones finales</span>
                <span>{usd(data.total)}</span>
              </div>
              <div className="topbar" style={{ margin: 0, alignItems: "center" }}>
                <span className="muted">Adelantos a descontar</span>
                <input
                  type="number"
                  step="0.01"
                  value={adelantos}
                  onChange={(e) => setAdelantos(Number(e.target.value) || 0)}
                  style={{ width: 130, textAlign: "right" }}
                  title="Autocompletado con los adelantos pendientes activos del agente — se puede corregir a mano."
                />
              </div>
              <div className="topbar" style={{ margin: 0, fontWeight: 700, fontSize: 16, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                <span>Total a pagar</span>
                <span className={totalAPagar >= 0 ? "pos" : "neg"}>{usd(totalAPagar)}</span>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                Nota (aclaraciones de conversión de moneda, etc. — se incluye en el PDF)
              </label>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                style={{ width: "100%", resize: "vertical" }}
                placeholder="Ej: rakeback bruto calculado con el rate de la semana; ver diferencia de TWD al momento del pago."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
