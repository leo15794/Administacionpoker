// Buscador global de agentes/jugadores (28/09/2026, pedido de Leo: "un buscador que esté
// siempre activo... y poder ver su información") -- vive en Shell.tsx, arriba de cualquier
// pantalla, para no tener que ir a Agentes o buscar un jugador desde adentro de otra pantalla
// puntual. v1: SOLO VER (sin acciones todavía -- eso queda para una segunda vuelta, ver
// conversación). Reusa endpoints que YA EXISTEN:
//   - agentes: GET /dashboard/agentes (ya se usaba en Agentes.tsx) -- filtro por nombre en el
//     cliente (la lista de agentes activos no es grande, no hace falta pegarle al servidor).
//   - jugadores: GET /catalog/players/buscar (ya existía, se usaba en el importador de TeamBack)
//     -- ese sí busca en el servidor (LIKE sobre miles de jugadores no se puede traer entero).
//   - ficha de agente: GET /agents/:id/cuenta (YA EXISTÍA en el backend pero ninguna pantalla de
//     admin lo consumía todavía -- trae saldo por club, garantía, últimos cierres, movimientos,
//     stock y adelantos, todo junto).
//   - ficha de jugador bancado: GET /bancados/estado/:playerId + /bancados/historial/:playerId
//     (los mismos que ya usa JugadoresBancados.tsx). Un jugador que no es bancado no tiene más
//     información propia en el sistema todavía -- se muestra solo club/agente.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "./Modal";

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [agentesTodos, setAgentesTodos] = useState<any[] | null>(null);
  const [jugadores, setJugadores] = useState<any[]>([]);
  const [buscandoJugadores, setBuscandoJugadores] = useState(false);
  const [fichaAgenteId, setFichaAgenteId] = useState<string | null>(null);
  const [fichaJugador, setFichaJugador] = useState<any | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) {
      setJugadores([]);
      return;
    }
    if (agentesTodos === null) {
      api.agentes().then(setAgentesTodos).catch(() => setAgentesTodos([]));
    }
    setBuscandoJugadores(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api
        .buscarJugadores(q)
        .then(setJugadores)
        .catch(() => setJugadores([]))
        .finally(() => setBuscandoJugadores(false));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const qLower = q.toLowerCase();
  const agentesFiltrados =
    q.length >= 2 && agentesTodos ? agentesTodos.filter((a) => a.name.toLowerCase().includes(qLower)).slice(0, 8) : [];
  const hayResultados = agentesFiltrados.length > 0 || jugadores.length > 0;

  return (
    <div className="global-search" ref={boxRef}>
      <div className="global-search-input">
        <span className="global-search-icon">⌕</span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          placeholder="Buscar agente o jugador..."
        />
      </div>
      {abierto && q.length >= 2 && (
        <div className="global-search-dropdown">
          {!hayResultados && !buscandoJugadores && <div className="muted" style={{ padding: 12 }}>Sin resultados.</div>}
          {agentesFiltrados.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-label">Agentes</div>
              {agentesFiltrados.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="global-search-item"
                  onClick={() => {
                    setFichaAgenteId(a.id);
                    setAbierto(false);
                    setQuery("");
                  }}
                >
                  <span>{a.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{a.default_system === "PREPAGO" ? "Prepago" : "Win/Lose"}</span>
                </button>
              ))}
            </div>
          )}
          {jugadores.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-label">Jugadores</div>
              {jugadores.map((j) => (
                <button
                  key={j.id}
                  type="button"
                  className="global-search-item"
                  onClick={() => {
                    setFichaJugador(j);
                    setAbierto(false);
                    setQuery("");
                  }}
                >
                  <span>{j.display_name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {j.club_name}
                    {j.bancado ? " · Bancado" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {fichaAgenteId && <FichaAgente agentId={fichaAgenteId} onClose={() => setFichaAgenteId(null)} />}
      {fichaJugador && <FichaJugador jugador={fichaJugador} onClose={() => setFichaJugador(null)} />}
    </div>
  );
}

function FichaAgente({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .cuentaDeAgente(agentId)
      .then(setData)
      .catch((e: any) => setError(e.message || "No se pudo cargar la cuenta de este agente."));
  }, [agentId]);

  const saldoTotal = data ? data.saldos.reduce((s: number, b: any) => s + Number(b.amount), 0) : 0;
  const adelantosPendientes = data
    ? data.adelantos.reduce((s: number, a: any) => s + (Number(a.amount) - Number(a.consumed)), 0)
    : 0;

  return (
    <Modal title={data ? data.agente.name : "Agente"} onClose={onClose} wide>
      {error && <div className="error">{error}</div>}
      {!data && !error && <div className="muted">Cargando...</div>}
      {data && (
        <div>
          <div className="muted" style={{ marginBottom: 14 }}>
            Sistema: {data.agente.default_system === "PREPAGO" ? "Prepago" : "Win/Lose"}
            {data.agente.supervisor ? ` · Supervisor: ${data.agente.supervisor}` : ""}
          </div>

          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <div className="kpi-card">
              <div className="label">Saldo neto total</div>
              <div className={`value ${saldoTotal >= 0 ? "pos" : "neg"}`}>{usd(saldoTotal)}</div>
            </div>
            {data.garantia && (
              <div className="kpi-card">
                <div className="label">Garantía vigente</div>
                <div className="value">{usd(data.garantia.amount)}</div>
              </div>
            )}
            {adelantosPendientes > 0 && (
              <div className="kpi-card">
                <div className="label">Adelantos pendientes</div>
                <div className="value">{usd(adelantosPendientes)}</div>
              </div>
            )}
          </div>

          <h4>Saldo por club</h4>
          <table>
            <thead>
              <tr>
                <th>Club</th>
                <th>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.saldos.map((b: any) => (
                <tr key={b.club_id}>
                  <td>{b.club_name}</td>
                  <td className={Number(b.amount) >= 0 ? "money pos" : "money neg"}>{usd(b.amount)}</td>
                </tr>
              ))}
              {data.saldos.length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">
                    Sin saldo cargado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {data.stock.length > 0 && (
            <>
              <h4 style={{ marginTop: 16 }}>Stock por cuenta</h4>
              <table>
                <thead>
                  <tr>
                    <th>Club</th>
                    <th>Unidades</th>
                    <th>≈ USD</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stock.map((s: any) => (
                    <tr key={s.club_id}>
                      <td>{s.club_name}</td>
                      <td>{s.units}</td>
                      <td>{s.usd_ref != null ? usd(s.usd_ref) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h4 style={{ marginTop: 16 }}>Últimos cierres</h4>
          <table>
            <thead>
              <tr>
                <th>Semana</th>
                <th>Club</th>
                <th>Resultado</th>
                <th>Rakeback</th>
              </tr>
            </thead>
            <tbody>
              {data.cierres.slice(0, 10).map((c: any) => (
                <tr key={c.id}>
                  <td className="muted">{dateShort(c.week_start)}</td>
                  <td>{c.club_name}</td>
                  <td className={Number(c.result) >= 0 ? "money pos" : "money neg"}>{usd(c.result)}</td>
                  <td>{usd(c.rakeback)}</td>
                </tr>
              ))}
              {data.cierres.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Sin cierres todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <h4 style={{ marginTop: 16 }}>Últimos movimientos</h4>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Club</th>
                <th>Importe</th>
              </tr>
            </thead>
            <tbody>
              {data.movimientos.slice(0, 10).map((m: any) => (
                <tr key={m.id}>
                  <td className="muted">{dateShort(m.occurred_at)}</td>
                  <td>{m.type}</td>
                  <td>{m.club_name}</td>
                  <td>{usd(m.amount)}</td>
                </tr>
              ))}
              {data.movimientos.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Sin movimientos todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function FichaJugador({ jugador, onClose }: { jugador: any; onClose: () => void }) {
  const [estado, setEstado] = useState<any>(null);
  const [historial, setHistorial] = useState<any[]>([]);
  const [sinBanca, setSinBanca] = useState(false);

  useEffect(() => {
    if (!jugador.bancado) return;
    api
      .bancadoEstado(jugador.id)
      .then(setEstado)
      .catch(() => setSinBanca(true));
    api
      .historialBancado(jugador.id)
      .then(setHistorial)
      .catch(() => {});
  }, [jugador.id, jugador.bancado]);

  return (
    <Modal title={jugador.display_name} onClose={onClose} wide>
      <div className="muted" style={{ marginBottom: 14 }}>
        {jugador.club_name}
        {jugador.agent_name ? ` · Agente: ${jugador.agent_name}` : ""}
        {jugador.bancado ? " · Bancado" : ""}
      </div>

      {!jugador.bancado && (
        <div className="muted">No es un jugador bancado -- todavía no hay más información propia para mostrar acá.</div>
      )}

      {jugador.bancado && sinBanca && (
        <div className="muted">Está marcado como bancado pero todavía no tiene la banca configurada (ver Jugadores bancados).</div>
      )}

      {jugador.bancado && estado && (
        <>
          <div className="kpi-grid" style={{ marginBottom: 16 }}>
            <div className="kpi-card">
              <div className="label">Capital actual</div>
              <div className="value">{usd(estado.estado.capitalActual)}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Makeup actual</div>
              <div className={`value ${estado.estado.makeupActual > 0 ? "neg" : ""}`}>{usd(estado.estado.makeupActual)}</div>
            </div>
            <div className="kpi-card">
              <div className="label">Semanas cerradas</div>
              <div className="value">{estado.resumen.semanasCerradas}</div>
            </div>
          </div>

          <h4>Últimos cierres de banca</h4>
          <table>
            <thead>
              <tr>
                <th>Semana</th>
                <th>Rake</th>
                <th>Rakeback</th>
                <th>Capital después</th>
              </tr>
            </thead>
            <tbody>
              {historial.slice(0, 10).map((h: any) => (
                <tr key={h.id}>
                  <td className="muted">{dateShort(h.week_start)}</td>
                  <td>{usd(h.rake_total)}</td>
                  <td>{usd(h.rakeback_total)}</td>
                  <td>{usd(h.capital_despues)}</td>
                </tr>
              ))}
              {historial.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Sin cierres todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}
