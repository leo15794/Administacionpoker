import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";
import { useConfirmDialog } from "./ConfirmProvider";

const TIPO_LABEL: Record<string, string> = {
  CARGA: "Carga",
  DESCARGA: "Descarga",
  COBRO: "Cobro",
  PAGO: "Pago",
  TRANSFERENCIA_ENTRE_CLUBES: "Transferencia",
  TICKET_PROMOCIONAL: "Ticket promocional",
  AJUSTE: "Ajuste",
  CIERRE_SEMANAL: "Cierre semanal",
  PAGO_RAKEBACK: "Pago de rakeback pendiente",
};

function truncar(texto: string, max = 140) {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

export default function MovimientosHistorial({ agentId, clubId }: { agentId?: string; clubId?: string }) {
  const { alertDialog, promptDialog, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [borrando, setBorrando] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.movimientos({ agentId, clubId }).then(setRows).catch((e) => setError(e.message));
  }

  useEffect(() => {
    setRows(null);
    refresh();
  }, [agentId, clubId]);

  async function onRevertir(id: string) {
    const motivo = await promptDialog("¿Por qué revertís este movimiento? (queda registrado en el historial)");
    if (motivo === null) return; // canceló el prompt
    setBorrando(id);
    try {
      await api.revertirMovimiento(id, motivo || undefined);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo revertir el movimiento.");
    } finally {
      setBorrando(null);
    }
  }

  // Borrado real (no reversa) -- solo el último movimiento de ese agente+club, y bloqueado si
  // es una CARGA ya cruzada en una liquidación (el backend valida todo esto, ver
  // repo/ledger.ts). Pensado para sacar un movimiento de prueba, no para corregir uno real.
  async function onEliminar(r: any) {
    if (!(await confirmDialog(`¿Eliminar este movimiento de ${TIPO_LABEL[r.type] ?? r.type} por ${usd(r.amount)}? A diferencia de "Revertir", esto lo borra del todo -- no queda en el historial. Solo funciona si es el último movimiento cargado para ese agente+club. No se puede deshacer.`))) return;
    setEliminando(r.id);
    try {
      await api.eliminarMovimiento(r.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar el movimiento.");
    } finally {
      setEliminando(null);
    }
  }

  if (error) return <div className="error">No se pudo cargar el historial: {error}</div>;
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
            <tr key={r.id} style={r.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
              <td>{dateShort(r.occurred_at)}</td>
              <td>
                <span className="badge neutral">{TIPO_LABEL[r.type] ?? r.type}</span>
                {r.status === "REVERTIDO" && <span className="badge neg" style={{ marginLeft: 6 }}>Revertido</span>}
              </td>
              <td>{r.agent_name}</td>
              <td>{r.club_name}{r.club_destino_name ? ` → ${r.club_destino_name}` : ""}</td>
              <td><span className={`badge ${Number(r.amount) > 0 ? "pos" : Number(r.amount) < 0 ? "neg" : "neutral"}`}>{usd(r.amount)}</span></td>
              <td className="muted" style={{ fontSize: 12 }} title={r.observation || undefined}>{r.observation ? truncar(r.observation) : "—"}</td>
              <td style={{ display: "flex", gap: 6 }}>
                {r.status !== "REVERTIDO" && (
                  <button
                    className="btn secondary small"
                    disabled={borrando === r.id}
                    onClick={() => onRevertir(r.id)}
                    title="Revertir movimiento (genera un ajuste opuesto, no borra nada)"
                  >
                    {borrando === r.id ? "..." : "Revertir"}
                  </button>
                )}
                {r.status !== "REVERTIDO" && (!r.refs || r.refs.length === 0) && (
                  <button
                    className="btn secondary small"
                    disabled={eliminando === r.id}
                    onClick={() => onEliminar(r)}
                    title="Borrado real -- no queda en el historial. Solo funciona si es el último movimiento de ese agente+club (ej. para sacar una carga de prueba)."
                    style={{ color: "var(--danger, #e5484d)" }}
                  >
                    {eliminando === r.id ? "..." : "Eliminar"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
