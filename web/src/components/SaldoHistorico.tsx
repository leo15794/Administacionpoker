import { useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";

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
  ADELANTO_RAKEBACK: "Adelanto de rakeback (USDT)",
  ADELANTO_FICHAS: "Adelanto de fichas",
};

type Granularidad = "dia" | "semana";

function labelPeriodo(periodo: string, gran: Granularidad) {
  if (gran === "dia") return dateShort(periodo);
  return `Semana del ${dateShort(periodo)}`;
}

// Evolución del saldo acumulado (30/09/2026, pedido de Leo: "ver como se va construyendo el
// saldo, con los dias que yo elija libremente -- no atado a la semana de cierre -- y poder
// sumar varios agentes juntos"). A diferencia del historial de arriba (que solo lista
// movimientos sueltos), esto reconstruye el saldo acumulado movimiento a movimiento -- mismo
// principio que ya usa el drill-down de saldo por proveedor en Proveedores.tsx, pero acá se
// puede combinar más de un agente a la vez y elegir cualquier rango de fechas (ver
// repo/ledger.ts -> getSaldoHistorico).
export default function SaldoHistorico({ agentes, clubes }: { agentes: any[]; clubes: any[] }) {
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [busquedaAgente, setBusquedaAgente] = useState("");
  const [clubId, setClubId] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [granularidad, setGranularidad] = useState<Granularidad>("dia");
  const [mostrarDetalle, setMostrarDetalle] = useState(false);

  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function toggleAgente(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const agentesFiltrados = busquedaAgente.trim()
    ? agentes.filter((a) => a.name.toLowerCase().includes(busquedaAgente.trim().toLowerCase()))
    : agentes;

  function seleccionarTodos() {
    setSeleccionados((prev) => new Set([...prev, ...agentesFiltrados.map((a) => a.id)]));
  }
  function destildarTodos() {
    // Solo destilda los que están visibles con el filtro actual -- si ya elegiste agentes de
    // otra búsqueda antes, esos quedan como estaban (30/09/2026, mismo criterio que "Todos": el
    // buscador filtra la LISTA, no pisa lo que ya elegiste).
    setSeleccionados((prev) => {
      const next = new Set(prev);
      for (const a of agentesFiltrados) next.delete(a.id);
      return next;
    });
  }

  async function verEvolucion() {
    if (seleccionados.size === 0) {
      setError("Elegí al menos un agente.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await api.saldoHistorico({
        agentIds: [...seleccionados],
        clubId: clubId || undefined,
        desde: desde || undefined,
        hasta: hasta || undefined,
      });
      setData(res);
    } catch (err: any) {
      setError(err.message || "No se pudo calcular la evolución del saldo.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  const serie = data ? (granularidad === "dia" ? data.porDia : data.porSemana) : [];

  return (
    <div className="panel" style={{ marginTop: 24 }}>
      <h3 style={{ marginTop: 0 }}>Evolución del saldo</h3>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
        Elegí uno o varios agentes (se suman entre sí), un club puntual o todos, y el rango de
        fechas que quieras -- no está atado a la semana de cierre. Muestra cómo se fue armando el
        saldo, día a día o semana a semana, hasta la fecha que elijas.
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label style={{ fontWeight: 600, fontSize: 13 }}>Agentes ({seleccionados.size} elegidos)</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="btn secondary small" onClick={seleccionarTodos}>Todos</button>
              <button type="button" className="btn secondary small" onClick={destildarTodos}>Ninguno</button>
            </div>
          </div>
          <input
            type="text"
            placeholder="Buscar agente..."
            value={busquedaAgente}
            onChange={(e) => setBusquedaAgente(e.target.value)}
            style={{ marginBottom: 6 }}
          />
          <div
            style={{
              maxHeight: 180,
              overflowY: "auto",
              border: "1px solid var(--border, #333)",
              borderRadius: 8,
              padding: 8,
            }}
          >
            {agentesFiltrados.length === 0 && (
              <div className="muted" style={{ fontSize: 13, padding: "4px 0" }}>Sin resultados para "{busquedaAgente}".</div>
            )}
            {agentesFiltrados.map((a) => (
              <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 13, cursor: "pointer" }}>
                <input type="checkbox" checked={seleccionados.has(a.id)} onChange={() => toggleAgente(a.id)} />
                {a.name}
              </label>
            ))}
          </div>
        </div>

        <div className="field" style={{ flex: "0 1 200px" }}>
          <label>Club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Todos los clubes</option>
            {clubes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: "0 1 160px" }}>
          <label>Desde</label>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="field" style={{ flex: "0 1 160px" }}>
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <div className="field" style={{ alignSelf: "flex-end" }}>
          <button className="btn" disabled={loading} onClick={verEvolucion}>
            {loading ? "Calculando..." : "Ver evolución"}
          </button>
        </div>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {data && (
        <>
          <div className="kpi-sub-grid" style={{ marginBottom: 16 }}>
            <div className="kpi-sub-card">
              <div className="kpi-sub-label">Saldo al inicio del rango</div>
              <div className="kpi-sub-value">{usd(data.saldoInicial)}</div>
            </div>
            <div className="kpi-sub-card">
              <div className="kpi-sub-label">Saldo al final del rango</div>
              <div className="kpi-sub-value" style={{ color: data.saldoFinal >= 0 ? "var(--green)" : "var(--red)" }}>
                {usd(data.saldoFinal)}
              </div>
            </div>
            <div className="kpi-sub-card">
              <div className="kpi-sub-label">Movimientos en el rango</div>
              <div className="kpi-sub-value">{data.movimientos.length}</div>
            </div>
          </div>

          <div className="topbar" style={{ marginBottom: 10 }}>
            <h4 style={{ margin: 0 }}>Saldo al cierre de cada período</h4>
            <div style={{ display: "flex", gap: 6 }}>
              <button className={`btn small ${granularidad === "dia" ? "" : "secondary"}`} onClick={() => setGranularidad("dia")}>Día</button>
              <button className={`btn small ${granularidad === "semana" ? "" : "secondary"}`} onClick={() => setGranularidad("semana")}>Semana</button>
            </div>
          </div>

          {serie.length === 0 ? (
            <div className="muted" style={{ marginBottom: 16 }}>No hay movimientos en este rango para lo elegido.</div>
          ) : (
            <div className="table-scroll" style={{ marginBottom: 16 }}>
              <table>
                <thead>
                  <tr>
                    <th>Período</th>
                    <th className="num">Movimientos</th>
                    <th className="num">Neto del período</th>
                    <th className="num">Saldo al cierre</th>
                  </tr>
                </thead>
                <tbody>
                  {serie.map((f: any) => (
                    <tr key={f.periodo}>
                      <td>{labelPeriodo(f.periodo, granularidad)}</td>
                      <td className="num muted">{f.movimientos}</td>
                      <td className={`num ${f.neto >= 0 ? "pos" : "neg"}`}>{usd(f.neto)}</td>
                      <td className="num"><strong>{usd(f.saldoCierre)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button className="btn secondary small" onClick={() => setMostrarDetalle((v) => !v)}>
            {mostrarDetalle ? "Ocultar movimiento a movimiento" : "Ver movimiento a movimiento"}
          </button>

          {mostrarDetalle && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Agente</th>
                    <th>Club</th>
                    <th className="num">Monto</th>
                    <th className="num">Saldo después</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movimientos.map((m: any) => (
                    <tr key={m.id} style={m.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                      <td className="muted">{dateShort(m.fecha)}</td>
                      <td>
                        <span className="badge neutral">{TIPO_LABEL[m.tipo] ?? m.tipo}</span>
                        {m.status === "REVERTIDO" && <span className="badge neg" style={{ marginLeft: 6 }}>Revertido</span>}
                      </td>
                      <td>{m.agentName}</td>
                      <td>{m.clubName}{m.clubDestinoName ? ` → ${m.clubDestinoName}` : ""}</td>
                      <td className="num"><span className={`badge ${m.delta > 0 ? "pos" : m.delta < 0 ? "neg" : "neutral"}`}>{usd(m.delta)}</span></td>
                      <td className="num muted">{usd(m.saldoNuevo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
