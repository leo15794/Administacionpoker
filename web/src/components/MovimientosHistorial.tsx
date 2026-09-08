import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";

const TIPO_LABEL: Record<string, string> = {
  CARGA: "Carga",
  DESCARGA: "Descarga",
  COBRO: "Cobro",
  PAGO: "Pago",
  TRANSFERENCIA_ENTRE_CLUBES: "Transferencia",
  TICKET_PROMOCIONAL: "Ticket promocional",
  AJUSTE: "Ajuste",
  CIERRE_SEMANAL: "Cierre semanal",
};

function truncar(texto: string, max = 140) {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

export default function MovimientosHistorial({ agentId, clubId }: { agentId?: string; clubId?: string }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    api.movimientos({ agentId, clubId }).then(setRows);
  }

  useEffect(() => {
    setRows(null);
    refresh();
  }, [agentId, clubId]);

  async function onEliminar(id: string) {
    if (!confirm("¿Eliminar este movimiento? Se revierte su efecto en el saldo y no se puede deshacer.")) return;
    setBorrando(id);
    try {
      await api.eliminarMovimiento(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar el movimiento.");
    } finally {
      setBorrando(null);
    }
  }

  if (!rows) return <div className="muted">Cargando...</div>;
  if (rows.length === 0) {
    return <div className="muted">No hay movimientos cargados en el sistema nuevo para este filtro todavía (el saldo puede venir del estado inicial importado de la planilla).</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button
          className="btn secondary small"
          onClick={() =>
            exportCsv(
              "movimientos.csv",
              rows.map((r) => ({
                fecha: r.occurred_at,
                tipo: TIPO_LABEL[r.type] ?? r.type,
                agente: r.agent_name,
                club: r.club_name,
                club_destino: r.club_destino_name ?? "",
                monto: r.amount,
                medio_pago: r.payment_method,
                observacion: r.observation ?? "",
              }))
            )
          }
        >
          Exportar CSV
        </button>
      </div>
      <table>
        <thead>
          <tr><th>Fecha</th><th>Tipo</th><th>Agente</th><th>Club</th><th>Monto</th><th>Observación</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{dateShort(r.occurred_at)}</td>
              <td><span className="badge neutral">{TIPO_LABEL[r.type] ?? r.type}</span></td>
              <td>{r.agent_name}</td>
              <td>{r.club_name}{r.club_destino_name ? ` → ${r.club_destino_name}` : ""}</td>
              <td><span className={`badge ${Number(r.amount) > 0 ? "pos" : Number(r.amount) < 0 ? "neg" : "neutral"}`}>{usd(r.amount)}</span></td>
              <td className="muted" style={{ fontSize: 12 }} title={r.observation || undefined}>{r.observation ? truncar(r.observation) : "—"}</td>
              <td>
                <button
                  className="btn secondary small"
                  disabled={borrando === r.id}
                  onClick={() => onEliminar(r.id)}
                  title="Eliminar movimiento (revierte el saldo)"
                >
                  {borrando === r.id ? "..." : "Eliminar"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
