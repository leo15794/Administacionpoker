import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";
import MovimientosHistorial from "./MovimientosHistorial";

// Agrupa los cierres (uno por club) en un bloque por semana — mismo criterio que la pestaña
// "Estado de cuenta del agente" de la planilla vieja: un total de la semana (suma de todos los
// clubes) y abajo el desglose club por club (Resultado, Rake, % RB, Rebate, Resultado ajustado,
// Cierre final). weekly_closings ya guarda todos estos campos por club/semana, así que esto es
// puramente de presentación — no hace falta nada nuevo del backend.
function agruparPorSemana(cierres: any[]) {
  const grupos = new Map<string, any[]>();
  for (const c of cierres) {
    const key = `${c.week_start}_${c.week_end}`;
    (grupos.get(key) ?? grupos.set(key, []).get(key)!).push(c);
  }
  return [...grupos.entries()]
    .map(([key, filas]) => {
      const [week_start, week_end] = key.split("_");
      const total = filas.reduce((s, f) => s + Number(f.final_closing), 0);
      return { week_start, week_end, filas, total };
    })
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1));
}

// Arma el PDF prolijo para mandarle al agente: mismo contenido que se ve en pantalla (saldo
// por club + desglose de cierres por semana), pero como documento descargable. No incluye el
// historial de movimientos crudo (eso es info interna, no algo para mandarle al agente).
//
// jsPDF importa como dependencia a html2canvas (que no usamos, no generamos PDF desde HTML) y
// eso solo ya casi duplica el bundle de toda la app. Para no pagar ese costo en cada carga de
// página, se importa acá adentro, dinámico, recién cuando alguien aprieta "Descargar PDF" —
// al resto de la app no le cuesta nada.
async function generarPdf(agente: any, saldos: any[], cierres: any[], totalNeto: number, garantia: any) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const hoy = new Date().toLocaleDateString("es-AR");
  const margen = 14;
  let y = 18;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Estado de cuenta — ${agente.name}`, margen, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110);
  doc.text(`Generado el ${hoy}`, margen, y);
  doc.setTextColor(0);
  y += 9;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(`Saldo neto total: ${usd(totalNeto)}`, margen, y);
  y += 6;
  if (garantia) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Garantía vigente: ${usd(garantia.amount)}`, margen, y);
    y += 6;
  }
  y += 2;

  if (saldos.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: margen, right: margen },
      head: [["Club", "Saldo"]],
      body: saldos.map((b: any) => [b.club_name, usd(b.amount)]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [40, 50, 90] },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  const semanas = agruparPorSemana(cierres);
  for (const semana of semanas) {
    if (y > 260) {
      doc.addPage();
      y = 18;
    }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    const etiqueta = semana.total >= 0 ? "DEBEMOS (saldo a favor del agente)" : "NOS DEBE (saldo a favor de DigiPlayers)";
    doc.text(`Semana ${dateShort(semana.week_start)} - ${dateShort(semana.week_end)}: ${usd(semana.total)}  —  ${etiqueta}`, margen, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      margin: { left: margen, right: margen },
      head: [["Club", "Resultado", "Rake", "% RB", "Rakeback", "% Rebate", "Rebate", "Res. ajustado", "Cierre final"]],
      body: semana.filas.map((c: any) => [
        c.club_name,
        usd(c.result),
        usd(c.rake_total),
        pct(c.rakeback_pct),
        usd(c.rakeback),
        pct(c.rebate_pct),
        usd(c.rebate),
        usd(c.adjusted_result),
        usd(c.final_closing),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [40, 50, 90], fontSize: 7.5 },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
  }

  const nombreArchivo = `estado-cuenta_${agente.name.replace(/[^a-z0-9]+/gi, "-")}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(nombreArchivo);
}

/**
 * Estado de cuenta completo de un agente, para que un admin lo vea de cualquiera (no solo el
 * propio agente logueado, que ya tiene esto en "Mi cuenta"). Mismo endpoint/shape que
 * /portal/mi-cuenta, parametrizado por agentId vía /catalog/agents/:id/cuenta.
 *
 * Reemplaza al viejo modal "Historial" que solo mostraba la lista cruda de movimientos sin
 * saldo por club, garantía ni cierres — acá se ve todo junto, como el propio agente lo vería.
 */
export default function EstadoCuentaAgente({ agentId }: { agentId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [generandoPdf, setGenerandoPdf] = useState(false);

  useEffect(() => {
    setData(null);
    setError("");
    api.cuentaDeAgente(agentId).then(setData).catch((e) => setError(e.message));
  }, [agentId]);

  if (error) return <div className="error">No se pudo cargar el estado de cuenta: {error}</div>;
  if (!data) return <div className="muted">Cargando...</div>;

  const totalNeto = data.saldos.reduce((s: number, b: any) => s + Number(b.amount), 0);

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div className="kpi-grid" style={{ margin: 0 }}>
          <div className="kpi-card">
            <div className="label">Saldo neto total</div>
            <div className={`value ${totalNeto >= 0 ? "pos" : "neg"}`}>{usd(totalNeto)}</div>
          </div>
          {data.garantia && (
            <div className="kpi-card">
              <div className="label">Garantía vigente</div>
              <div className="value">{usd(data.garantia.amount)}</div>
            </div>
          )}
        </div>
        <button
          className="btn secondary small"
          disabled={generandoPdf}
          onClick={async () => {
            setGenerandoPdf(true);
            try {
              await generarPdf(data.agente, data.saldos, data.cierres, totalNeto, data.garantia);
            } catch (err: any) {
              alert(err.message || "No se pudo generar el PDF.");
            } finally {
              setGenerandoPdf(false);
            }
          }}
          title="Descargar un PDF prolijo con el saldo y el desglose de cierres, listo para mandarle al agente"
        >
          {generandoPdf ? "Generando..." : "Descargar PDF"}
        </button>
      </div>

      <div className="panel">
        <h3>Saldo por club</h3>
        {data.saldos.length === 0 ? (
          <div className="muted">Sin saldos cargados todavía.</div>
        ) : (
          <table>
            <thead><tr><th>Club</th><th>Saldo</th></tr></thead>
            <tbody>
              {data.saldos.map((b: any) => (
                <tr key={b.id}>
                  <td>{b.club_name}</td>
                  <td><span className={`badge ${Number(b.amount) > 0 ? "pos" : Number(b.amount) < 0 ? "neg" : "neutral"}`}>{usd(b.amount)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>Últimos cierres semanales</h3>
        {data.cierres.length === 0 ? (
          <div className="muted">Sin cierres cargados todavía.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {agruparPorSemana(data.cierres).map((semana) => (
              <div key={`${semana.week_start}_${semana.week_end}`} className="panel" style={{ padding: 14 }}>
                <div className="topbar" style={{ marginBottom: 10 }}>
                  <div>
                    <strong>{dateShort(semana.week_start)} - {dateShort(semana.week_end)}</strong>
                    <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
                      {semana.total >= 0 ? "DEBEMOS / saldo a favor del agente" : "NOS DEBE / saldo a favor de DigiPlayers"}
                    </span>
                  </div>
                  <span className={`badge ${semana.total >= 0 ? "pos" : "neg"}`} style={{ fontSize: 15 }}>
                    Cierre semanal: {usd(semana.total)}
                  </span>
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Club</th><th>Resultado</th><th>Rake</th><th>% RB</th><th>Rakeback</th>
                        <th>% Rebate</th><th>Rebate</th><th>Resultado ajustado</th><th>Cierre final</th>
                      </tr>
                    </thead>
                    <tbody>
                      {semana.filas.map((c: any) => (
                        <tr key={c.id}>
                          <td>{c.club_name}</td>
                          <td>{usd(c.result)}</td>
                          <td>{usd(c.rake_total)}</td>
                          <td className="muted">{pct(c.rakeback_pct)}</td>
                          <td>{usd(c.rakeback)}</td>
                          <td className="muted">{pct(c.rebate_pct)}</td>
                          <td>{usd(c.rebate)}</td>
                          <td>{usd(c.adjusted_result)}</td>
                          <td><span className={`badge ${Number(c.final_closing) >= 0 ? "pos" : "neg"}`}>{usd(c.final_closing)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Movimientos</h3>
        <MovimientosHistorial agentId={agentId} />
      </div>
    </div>
  );
}
