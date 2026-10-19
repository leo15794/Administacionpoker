import { useEffect, useState } from "react";
import { api } from "../api";
import { usdCents, dateTime, dateShort } from "../fmt";
import { exportCsv } from "../csv";
import { useConfirmDialog } from "./ConfirmProvider";
import ActionsMenu from "./ActionsMenu";
import Loading from "./Loading";

export const TIPO_LABEL: Record<string, string> = {
  CARGA: "Carga",
  DESCARGA: "Descarga",
  COBRO: "Cobro",
  PAGO: "Pago",
  TRANSFERENCIA_ENTRE_CLUBES: "Transferencia",
  TICKET_PROMOCIONAL: "Ticket promocional",
  AJUSTE: "Ajuste",
  CIERRE_SEMANAL: "Cierre semanal",
  PAGO_RAKEBACK: "Pago de rakeback pendiente",
  // (19/10/2026) Faltaba: aparecía el nombre interno en crudo en el historial.
  COBRO_RAKEBACK: "Cobro de rakeback",
  ADELANTO_RAKEBACK: "Adelanto de rakeback (USDT)",
  ADELANTO_FICHAS: "Adelanto de fichas",
};

const MEDIO_LABEL: Record<string, string> = {
  SIN_TESORERIA: "Sin tesorería",
  USDT: "USDT",
  EFECTIVO: "Efectivo",
  ZELLE: "Zelle",
  OTRO: "Otro",
};

// Los cierres semanales se guardan con la fecha "pura" a medianoche UTC: pasarla por dateTime() la
// mostraba corrida al día anterior (17/10 21:00 en vez de 18/10). Esas se muestran solo con la fecha,
// igual que antes; el resto de los movimientos sí tienen una hora real.
function fechaFila(s: string) {
  return /T00:00:00(.000)?Z$/.test(s) ? dateShort(s) : dateTime(s);
}

function truncar(texto: string, max = 140) {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}

// Ícono de la fila (19/10/2026, mockup aprobado): + verde / − rojo según el signo del monto, ± dorado
// para ajustes y tickets, y un punto neutro para los cierres (que no mueven balance).
function iconoDeFila(r: any): { cls: string; glyph: string } {
  if (r.type === "AJUSTE" || r.type === "TICKET_PROMOCIONAL") return { cls: "gold", glyph: "±" };
  if (r.type === "CIERRE_SEMANAL") return { cls: "n", glyph: "∑" };
  const a = Number(r.amount);
  if (a < 0) return { cls: "r", glyph: "−" };
  if (a > 0) return { cls: "g", glyph: "+" };
  return { cls: "n", glyph: "·" };
}

type Vista = "sin_cierres" | "cierres" | "todos";

export default function MovimientosHistorial({
  agentId,
  clubId,
  type,
  desde,
  hasta,
  conFiltroCierres = false,
}: {
  agentId?: string;
  clubId?: string;
  type?: string;
  desde?: string;
  hasta?: string;
  /** Solo en "Cargar movimiento": agrega el selector Sin cierres / Cierres / Todos y arranca sin los
   * cierres semanales automáticos (son más de un tercio de las filas, siempre en US$ 0, y tapan lo
   * que se cargó a mano). En el resto de las pantallas se sigue viendo todo, como siempre. */
  conFiltroCierres?: boolean;
}) {
  const { alertDialog, promptDialog, confirmDialog } = useConfirmDialog();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [borrando, setBorrando] = useState<string | null>(null);
  const [eliminando, setEliminando] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>(conFiltroCierres ? "sin_cierres" : "todos");
  const [abierta, setAbierta] = useState<string | null>(null);

  function refresh() {
    setError("");
    api
      .movimientos({ agentId, clubId, type, desde, hasta, limit: conFiltroCierres ? 1000 : undefined })
      .then(setRows)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    setRows(null);
    refresh();
  }, [agentId, clubId, type, desde, hasta]);

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
    if (!(await confirmDialog(`¿Eliminar este movimiento de ${TIPO_LABEL[r.type] ?? r.type} por ${usdCents(r.amount)}? A diferencia de "Revertir", esto lo borra del todo -- no queda en el historial. Solo funciona si es el último movimiento cargado para ese agente+club. No se puede deshacer.`, { danger: true }))) return;
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
  if (!rows) return <Loading />;

  const nCierres = rows.filter((r) => r.type === "CIERRE_SEMANAL").length;
  const visibles = rows.filter((r) => (vista === "todos" ? true : vista === "cierres" ? r.type === "CIERRE_SEMANAL" : r.type !== "CIERRE_SEMANAL"));

  if (rows.length === 0) {
    return <div className="muted">No hay movimientos cargados en el sistema nuevo para este filtro todavía (el saldo puede venir del estado inicial importado de la planilla).</div>;
  }

  return (
    <div>
      <div className="mov-hist-top">
        {conFiltroCierres ? (
          <div className="seg">
            <button className={vista === "sin_cierres" ? "on" : ""} onClick={() => setVista("sin_cierres")}>
              Sin cierres semanales<span className="n">{rows.length - nCierres}</span>
            </button>
            <button className={vista === "cierres" ? "on" : ""} onClick={() => setVista("cierres")}>
              Cierres semanales<span className="n">{nCierres}</span>
            </button>
            <button className={vista === "todos" ? "on" : ""} onClick={() => setVista("todos")}>
              Todos<span className="n">{rows.length}</span>
            </button>
          </div>
        ) : (
          <span />
        )}
        <button
          className="btn secondary small"
          onClick={() =>
            exportCsv(
              "movimientos.csv",
              visibles.map((r) => ({
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

      <div className="mov-list">
        {visibles.map((r) => {
          const ic = iconoDeFila(r);
          const monto = Number(r.amount);
          const revertido = r.status === "REVERTIDO";
          const puedeEliminar = !revertido && (!r.refs || r.refs.length === 0);
          const items = [
            ...(!revertido
              ? [
                  {
                    label: borrando === r.id ? "Revirtiendo..." : "Revertir",
                    disabled: borrando === r.id,
                    onClick: () => onRevertir(r.id),
                  },
                ]
              : []),
            ...(puedeEliminar
              ? [
                  {
                    label: eliminando === r.id ? "Eliminando..." : "Eliminar (borrado real)",
                    danger: true,
                    disabled: eliminando === r.id,
                    onClick: () => onEliminar(r),
                  },
                ]
              : []),
          ];
          const expandida = abierta === r.id;
          return (
            <div key={r.id} className={`mov-row${revertido ? " revertido" : ""}`}>
              <div className={`mov-ic ${ic.cls}`}>{ic.glyph}</div>
              <div
                className="mov-mid"
                onClick={() => r.observation && setAbierta(expandida ? null : r.id)}
                style={{ cursor: r.observation ? "pointer" : undefined }}
              >
                <div className="mov-l1">
                  {TIPO_LABEL[r.type] ?? r.type} · {r.agent_name}
                  {revertido && <span className="pill a" style={{ marginLeft: 8 }}>Revertido</span>}
                </div>
                <div className="mov-l2">
                  {r.club_name}
                  {r.club_destino_name ? ` → ${r.club_destino_name}` : ""} · {MEDIO_LABEL[r.payment_method] ?? r.payment_method} · {fechaFila(r.occurred_at)}
                </div>
                {r.observation && (
                  <div className="mov-obs" title={expandida ? undefined : "Tocá para ver completo"}>
                    {expandida ? r.observation : truncar(r.observation, 110)}
                  </div>
                )}
              </div>
              <div className={`mov-amt ${monto > 0 ? "pos" : monto < 0 ? "neg" : ""}`}>
                {monto > 0 ? "+" : monto < 0 ? "−" : ""}
                {usdCents(Math.abs(monto))}
              </div>
              <div className="mov-actions">
                <ActionsMenu items={items} />
              </div>
            </div>
          );
        })}
        {visibles.length === 0 && <div className="muted" style={{ padding: "10px 4px" }}>No hay movimientos para esta vista.</div>}
      </div>
    </div>
  );
}
