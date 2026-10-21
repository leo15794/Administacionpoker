import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { dateTime } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";
import AvisoImagenes from "../components/AvisoImagenes";
import { comprimirImagen, tamanoLegible } from "../imagenes";

// Avisos push a supervisores, proveedores y agentes (21/10/2026, pedido de Leo). Siempre a mano: nada se manda solo,
// se elige a quién (todos o algunos), se escribe el aviso y se confirma antes de enviar.
const MAX_IMAGENES = 10;

// Avisos rápidos (21/10/2026, pedido de Leo): precargan título y mensaje, que se pueden editar antes de enviar.
// Semanas de lunes a domingo, igual que los cierres: los torneos son de la semana en curso y el cierre es el de la semana que terminó.
function rangoSemana(desfase: number): string {
  const hoy = new Date();
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - ((hoy.getDay() + 6) % 7) + desfase * 7);
  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
  const f = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${f(lunes)} al ${f(domingo)}`;
}
const AVISOS_RAPIDOS = [
  { key: "torneos", etiqueta: "🏆 Torneos de la semana", titulo: () => "Torneos de la semana", mensaje: () => `Te dejamos los torneos de esta semana (${rangoSemana(0)}). Mirá las imágenes en tu portal.` },
  { key: "cierre", etiqueta: "📅 Cierre semanal", titulo: () => "Tu cierre de la semana ya está", mensaje: () => `Ya cargamos tu cierre de la semana del ${rangoSemana(-1)}. Entrá a tu portal para ver el detalle.` },
];
interface Adjunto {
  key: string;
  nombre: string;
  preview: string;
  estado: "subiendo" | "ok" | "error";
  id?: string;
  size?: number;
  error?: string;
}
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
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [arrastrando, setArrastrando] = useState(false);

  // Subir todas juntas: se pueden elegir varias a la vez (o arrastrarlas) y se achican y suben de a 3 en paralelo.
  async function agregarArchivos(lista: FileList | File[]) {
    setError("");
    const archivos = [...lista].filter((f) => f.type.startsWith("image/"));
    const lugar = MAX_IMAGENES - adjuntos.length;
    if (archivos.length > lugar) setError(`Entran hasta ${MAX_IMAGENES} imágenes por aviso: se agregaron ${Math.max(lugar, 0)} de ${archivos.length}.`);
    const nuevos: Adjunto[] = archivos.slice(0, Math.max(lugar, 0)).map((f) => ({ key: Math.random().toString(36).slice(2), nombre: f.name, preview: URL.createObjectURL(f), estado: "subiendo" as const }));
    if (nuevos.length === 0) return;
    setAdjuntos((prev) => [...prev, ...nuevos]);
    const cola = nuevos.map((n, i) => ({ n, f: archivos[i] }));
    const actualizar = (key: string, cambio: Partial<Adjunto>) => setAdjuntos((prev) => prev.map((a) => (a.key === key ? { ...a, ...cambio } : a)));
    async function trabajador() {
      for (let item = cola.shift(); item; item = cola.shift()) {
        try {
          const blob = await comprimirImagen(item.f);
          const r = await api.notificaciones.subirImagen(blob, item.f.name.replace(/\.[^.]+$/, "") + ".jpg");
          actualizar(item.n.key, { estado: "ok", id: r.id, size: r.size });
        } catch (e: any) {
          actualizar(item.n.key, { estado: "error", error: e?.message || "No se pudo subir." });
        }
      }
    }
    await Promise.all([trabajador(), trabajador(), trabajador()]);
  }
  const subiendo = adjuntos.some((a) => a.estado === "subiendo");
  const imagenesListas = adjuntos.filter((a) => a.estado === "ok" && a.id);

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

  async function eliminar(h: any) {
    const ok = await confirmDialog(`¿Eliminar el aviso "${h.titulo}"?
Desaparece del portal de los ${h.elegidos} que lo recibieron${(h.imagenes ?? []).length > 0 ? ` y se borran sus ${h.imagenes.length} imágenes` : ""}. No se puede deshacer.`, { title: "Eliminar aviso", danger: true });
    if (!ok) return;
    try {
      await api.notificaciones.eliminarAviso(h.id);
      cargar();
    } catch (e: any) {
      setError(e.message || "No se pudo eliminar.");
    }
  }

  async function enviar() {
    setError("");
    setResultado(null);
    if (!titulo.trim() || !mensaje.trim()) return setError("Escribí el título y el mensaje.");
    if (elegidos.size === 0) return setError("Elegí al menos un destinatario.");
    if (subiendo) return setError("Esperá a que terminen de subir las imágenes.");
    if (adjuntos.some((a) => a.estado === "error")) return setError("Hay imágenes que no se pudieron subir: quitalas o volvé a agregarlas.");
    const ok = await confirmDialog(
      `Vas a enviar "${titulo.trim()}" a ${elegidos.size} ${elegidos.size === 1 ? "destinatario" : "destinatarios"}.\n` +
        `${imagenesListas.length > 0 ? `Lleva ${imagenesListas.length} ${imagenesListas.length === 1 ? "imagen" : "imágenes"}.\n` : ""}` +
        `Notificación al celular: ${conAviso}${sinAviso > 0 ? ` (los otros ${sinAviso} lo ven al entrar a su portal, porque no activaron las notificaciones)` : ""}.\n\n¿Enviar?`,
      { title: "Confirmar envío" }
    );
    if (!ok) return;
    setEnviando(true);
    try {
      const r = await api.notificaciones.enviar({ userIds: [...elegidos], titulo: titulo.trim(), mensaje: mensaje.trim(), imagenIds: imagenesListas.map((a) => a.id!) });
      setResultado(r);
      adjuntos.forEach((a) => URL.revokeObjectURL(a.preview));
      setAdjuntos([]);
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <span className="muted" style={{ fontSize: 12 }}>Aviso rápido:</span>
            {AVISOS_RAPIDOS.map((a) => (
              <button key={a.key} type="button" className="btn secondary small" onClick={() => { setTitulo(a.titulo()); setMensaje(a.mensaje()); }}>{a.etiqueta}</button>
            ))}
          </div>
          <div className="field">
            <label>Título <span className="muted">({titulo.length}/60)</span></label>
            <input value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. Tu cierre de la semana ya está" />
          </div>
          <div className="field">
            <label>Mensaje <span className="muted">({mensaje.length}/240)</span></label>
            <textarea value={mensaje} maxLength={240} rows={4} onChange={(e) => setMensaje(e.target.value)} placeholder="Ej. Ya cargamos tu cierre. Entrá a tu portal para ver el detalle." />
          </div>
          <div className="field">
            <label>Imágenes <span className="muted">({adjuntos.length}/{MAX_IMAGENES}) · opcional</span></label>
            <label
              className="np-drop"
              onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(e) => { e.preventDefault(); setArrastrando(false); agregarArchivos(e.dataTransfer.files); }}
              style={{ display: "block", padding: "14px 12px", textAlign: "center", border: `2px dashed ${arrastrando ? "var(--accent)" : "var(--border-strong, var(--border))"}`, borderRadius: 12, cursor: adjuntos.length >= MAX_IMAGENES ? "not-allowed" : "pointer", background: arrastrando ? "var(--accent-soft)" : "transparent" }}
            >
              <input type="file" accept="image/*" multiple disabled={adjuntos.length >= MAX_IMAGENES} style={{ display: "none" }} onChange={(e) => { if (e.target.files) agregarArchivos(e.target.files); e.target.value = ""; }} />
              <b>Elegí todas juntas</b> o arrastralas acá
              <div className="muted" style={{ fontSize: 12 }}>Hasta {MAX_IMAGENES} imágenes. Se achican solas antes de subir.</div>
            </label>
            {adjuntos.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {adjuntos.map((a) => (
                  <div key={a.key} style={{ position: "relative", width: 72 }} title={a.error || a.nombre}>
                    <div style={{ width: 72, height: 72, borderRadius: 10, overflow: "hidden", border: `1px solid ${a.estado === "error" ? "var(--red)" : "var(--border)"}`, background: "var(--panel-2)" }}>
                      <img src={a.preview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: a.estado === "subiendo" ? 0.45 : 1 }} />
                    </div>
                    <button type="button" onClick={() => { URL.revokeObjectURL(a.preview); setAdjuntos((prev) => prev.filter((x) => x.key !== a.key)); }} aria-label="Quitar" style={{ position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)", fontSize: 11, cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
                    <div className="muted" style={{ fontSize: 10.5, textAlign: "center", marginTop: 2 }}>{a.estado === "subiendo" ? "Subiendo..." : a.estado === "error" ? "Error" : tamanoLegible(a.size || 0)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="saldo-sub" style={{ marginBottom: 6 }}>Así les llega:</div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, border: "1px solid var(--border)", borderRadius: 12, background: "var(--panel-2)", marginBottom: 12 }}>
            <img src="/admin-icon-192.png" alt="" width={36} height={36} style={{ borderRadius: 9, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{titulo || "Título del aviso"}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{mensaje || "Acá va el mensaje."}</div>
              {imagenesListas.length > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>🖼 {imagenesListas.length} {imagenesListas.length === 1 ? "imagen" : "imágenes"} (la primera se ve grande en Android)</div>}
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            {elegidos.size === 0
              ? "Todavía no elegiste a nadie."
              : `${elegidos.size} elegidos: les llega a ${conAviso}${sinAviso > 0 ? ` y ${sinAviso} no lo van a recibir (sin notificaciones activadas)` : ""}.`}
          </div>
          <button className="btn" onClick={enviar} disabled={enviando || subiendo || elegidos.size === 0}>
            {enviando ? "Enviando..." : `Enviar a ${elegidos.size || ""} ${elegidos.size === 1 ? "persona" : "personas"}`.replace("  ", " ")}
          </button>

          {resultado && (
            <div className="panel" style={{ margin: "14px 0 0", padding: 12, background: "var(--panel-2)" }}>
              <b>Enviado.</b> Notificación al celular de {resultado.entregados} de {resultado.elegidos}. Todos lo ven en su portal.
              {resultado.sinActivar.length > 0 && (
                <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                  Sin notificaciones activadas (lo ven al entrar a su portal): {resultado.sinActivar.map((x: any) => x.nombre).join(", ")}.
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
                <tr><th>Fecha</th><th>Título</th><th>Mensaje</th><th>Imágenes</th><th>Notificación a</th><th>Sin activar</th><th>Lo envió</th><th></th></tr>
              </thead>
              <tbody>
                {historial.map((h) => (
                  <tr key={h.id}>
                    <td>{dateTime(h.created_at)}</td>
                    <td><b>{h.titulo}</b></td>
                    <td style={{ maxWidth: 320 }}>{h.mensaje}</td>
                    <td style={{ minWidth: 60 }}><AvisoImagenes imagenes={h.imagenes ?? []} compacto /></td>
                    <td>{h.entregados} de {h.elegidos}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{(h.sin_activar ?? []).map((x: any) => x.nombre).join(", ") || "—"}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{h.actor ?? "—"}</td>
                    <td><button type="button" className="btn secondary small" onClick={() => eliminar(h)} title="Lo saca del portal de todos los que lo recibieron">Eliminar</button></td>
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
