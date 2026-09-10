import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { usd } from "../fmt";
import { exportCsv } from "../csv";
import Modal from "../components/Modal";
import MovimientosHistorial from "../components/MovimientosHistorial";

// Qué par agente+club cuenta para cada KPI, con el mismo signo que usa el balance: positivo =
// a favor del agente (le debemos), negativo = a favor nuestro (nos debe). Se usa tanto para las
// KPIs de arriba como para el filtro por signo de la tabla de abajo, así "hacer click en la KPI"
// y "ver el detalle que la compone" son siempre la misma cuenta.
type FiltroSigno = "todos" | "nosDeben" | "debemos";

function pasaFiltroSigno(amount: number, signo: FiltroSigno) {
  if (signo === "nosDeben") return amount < 0;
  if (signo === "debemos") return amount > 0;
  return true;
}

export default function Resumen() {
  const nav = useNavigate();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("");
  const [filtroSigno, setFiltroSigno] = useState<FiltroSigno>("todos");
  const [detalle, setDetalle] = useState<{ title: string; agentId?: string; clubId?: string } | null>(null);
  const tablaSaldosRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.resumen().then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">No se pudo cargar el resumen: {error}</div>;
  if (!data) return <div className="muted">Cargando...</div>;

  // Puente: hacer click en una KPI de arriba lleva directo al detalle que la compone — para
  // "Agentes nos deben"/"Debemos a agentes" es filtrar por signo la misma tabla de saldos de
  // abajo (nunca hace falta ir a buscarla aparte); para Wallet/Garantías/Agentes es navegar
  // directo a esa sección, que ya tiene su propio historial de movimientos.
  function irAKpi(signo: FiltroSigno) {
    setFiltroSigno(signo);
    tablaSaldosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const balancesFiltrados = data.balances
    .filter((b: any) => Number(b.amount) !== 0)
    .filter((b: any) => pasaFiltroSigno(Number(b.amount), filtroSigno))
    .filter((b: any) => {
      const q = filtro.trim().toLowerCase();
      if (!q) return true;
      return b.agent_name.toLowerCase().includes(q) || b.club_name.toLowerCase().includes(q);
    })
    .sort((a: any, b: any) => Number(b.amount) - Number(a.amount));

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Resumen ejecutivo</h2>
          <div className="muted">Calculado en vivo desde el ledger — no desde celdas fijas. Hacé click en un club o en un saldo para ver el detalle.</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div
          className={`kpi-card row-click${filtroSigno === "nosDeben" ? " kpi-active" : ""}`}
          onClick={() => irAKpi("nosDeben")}
          title="Ver el detalle de saldos por agente y club que arma este total"
        >
          <div className="label">Agentes nos deben</div>
          <div className="value neg">{usd(data.kpis.agentesNosDeben)}</div>
        </div>
        <div
          className={`kpi-card row-click${filtroSigno === "debemos" ? " kpi-active" : ""}`}
          onClick={() => irAKpi("debemos")}
          title="Ver el detalle de saldos por agente y club que arma este total"
        >
          <div className="label">Debemos a agentes</div>
          <div className="value pos">{usd(data.kpis.debemosAAgentes)}</div>
        </div>
        <div className="kpi-card row-click" onClick={() => nav("/dashboard/wallet")} title="Ir a Wallet — historial completo de movimientos">
          <div className="label">Saldo Wallet</div>
          <div className="value">{usd(data.kpis.saldoWallet)}</div>
        </div>
        <div className="kpi-card row-click" onClick={() => nav("/dashboard/garantias")} title="Ir a Garantías">
          <div className="label">Garantías pendientes</div>
          <div className="value">{usd(data.kpis.garantiasPendientes)}</div>
        </div>
        <div
          className="kpi-card row-click"
          onClick={() => document.getElementById("panel-saldo-por-club")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          title="Ver el saldo neto por club"
        >
          <div className="label">Clubes activos</div>
          <div className="value">{data.kpis.clubesActivos}</div>
        </div>
        <div className="kpi-card row-click" onClick={() => nav("/dashboard/agentes")} title="Ir a Agentes">
          <div className="label">Agentes activos</div>
          <div className="value">{data.kpis.agentesActivos}</div>
        </div>
      </div>
      <div className="muted" style={{ marginTop: -10, marginBottom: 20, fontSize: 12 }}>
        "Agentes nos deben" / "Debemos a agentes" son saldo de fichas y saldo pendiente por agente+club (igual que la planilla, sin mezclar garantías). Sumando además "Garantías pendientes" da el total general comparable contra la planilla. Hacé click en cualquier KPI para ver su detalle.
      </div>

      <div className="panel" id="panel-saldo-por-club">
        <div className="topbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Saldo neto por club</h3>
          <button
            className="btn secondary small"
            onClick={() =>
              exportCsv(
                "saldo_por_club.csv",
                data.porClub.map((c: any) => ({ club: c.club, agentes_con_saldo: c.agentes, saldo_neto: c.saldo_neto }))
              )
            }
          >
            Exportar CSV
          </button>
        </div>
        <table>
          <thead>
            <tr><th>Club</th><th>Agentes con saldo</th><th>Saldo neto</th></tr>
          </thead>
          <tbody>
            {data.porClub.map((c: any) => (
              <tr key={c.club_id} className="row-click" onClick={() => setDetalle({ title: `Movimientos — ${c.club}`, clubId: c.club_id })}>
                <td>{c.club}</td>
                <td>{c.agentes}</td>
                <td>
                  <span className={`badge ${Number(c.saldo_neto) > 0 ? "pos" : Number(c.saldo_neto) < 0 ? "neg" : "neutral"}`}>
                    {usd(c.saldo_neto)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel" ref={tablaSaldosRef}>
        <div className="topbar" style={{ marginBottom: 14, alignItems: "center" }}>
          <div>
            <h3 style={{ margin: 0 }}>Saldos por agente y club</h3>
            <div className="muted" style={{ marginTop: 2 }}>Positivo = a favor del agente</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              className="search-input"
              placeholder="Buscar agente o club..."
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            />
            <button
              className="btn secondary small"
              onClick={() =>
                exportCsv(
                  "saldos_por_agente_y_club.csv",
                  balancesFiltrados.map((b: any) => ({ agente: b.agent_name, club: b.club_name, saldo: b.amount }))
                )
              }
            >
              Exportar CSV
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className={`chip${filtroSigno === "todos" ? " chip-active" : ""}`} onClick={() => setFiltroSigno("todos")}>
            Todos
          </button>
          <button className={`chip${filtroSigno === "nosDeben" ? " chip-active" : ""}`} onClick={() => setFiltroSigno("nosDeben")}>
            Nos deben
          </button>
          <button className={`chip${filtroSigno === "debemos" ? " chip-active" : ""}`} onClick={() => setFiltroSigno("debemos")}>
            Debemos
          </button>
        </div>
        <table>
          <thead>
            <tr><th>Agente</th><th>Club</th><th>Saldo</th></tr>
          </thead>
          <tbody>
            {balancesFiltrados.map((b: any) => (
              <tr
                key={b.id}
                className="row-click"
                onClick={() => setDetalle({ title: `${b.agent_name} — ${b.club_name}`, agentId: b.agent_id, clubId: b.club_id })}
              >
                <td>{b.agent_name}</td>
                <td>{b.club_name}</td>
                <td>
                  <span className={`badge ${Number(b.amount) > 0 ? "pos" : "neg"}`}>{usd(b.amount)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {detalle && (
        <Modal title={detalle.title} onClose={() => setDetalle(null)} wide>
          <MovimientosHistorial agentId={detalle.agentId} clubId={detalle.clubId} />
        </Modal>
      )}
    </div>
  );
}
