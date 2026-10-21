import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { dateTime } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";

// Avisos push a supervisores, proveedores y agentes (21/10/2026, pedido de Leo). Siempre a mano: nada se manda solo,
// se elige a quién (todos o algunos), se escribe el aviso y se confirma antes de enviar.
const ROL: Record<string, string> = { SUPERVISOR: "Supervisor", AGENT: "Agente", PROVEEDOR: "Proveedor" };
const FILTROS = [
  { key: "TODOS", label: "Todos" },
  { key: "SUPERVISOR", label: "Supervisores" },
  { key: "AGENT", label: "Agentes" },
  { key: "PROVEEDOR", label: "Proveedores" },
];

// layout: "pagina" (ruta propia), "panel" (columna angosta a la derecha) o "completa" (panel agrandado a pantalla completa).
export default function Notificaciones({ layout = "pagina" }: { layout?: "pagina" | "panel" | "completa" }) {
  const { confirmDialog } = useConfirmDialog();
  const [destinatarios, setDestinatarios] = useState<any[] | null>(null);
  const [historial, setHistorial] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("TODOS");
  const [busca, setBusca] = useState("");
  const [soloActivos, setSoloActivos] = useState(false);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [titulo, setTitulo] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<any | null>(null);

  function cargar() {
    api.notificaciones.destinatarios().then(setDestinatarios).catch((e: any) => setError(e.message));
    api.notificaciones.historial().then(setHistorial).catch(() => setHistorial([]));
  }
  useEffect(cargar, []);

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (destinatarios ?? []).filter(
      (d) =>
        (filtro === "TODOS" || d.role === filtro) &&
        (!soloActivos || d.dispositivos > 0) &&
        (!q || String(d.nombre).toLowerCase().includes(q) || String(d.email).toLowerCase().includes(q))
    );
  }, [destinatarios, filtro, busca, soloActivos]);

  const elegidosLista = (destinatarios ?? []).filter((d) => elegidos.has(d.id));
  const conAviso = elegidosLista.filter((d) => d.dispositivos > 0).length;
  const sinAviso = elegidosLista.length - conAviso;
  const todosVisiblesTildados = visibles.length > 0 && visibles.every((d) => elegidos.has(d.id));

  function alternar(id: string) {
    setElegidos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function alternarVisibles() {
    setElegidos((prev) => {
      const n = new Set(prev);
      if (todosVisiblesTildados) visibles.forEach((d) => n.delete(d.id));
      else visibles.forEach((d) => n.add(d.id));
      return n;
    });
  }

  async function enviar() {
    setError("");
    setResultado(null);
    if (!titulo.trim() || !mensaje.trim()) return setError("Escribí el título y el mensaje.");
    if (elegidos.size === 0) return setError("Elegí al menos un destinatario.");
    const ok = await confirmDialog(
      `Vas a enviar "${titulo.trim()}" a ${elegidos.size} ${elegidos.size === 1 ? "destinatario" : "destinatarios"}.\n` +
        `Les llega a ${conAviso}${sinAviso > 0 ? ` (a otros ${sinAviso} no, porque no activaron las notificaciones)` : ""}.\n\n¿Enviar?`,
      { title: "Confirmar envío" }
    );
    if (!ok) return;
    setEnviando(true);
    try {
      const r = await api.notificaciones.enviar({ userIds: [...elegidos], titulo: titulo.trim(), mensaje: mensaje.trim() });
      setResultado(r);
      cargar();
    } catch (e: any) {
      setError(e.message || "No se pudo enviar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      {layout === "pagina" && <div className="topbar">
        <div>
          <h2>Notificaciones</h2>
          <div className="muted">
            Mandá un aviso al celular de supervisores, agentes y proveedores. Se envía solo cuando vos lo confirmás, a quienes elijas. Les llega solo a quienes activaron las notificaciones en su portal.
          </div>
        </div>
      </div>}

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: layout === "panel" ? "1fr" : "minmax(0, 1.2fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }} className={layout === "panel" ? "" : "notif-grid"}>
        <div className="panel">
          <h3 style={{ margin: "0 0 10px" }}>1. A quién</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {FILTROS.map((f) => (
              <button key={f.key} type="button" className={`btn small ${filtro === f.key ? "" : "secondary"}`} onClick={() => setFiltro(f.key)}>{f.label}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o usuario..." style={{ flex: "1 1 180px", minWidth: 0 }} />
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input type="checkbox" checked={soloActivos} onChange={(e) => setSoloActivos(e.target.checked)} /> Solo con notificaciones activas
            </label>
          </div>
          {destinatarios === null ? (
            <div className="muted">Cargando...</div>
          ) : visibles.length === 0 ? (
            <div className="muted">No hay nadie con ese filtro.</div>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <button type="button" className="btn secondary small" onClick={alternarVisibles}>
                  {todosVisiblesTildados ? "Quitar todos los de la lista" : `Seleccionar los ${visibles.length} de la lista`}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>{elegidos.size} elegidos</span>
              </div>
              <div style={{ maxHeight: layout === "panel" ? 240 : layout === "completa" ? "calc(100vh - 330px)" : 420, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
                {visibles.map((d) => (
                  <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                    <input type="checkbox" checked={elegidos.has(d.id)} onChange={() => alternar(d.id)} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{d.nombre}</b>
                      <span className="muted" style={{ fontSize: 12 }}> · {ROL[d.role] ?? d.role} · {d.email}</span>
                    </span>
                    <span className={`badge ${d.dispositivos > 0 ? "pos" : "neutral"}`}>{d.dispositivos > 0 ? "Activadas" : "Sin activar"}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h3 style={{ margin: "0 0 10px" }}>2. Qué decirles</h3>
          <div className="field">
            <label>Título <span className="muted">({titulo.length}/60)</span></label>
            <input value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Tu cierre de la semana ya está" />
          </div>
          <div className="field">
            <label>Mensaje <span className="muted">({mensaje.length}/240)</span></label>
            <textarea value={mensaje} maxLength={240} rows={4} onChange={(e) => setMensaje(e.target.value)} placeholder="Ej. Ya cargamos tu cierre. Entrá a tu portal para ver el detalle." />
          </div>
          <div className="saldo-sub" style={{ marginBottom: 6 }}>Así les llega:</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, border: "1px solid var(--border)", borderRadius: 12, background: "var(--panel-2)", marginBottom: 12 }}>
            <img src="/admin-icon-192.png" alt="" width={36} height={36} style={{ borderRadius: 9, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{titulo || "Título del aviso"}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{mensaje || "Acá va el mensaje."}</div>
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            {elegidos.size === 0
              ? "Todavía no elegiste a nadie."
              : `${elegidos.size} elegidos: les llega a ${conAviso}${sinAviso > 0 ? ` y ${sinAviso} no lo van a recibir (sin notificaciones activadas)` : ""}.`}
          </div>
          <button className="btn" onClick={enviar} disabled={enviando || elegidos.size === 0}>
            {enviando ? "Enviando..." : `Enviar a ${elegidos.size || ""} ${elegidos.size === 1 ? "persona" : "personas"}`.replace("  ", " ")}
          </button>

          {resultado && (
            <div className="panel" style={{ margin: "14px 0 0", padding: 12, background: "var(--panel-2)" }}>
              <b>Enviado.</b> Les llegó a {resultado.entregados} de {resultado.elegidos}.
              {resultado.sinActivar.length > 0 && (
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  No les llegó (sin notificaciones activadas): {resultado.sinActivar.map((x: any) => x.nombre).join(", ")}.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <h3 style={{ margin: "0 0 10px" }}>Avisos enviados</h3>
        {historial.length === 0 ? (
          <div className="muted">Todavía no enviaste ninguno.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr><th>Fecha</th><th>Título</th><th>Mensaje</th><th>Llegó a</th><th>Sin activar</th><th>Lo envió</th></tr>
              </thead>
              <tbody>
                {historial.map((h) => (
                  <tr key={h.id}>
                    <td>{dateTime(h.created_at)}</td>
                    <td><b>{h.titulo}</b></td>
                    <td style={{ maxWidth: 320 }}>{h.mensaje}</td>
                    <td>{h.entregados} de {h.elegidos}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{(h.sin_activar ?? []).map((x: any) => x.nombre).join(", ") || "—"}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{h.actor ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
