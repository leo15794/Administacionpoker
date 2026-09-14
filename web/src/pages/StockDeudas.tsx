import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";

function num(n: number | string | null | undefined) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Tab = "resumen" | "deudas" | "prepago" | "consolidado" | "cuentas";

// Stock físico por cuenta y deudas consolidadas — equivalente a la planilla "Stock y deudas
// consolidados" (Resumen / Deudas consolidadas / Obligación prepago / Stock consolidado / Stock
// por cuenta). A diferencia de esa planilla (donde el desglose por agente se arma pegando filas
// a mano y se le puede "olvidar" alguna — pasó con Marcelo Mereles, daylight25 y J Lenzo el
// 14/09/2026), acá las 4 vistas salen calculadas de la carga de stock de abajo + los saldos,
// garantías y adelantos que YA existen en el sistema — nunca se puede olvidar una fila.
// El conteo de stock se edita y elimina directo (control 100%, pedido explícito del usuario),
// porque es un dato que se re-confirma club por club todo el tiempo, no un movimiento de plata.
export default function StockDeudas() {
  const [tab, setTab] = useState<Tab>("resumen");
  const [stock, setStock] = useState<any[] | null>(null);
  const [resumen, setResumen] = useState<any | null>(null);
  const [deudas, setDeudas] = useState<any | null>(null);
  const [prepago, setPrepago] = useState<any[] | null>(null);
  const [consolidado, setConsolidado] = useState<any[] | null>(null);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState<any | null | "nuevo">(null);
  const [borrando, setBorrando] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.stockList().then(setStock).catch((e) => setError(e.message));
    api.stockResumen().then(setResumen).catch(() => {});
    api.stockDeudasConsolidadas().then(setDeudas).catch(() => {});
    api.stockObligacionPrepago().then(setPrepago).catch(() => {});
    api.stockConsolidado().then(setConsolidado).catch(() => {});
  }

  useEffect(() => {
    refresh();
    api.agentes().then(setAgentes).catch(() => {});
    api.clubes().then(setClubes).catch(() => {});
  }, []);

  async function eliminar(s: any) {
    if (!confirm(`¿Eliminar el stock cargado de "${s.agent_name}" en ${s.club_name}?\n\nNo se puede deshacer.`)) return;
    setBorrando(s.id);
    try {
      await api.eliminarStock(s.id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo eliminar.");
    } finally {
      setBorrando(null);
    }
  }

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Stock y deudas: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Stock y deudas consolidados</h2>
          <div className="muted">
            Fichas físicas en custodia por cuenta + cruce con saldos, garantías y adelantos — equivalente a la planilla del mismo nombre, pero calculado en vivo.
          </div>
        </div>
        <button className="btn" onClick={() => setShowForm("nuevo")}>+ Cargar stock</button>
      </div>

      <div className="tabs" style={{ display: "flex", gap: 8, margin: "14px 0", flexWrap: "wrap" }}>
        {([
          ["resumen", "Resumen"],
          ["deudas", "Deudas consolidadas"],
          ["prepago", "Obligación prepago"],
          ["consolidado", "Stock consolidado"],
          ["cuentas", "Stock por cuenta"],
        ] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            className={`btn secondary small ${tab === key ? "active" : ""}`}
            style={tab === key ? { borderColor: "var(--accent, #6366f1)" } : undefined}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "resumen" && (
        <ResumenTab resumen={resumen} deudas={deudas} />
      )}

      {tab === "deudas" && <DeudasTab deudas={deudas} />}

      {tab === "prepago" && <PrepagoTab prepago={prepago} />}

      {tab === "consolidado" && <ConsolidadoTab consolidado={consolidado} />}

      {tab === "cuentas" && (
        <CuentasTab
          stock={stock}
          onEditar={(s) => setShowForm(s)}
          onEliminar={eliminar}
          borrando={borrando}
        />
      )}

      {showForm && (
        <Modal
          title={showForm === "nuevo" ? "Cargar stock" : `Editar stock — ${showForm.agent_name} / ${showForm.club_name}`}
          onClose={() => setShowForm(null)}
        >
          <StockForm
            registro={showForm === "nuevo" ? undefined : showForm}
            agentes={agentes}
            clubes={clubes}
            onDone={() => {
              setShowForm(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function ResumenTab({ resumen, deudas }: { resumen: any; deudas: any }) {
  if (!resumen || !deudas) return <div className="muted">Cargando...</div>;
  const t = deudas.totales;
  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Agentes nos deben</div>
          <div className="value">{usd(t.nosDebe)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Nosotros debemos</div>
          <div className="value">{usd(t.debemos)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Neto financiero</div>
          <div className="value">{usd(t.neto)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Garantías separadas</div>
          <div className="value">{usd(t.garantia)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Adelantos separados</div>
          <div className="value">{usd(t.adelantos)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Stock prepago en custodia</div>
          <div className="value">{usd(resumen.totalPrepagoUsd)}</div>
          <div className="muted" style={{ fontSize: 12 }}>Pasivo potencial — no exigible mientras las fichas sigan en el club.</div>
        </div>
      </div>

      <div className="panel">
        <h3>Stock general por club</h3>
        <table>
          <thead>
            <tr><th>Club</th><th>Cuentas</th><th>Unidades</th><th>USD físico ref.</th></tr>
          </thead>
          <tbody>
            {resumen.porClub.map((c: any) => (
              <tr key={c.club_id}>
                <td>{c.club_name}</td>
                <td>{c.cuentas}</td>
                <td>{num(c.unidades)}</td>
                <td>{c.usd !== null ? usd(c.usd) : <span className="muted">sin tasa</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeudasTab({ deudas }: { deudas: any }) {
  if (!deudas) return <div className="muted">Cargando...</div>;
  return (
    <div className="panel">
      <h3>Deudas consolidadas por agente/supervisor</h3>
      <div className="muted" style={{ marginBottom: 10 }}>
        Agrupado por supervisor cuando el agente lo tiene cargado (ej. subagentes de Uriel quedan bajo "Uriel"). Calculado desde saldos, garantías, adelantos y stock prepago vigentes — nunca puede faltar una fila.
      </div>
      <table>
        <thead>
          <tr>
            <th>Agente / supervisor</th><th>Nos debe</th><th>Debemos</th><th>Neto</th>
            <th>Garantía separada</th><th>Adelantos separados</th><th>Stock prepago custodia</th>
          </tr>
        </thead>
        <tbody>
          {deudas.filas.map((f: any) => (
            <tr key={f.grupo}>
              <td><strong>{f.grupo}</strong></td>
              <td>{usd(f.nosDebe)}</td>
              <td>{usd(f.debemos)}</td>
              <td><span className={`badge ${f.neto >= 0 ? "pos" : "neg"}`}>{usd(f.neto)}</span></td>
              <td>{usd(f.garantia)}</td>
              <td>{usd(f.adelantos)}</td>
              <td>{usd(f.stockPrepago)}</td>
            </tr>
          ))}
          <tr style={{ fontWeight: 600, background: "var(--panel-soft, rgba(255,255,255,0.03))" }}>
            <td>TOTAL</td>
            <td>{usd(deudas.totales.nosDebe)}</td>
            <td>{usd(deudas.totales.debemos)}</td>
            <td>{usd(deudas.totales.neto)}</td>
            <td>{usd(deudas.totales.garantia)}</td>
            <td>{usd(deudas.totales.adelantos)}</td>
            <td>{usd(deudas.totales.stockPrepago)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PrepagoTab({ prepago }: { prepago: any[] | null }) {
  if (!prepago) return <div className="muted">Cargando...</div>;
  const total = prepago.reduce((acc, p) => acc + (p.usd_ref !== null ? Number(p.usd_ref) : 0), 0);
  return (
    <div className="panel">
      <h3>Obligación prepago</h3>
      <div className="muted" style={{ marginBottom: 10 }}>
        Fichas de cuentas con sistema PREPAGO vigente — pasivo operativo potencial, no exigible mientras las fichas sigan en el club.
      </div>
      {prepago.length === 0 ? (
        <div className="muted">No hay cuentas con sistema PREPAGO cargadas todavía.</div>
      ) : (
        <table>
          <thead>
            <tr><th>Cuenta</th><th>Supervisor</th><th>Club</th><th>Unidades</th><th>Tasa</th><th>Equivalente USD</th></tr>
          </thead>
          <tbody>
            {prepago.map((p) => (
              <tr key={p.id}>
                <td>{p.agent_name}</td>
                <td className="muted">{p.grupo}</td>
                <td>{p.club_name}</td>
                <td>{num(p.units)}</td>
                <td>{p.rate ?? <span className="muted">sin tasa</span>}</td>
                <td>{p.usd_ref !== null ? usd(p.usd_ref) : <span className="muted">sin tasa</span>}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600, background: "var(--panel-soft, rgba(255,255,255,0.03))" }}>
              <td colSpan={5}>TOTAL</td>
              <td>{usd(total)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

function ConsolidadoTab({ consolidado }: { consolidado: any[] | null }) {
  if (!consolidado) return <div className="muted">Cargando...</div>;
  return (
    <div className="panel">
      <h3>Stock consolidado por supervisor y club</h3>
      <table>
        <thead>
          <tr><th>Supervisor / agente</th><th>Club</th><th>Cuentas incluidas</th><th>Unidades</th><th>USD físico ref.</th></tr>
        </thead>
        <tbody>
          {consolidado.map((c) => (
            <tr key={`${c.grupo}::${c.club_id}`}>
              <td><strong>{c.grupo}</strong></td>
              <td>{c.club_name}</td>
              <td className="muted" style={{ fontSize: 12 }}>{c.cuentas.join(", ")}</td>
              <td>{num(c.unidades)}</td>
              <td>{c.usd !== null ? usd(c.usd) : <span className="muted">sin tasa</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CuentasTab({
  stock,
  onEditar,
  onEliminar,
  borrando,
}: {
  stock: any[] | null;
  onEditar: (s: any) => void;
  onEliminar: (s: any) => void;
  borrando: string | null;
}) {
  if (!stock) return <div className="muted">Cargando...</div>;
  return (
    <div className="panel">
      <h3>Stock por cuenta</h3>
      <div className="muted" style={{ marginBottom: 10 }}>
        Un registro por agente+club — cargar de nuevo sobre el mismo par actualiza el valor (no se acumula historial). Se puede editar y eliminar directo.
      </div>
      {stock.length === 0 ? (
        <div className="muted">Todavía no hay stock cargado — usá "+ Cargar stock".</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Cuenta</th><th>Supervisor</th><th>Club</th><th>Sistema</th><th>Unidades</th><th>Tasa</th>
              <th>USD ref.</th><th>Excluida</th><th>Estado</th><th>Confirmado</th><th></th>
            </tr>
          </thead>
          <tbody>
            {stock.map((s) => (
              <tr key={s.id}>
                <td>{s.agent_name}</td>
                <td className="muted">{s.grupo}</td>
                <td>{s.club_name}</td>
                <td><span className="badge neutral">{s.system}</span></td>
                <td>{num(s.units)}</td>
                <td>{s.rate ?? "—"}</td>
                <td>{s.usd_ref !== null ? usd(s.usd_ref) : "—"}</td>
                <td>{s.excluded ? "Sí" : "—"}</td>
                <td className="muted" style={{ fontSize: 12 }} title={s.observaciones || undefined}>{s.estado || "—"}</td>
                <td>{dateShort(s.confirmado_en)}</td>
                <td className="row-actions">
                  <button className="btn secondary small" onClick={() => onEditar(s)}>Editar</button>
                  <button
                    className="btn secondary small"
                    disabled={borrando === s.id}
                    onClick={() => onEliminar(s)}
                    style={{ color: "var(--danger, #e5484d)" }}
                  >
                    {borrando === s.id ? "..." : "Eliminar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StockForm({
  registro,
  agentes,
  clubes,
  onDone,
}: {
  registro?: any;
  agentes: any[];
  clubes: any[];
  onDone: () => void;
}) {
  const [agentId, setAgentId] = useState(registro?.agent_id ?? "");
  const [clubId, setClubId] = useState(registro?.club_id ?? "");
  const [units, setUnits] = useState(registro ? String(registro.units) : "");
  const [rate, setRate] = useState(registro?.rate !== undefined && registro?.rate !== null ? String(registro.rate) : "");
  const [excluded, setExcluded] = useState(!!registro?.excluded);
  const [estado, setEstado] = useState(registro?.estado ?? "");
  const [observaciones, setObservaciones] = useState(registro?.observaciones ?? "");
  const [confirmadoEn, setConfirmadoEn] = useState(
    registro?.confirmado_en ? String(registro.confirmado_en).slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!agentId || !clubId) return setMsg({ ok: false, text: "Elegí cuenta y club." });
    const u = Number(units);
    if (Number.isNaN(u)) return setMsg({ ok: false, text: "Unidades inválidas." });
    setLoading(true);
    try {
      const data = {
        agentId,
        clubId,
        units: u,
        rate: rate.trim() === "" ? null : Number(rate),
        excluded,
        estado: estado.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
        confirmadoEn,
      };
      if (registro) await api.editarStock(registro.id, data);
      else await api.guardarStock(data);
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Cuenta (agente)</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!!registro}>
            <option value="">Elegir...</option>
            {agentes.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)} disabled={!!registro}>
            <option value="">Elegir...</option>
            {clubes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Unidades físicas</label>
          <input value={units} onChange={(e) => setUnits(e.target.value)} type="number" step="0.01" />
        </div>
        <div className="field">
          <label>Tasa a USD (opcional)</label>
          <input value={rate} onChange={(e) => setRate(e.target.value)} type="number" step="0.0001" placeholder="Ej: 1, 1.2, 0.0316 (=1/31.67)" />
        </div>
        <div className="field">
          <label>Confirmado el</label>
          <input value={confirmadoEn} onChange={(e) => setConfirmadoEn(e.target.value)} type="date" />
        </div>
      </div>
      <div className="field">
        <label>Estado / cómo se confirmó (opcional)</label>
        <input value={estado} onChange={(e) => setEstado(e.target.value)} placeholder="Ej: Confirmación de usuario, Auditoría manual" />
      </div>
      <div className="field">
        <label>Observaciones (opcional)</label>
        <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
      </div>
      <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input id="excluded" type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} style={{ width: "auto" }} />
        <label htmlFor="excluded" style={{ margin: 0 }}>
          Cuenta espejo (superagente que refleja el mismo stack de otra) — no sumar en los totales
        </label>
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : registro ? "Guardar" : "Cargar stock"}</button>
    </form>
  );
}
