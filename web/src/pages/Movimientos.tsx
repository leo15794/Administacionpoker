import { useEffect, useState } from "react";
import { api } from "../api";
import CargarMovimiento from "../components/CargarMovimiento";
import MovimientosHistorial from "../components/MovimientosHistorial";
import SaldoHistorico from "../components/SaldoHistorico";
import { AdelantosPanel } from "./Adelantos";
import Ayuda from "../components/Ayuda";

// (19/10/2026, pedido de Leo: "programá todo lo de Cargar movimiento", mockups aprobados) -- la
// pantalla pasa de 4 paneles apilados (formulario + historial + saldo histórico + adelantos, ~2.700 px
// en escritorio y ~4.900 px en celular) a 4 pestañas. El formulario vive ahora en
// components/CargarMovimiento.tsx (misma lógica de negocio y mismos endpoints que tenía acá: tipos,
// validaciones, adelantos de rakeback/fichas, valor de la ficha, cotización en vivo de Tiny, etc.) y
// el historial en components/MovimientosHistorial.tsx. Gestionar adelantos que ya existen (ajustar,
// corregir, eliminar, ver historial) sigue en la pestaña Adelantos, tal cual.
type Pestana = "cargar" | "historial" | "saldo" | "adelantos";

// Filtros del historial (29/09/2026, pedido de Leo: "faltarian filtros para poder rastrear un
// movimiento") -- mismos tipos que puede tener un ledger_movement real. (19/10/2026) Se suman los
// tipos automáticos para poder rastrearlos también.
const TIPOS_FILTRO = [
  { value: "CARGA", label: "Carga" },
  { value: "DESCARGA", label: "Descarga" },
  { value: "COBRO", label: "Cobro" },
  { value: "PAGO", label: "Pago" },
  { value: "TRANSFERENCIA_ENTRE_CLUBES", label: "Transferencia" },
  { value: "TICKET_PROMOCIONAL", label: "Ticket promocional" },
  { value: "AJUSTE", label: "Ajuste" },
  { value: "ADELANTO_RAKEBACK", label: "Adelanto de rakeback (USDT)" },
  { value: "ADELANTO_FICHAS", label: "Adelanto de fichas" },
  { value: "COBRO_RAKEBACK", label: "Cobro de rakeback" },
  { value: "PAGO_RAKEBACK", label: "Pago de rakeback pendiente" },
  { value: "CIERRE_SEMANAL", label: "Cierre semanal" },
];

function fechaLocalISO(d: Date) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export default function Movimientos() {
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [pestana, setPestana] = useState<Pestana>("cargar");
  const [refreshKey, setRefreshKey] = useState(0);

  // Filtros del historial.
  const [filtroAgentId, setFiltroAgentId] = useState("");
  const [filtroClubId, setFiltroClubId] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");

  useEffect(() => {
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
  }, []);

  function rangoRapido(dias: number | null) {
    if (dias === null) {
      setFiltroDesde("");
      setFiltroHasta("");
      return;
    }
    const hoy = new Date();
    setFiltroHasta(fechaLocalISO(hoy));
    setFiltroDesde(fechaLocalISO(new Date(hoy.getTime() - (dias - 1) * 86400000)));
  }
  const hoyISO = fechaLocalISO(new Date());
  const rangoActivo = (dias: number | null) =>
    dias === null ? !filtroDesde && !filtroHasta : filtroHasta === hoyISO && filtroDesde === fechaLocalISO(new Date(Date.now() - (dias - 1) * 86400000));

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <h2>Cargar movimiento <Ayuda>Cada movimiento se aplica al instante y actualiza los saldos en el momento.</Ayuda></h2>
        </div>
      </div>

      <div className="tabs cargar-tabs">
        <button className={pestana === "cargar" ? "active" : ""} onClick={() => setPestana("cargar")}>Cargar</button>
        <button className={pestana === "historial" ? "active" : ""} onClick={() => setPestana("historial")}>Historial</button>
        <button className={pestana === "saldo" ? "active" : ""} onClick={() => setPestana("saldo")}>Saldo histórico</button>
        <button className={pestana === "adelantos" ? "active" : ""} onClick={() => setPestana("adelantos")}>Adelantos</button>
      </div>

      {pestana === "cargar" && (
        <>
          <CargarMovimiento agentes={agentes} clubes={clubes} onRegistrado={() => setRefreshKey((k) => k + 1)} />
          <div className="panel" style={{ marginTop: 20 }}>
            <h3 style={{ marginTop: 0 }}>Últimos movimientos</h3>
            <MovimientosHistorial key={`ult-${refreshKey}`} conFiltroCierres />
          </div>
        </>
      )}

      {pestana === "historial" && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Historial de movimientos cargados <Ayuda>Últimos movimientos registrados en el sistema (los más recientes primero), para verificar rápido lo que se fue cargando.</Ayuda></h3>
          <div className="form-grid" style={{ marginBottom: 10 }}>
            <div className="field">
              <label>Agente</label>
              <select value={filtroAgentId} onChange={(e) => setFiltroAgentId(e.target.value)}>
                <option value="">Todos</option>
                {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Club</label>
              <select value={filtroClubId} onChange={(e) => setFiltroClubId(e.target.value)}>
                <option value="">Todos</option>
                {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                <option value="">Todos</option>
                {TIPOS_FILTRO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Desde</label>
              <input value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} type="date" />
            </div>
            <div className="field">
              <label>Hasta</label>
              <input value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} type="date" />
            </div>
          </div>
          <div className="chips-row" style={{ marginBottom: 14 }}>
            <button type="button" className={`chipx${rangoActivo(1) ? " on" : ""}`} onClick={() => rangoRapido(1)}>Hoy</button>
            <button type="button" className={`chipx${rangoActivo(7) ? " on" : ""}`} onClick={() => rangoRapido(7)}>Últimos 7 días</button>
            <button type="button" className={`chipx${rangoActivo(30) ? " on" : ""}`} onClick={() => rangoRapido(30)}>Últimos 30 días</button>
            <button type="button" className={`chipx${rangoActivo(null) ? " on" : ""}`} onClick={() => rangoRapido(null)}>Todo</button>
          </div>
          <MovimientosHistorial
            key={`hist-${refreshKey}`}
            agentId={filtroAgentId || undefined}
            clubId={filtroClubId || undefined}
            type={filtroTipo || undefined}
            desde={filtroDesde || undefined}
            hasta={filtroHasta || undefined}
            conFiltroCierres={!filtroTipo}
          />
        </div>
      )}

      {pestana === "saldo" && <SaldoHistorico agentes={agentes} clubes={clubes} />}

      {/* (29/09/2026, pedido de Leo: "la sección adelantos debería desaparecer") -- unificada acá del
          todo, ya no es una pantalla propia. clubes ya está cargado arriba para el resto de la
          pantalla, se reusa en vez de volver a pedirlo. */}
      {pestana === "adelantos" && (
        <div className="panel">
          <AdelantosPanel clubes={clubes} />
        </div>
      )}
    </div>
  );
}
