import { useEffect, useState } from "react";
import { api } from "../api";

/**
 * "Jugadores bancados" (pedido 14/09/2026): un jugador puntual de un agente que hay que excluir
 * del cierre agregado de ese agente porque se contabiliza aparte (fuera del sistema, por ahora).
 * NO confundir con agents.account_type = "BANCADO" (eso es una cuenta de AGENTE con motor de
 * cierre propio) — esto es un JUGADOR individual dentro del roster de un agente normal.
 *
 * Al marcarlo acá, la próxima vez que se importe un archivo con ese jugador (por club+ID, ver
 * players.bancado), el sistema lo va a omitir del agregado de su agente y va a mostrar el total
 * omitido en la vista previa de esa importación (Cierres -> Importar archivo).
 */
export default function JugadoresBancados() {
  const [bancados, setBancados] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [error, setError] = useState("");

  function refresh() {
    setCargando(true);
    api
      .jugadoresBancados()
      .then(setBancados)
      .catch((e: any) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const timeout = setTimeout(() => {
      api
        .buscarJugadores(busqueda)
        .then(setResultados)
        .catch((e: any) => setError(e.message))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [busqueda]);

  async function marcar(playerId: string, bancado: boolean) {
    setMarcando(playerId);
    try {
      await api.setJugadorBancado(playerId, bancado);
      refresh();
      if (bancado) {
        // Saca el resultado de la lista de búsqueda para que quede claro que ya se marcó, sin
        // tener que volver a tipear la búsqueda.
        setResultados((rs) => rs.map((r) => (r.id === playerId ? { ...r, bancado: true } : r)));
      }
    } catch (err: any) {
      alert(err.message || "No se pudo actualizar el jugador.");
    } finally {
      setMarcando(null);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Jugadores bancados</h2>
          <div className="muted">
            Un jugador marcado acá se omite del cierre agregado de su agente en la próxima importación — su rake/resultado se
            contabiliza aparte, no entra a la cuenta normal del agente.
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Buscar y marcar un jugador</h3>
        <input
          type="text"
          placeholder="Nombre o ID del jugador..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{ width: 320, marginBottom: 10 }}
        />
        {error && <div className="error">{error}</div>}
        {busqueda.trim().length >= 2 && (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Jugador</th>
                  <th>ID</th>
                  <th>Club</th>
                  <th>Agente</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {buscando && (
                  <tr>
                    <td colSpan={5} className="muted">Buscando...</td>
                  </tr>
                )}
                {!buscando && resultados.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">Sin resultados.</td>
                  </tr>
                )}
                {resultados.map((r) => (
                  <tr key={r.id}>
                    <td>{r.display_name ?? <span className="muted">Sin nombre</span>}</td>
                    <td className="muted">{r.external_id}</td>
                    <td>{r.club_name}</td>
                    <td>{r.agent_name ?? <span className="muted">Sin agente</span>}</td>
                    <td className="row-actions">
                      {r.bancado ? (
                        <span className="badge pos">Ya es bancado</span>
                      ) : (
                        <button className="btn secondary small" disabled={marcando === r.id} onClick={() => marcar(r.id, true)}>
                          {marcando === r.id ? "..." : "Marcar bancado"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Jugadores marcados como bancados ({bancados.length})</h3>
        {cargando ? (
          <div className="muted">Cargando...</div>
        ) : bancados.length === 0 ? (
          <div className="muted">Todavía no hay ningún jugador marcado como bancado.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Jugador</th>
                  <th>ID</th>
                  <th>Club</th>
                  <th>Agente</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bancados.map((b) => (
                  <tr key={b.id}>
                    <td>{b.display_name ?? <span className="muted">Sin nombre</span>}</td>
                    <td className="muted">{b.external_id}</td>
                    <td>{b.club_name}</td>
                    <td>{b.agent_name ?? <span className="muted">Sin agente</span>}</td>
                    <td className="row-actions">
                      <button
                        className="btn secondary small"
                        disabled={marcando === b.id}
                        onClick={() => marcar(b.id, false)}
                        title="Vuelve a contarlo dentro del cierre normal de su agente en la próxima importación."
                      >
                        {marcando === b.id ? "..." : "Quitar"}
                      </button>
                    </td>
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
