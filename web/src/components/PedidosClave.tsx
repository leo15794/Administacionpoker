import { useEffect, useState } from "react";
import { api } from "../api";

// Pedidos de "Olvidé mi contraseña" (10/11/2026, mockup 89): arriba de Mis agentes (supervisor), Mis subagentes (agente) y Usuarios (admin).
// Con un clic se genera una contraseña temporal; se muestra una sola vez para pasársela (Copiar o WhatsApp). Al entrar, la persona elige la suya.
function hace(fecha: string) {
  const min = Math.max(0, Math.round((Date.now() - new Date(fecha).getTime()) / 60000));
  if (min < 1) return "Recién";
  if (min < 60) return `Hace ${min} min`;
  if (min < 60 * 24) return `Hace ${Math.round(min / 60)} h`;
  return `Hace ${Math.round(min / (60 * 24))} días`;
}

export default function PedidosClave({ onResuelto }: { onResuelto?: () => void }) {
  const [pedidos, setPedidos] = useState<any[]>([]);
  const [generada, setGenerada] = useState<{ usuario: string; clave: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);

  function cargar() {
    api.pedidosClave().then(setPedidos).catch(() => {});
  }
  useEffect(cargar, []);

  async function generar(p: any) {
    setError("");
    setOcupado(p.id);
    try {
      const r = await api.generarClavePedido(p.id);
      setGenerada(r);
      setCopiado(false);
      cargar();
      onResuelto?.();
    } catch (err: any) {
      setError(err.message || "No se pudo generar.");
    } finally {
      setOcupado(null);
    }
  }

  async function ignorar(p: any) {
    setError("");
    setOcupado(p.id);
    try {
      await api.ignorarPedidoClave(p.id);
      cargar();
    } catch (err: any) {
      setError(err.message || "No se pudo.");
    } finally {
      setOcupado(null);
    }
  }

  if (pedidos.length === 0 && !generada && !error) return null;
  const mensaje = generada
    ? `Tu usuario es ${generada.usuario} y tu contraseña temporal es ${generada.clave}. Al entrar te va a pedir que elijas una nueva.`
    : "";

  return (
    <div className="pc-wrap">
      {pedidos.map((p) => (
        <div key={p.id} className="pc-pedido">
          <span className="pc-ic">!</span>
          <span className="pc-txt">
            <b>{p.usuario} pidió una contraseña nueva</b>
            <small>{hace(p.created_at)} · usuario {p.usuario}{p.cuenta && p.cuenta !== p.usuario ? ` (${p.cuenta})` : ""}</small>
          </span>
          <span className="pc-acc">
            <button className="btn secondary small" disabled={ocupado === p.id} onClick={() => ignorar(p)}>Ignorar</button>
            <button className="btn small" disabled={ocupado === p.id} onClick={() => generar(p)}>{ocupado === p.id ? "..." : "Generar contraseña temporal"}</button>
          </span>
        </div>
      ))}
      {error && <div className="error">{error}</div>}
      {generada && (
        <div className="pc-gen">
          <div className="pc-gen-h">
            <b>Contraseña temporal de {generada.usuario}</b>
            <span className="badge pos">✓ Generada · sus sesiones abiertas se cerraron</span>
            <button className="pc-x" onClick={() => setGenerada(null)} aria-label="Cerrar">✕</button>
          </div>
          <div className="pc-clave">
            <code>{generada.clave}</code>
            <button
              className="btn secondary small"
              onClick={() => {
                navigator.clipboard?.writeText(mensaje).then(() => setCopiado(true)).catch(() => {});
              }}
            >
              {copiado ? "✓ Copiado" : "Copiar mensaje"}
            </button>
            <a className="btn small" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer">
              Enviar por WhatsApp
            </a>
          </div>
          <div className="pc-msg">“{mensaje}”</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Solo se muestra ahora. Si la perdés, la persona puede volver a pedirla.</div>
        </div>
      )}
    </div>
  );
}
