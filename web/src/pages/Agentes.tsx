import { useEffect, useState } from "react";
import { api, type AccountType } from "../api";
import { usd, pct } from "../fmt";
import { exportCsv } from "../csv";
import Modal from "../components/Modal";
import MovimientosHistorial from "../components/MovimientosHistorial";

const ACCOUNT_TYPES: AccountType[] = ["PREPAGO", "WIN_LOSE", "BANCADO", "INTERNO", "SUPERVISOR", "UNION"];
const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  PREPAGO: "Prepago",
  WIN_LOSE: "Win/Lose",
  BANCADO: "Bancado",
  INTERNO: "Interno DigiPlayers",
  SUPERVISOR: "Supervisor",
  UNION: "Unión",
};

export default function Agentes() {
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [deals, setDeals] = useState<any[]>([]);
  const [tab, setTab] = useState<"lista" | "nuevo-agente" | "nuevo-club" | "clubes" | "deal">("lista");
  const [filtro, setFiltro] = useState("");
  const [historialAgent, setHistorialAgent] = useState<{ id: string; name: string } | null>(null);
  const [editando, setEditando] = useState<any | null>(null);
  const [configurandoClub, setConfigurandoClub] = useState<any | null>(null);

  function refresh() {
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function open(agent: any) {
    setSelected(agent);
    setDeals(await api.agentDeals(agent.id));
    setTab("lista");
  }

  const agentesFiltrados = agentes.filter((a) => a.name.toLowerCase().includes(filtro.trim().toLowerCase()));

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Agentes</h2>
          <div className="muted">Catálogo abierto: cualquier agente puede operar en cualquier club activo (BIT-050).</div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "lista" ? "active" : ""} onClick={() => setTab("lista")}>Lista</button>
        <button className={tab === "nuevo-agente" ? "active" : ""} onClick={() => setTab("nuevo-agente")}>+ Nuevo agente</button>
        <button className={tab === "nuevo-club" ? "active" : ""} onClick={() => setTab("nuevo-club")}>+ Nuevo club</button>
        <button className={tab === "clubes" ? "active" : ""} onClick={() => setTab("clubes")}>Configurar clubes</button>
        <button className={tab === "deal" ? "active" : ""} onClick={() => setTab("deal")}>Asignar % a agente</button>
      </div>

      {tab === "nuevo-agente" && <NuevoAgente onCreated={refresh} />}
      {tab === "nuevo-club" && <NuevoClub onCreated={refresh} />}
      {tab === "clubes" && <ClubesConfig clubes={clubes} onEdit={setConfigurandoClub} />}
      {tab === "deal" && <NuevoDeal agentes={agentes} clubes={clubes} onCreated={refresh} />}

      {tab === "lista" && (
        <div style={{ display: "flex", gap: 20 }}>
          <div className="panel" style={{ flex: 1 }}>
            <div className="topbar" style={{ marginBottom: 14, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Todos los agentes ({agentesFiltrados.length})</h3>
              <div style={{ display: "flex", gap: 10 }}>
                <input className="search-input" placeholder="Buscar agente..." value={filtro} onChange={(e) => setFiltro(e.target.value)} />
                <button
                  className="btn secondary small"
                  onClick={() =>
                    exportCsv(
                      "agentes.csv",
                      agentesFiltrados.map((a) => ({
                        nombre: a.name,
                        sistema: a.default_system,
                        saldo_total: a.saldo_total,
                        garantia_monto: a.garantia_monto ?? "",
                        garantia_consumida: a.garantia_consumida ?? "",
                      }))
                    )
                  }
                >
                  Exportar CSV
                </button>
              </div>
            </div>
            <table>
              <thead>
                <tr><th>Nombre</th><th>Sistema</th><th>Tipo de cuenta</th><th>Saldo total</th><th>Garantía</th><th></th></tr>
              </thead>
              <tbody>
                {agentesFiltrados.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td>
                    <td>{a.default_system === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
                    <td><span className="badge neutral">{ACCOUNT_TYPE_LABELS[(a.account_type as AccountType) ?? a.default_system] ?? a.account_type}</span></td>
                    <td><span className={`badge ${Number(a.saldo_total) > 0 ? "pos" : Number(a.saldo_total) < 0 ? "neg" : "neutral"}`}>{usd(a.saldo_total)}</span></td>
                    <td>
                      {a.garantia_monto != null ? (
                        <span className="muted" style={{ fontSize: 12.5 }}>
                          {usd(a.garantia_consumida)} / {usd(a.garantia_monto)}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="btn secondary small" onClick={() => open(a)}>Ver deals</button>
                      <button className="btn secondary small" onClick={() => setHistorialAgent({ id: a.id, name: a.name })}>Historial</button>
                      <button className="btn secondary small" onClick={() => setEditando(a)}>Editar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="panel" style={{ width: 360 }}>
              <h3>Deals de {selected.name}</h3>
              <table>
                <thead><tr><th>Club</th><th>% RB</th><th>% Rebate</th></tr></thead>
                <tbody>
                  {deals.map((d) => {
                    const club = clubes.find((c) => c.id === d.club_id);
                    const rbEsDefault = club?.default_rakeback_pct != null && Number(club.default_rakeback_pct) === Number(d.rakeback_pct);
                    const rebateEsDefault = club?.default_rebate_pct != null && Number(club.default_rebate_pct) === Number(d.rebate_pct);
                    return (
                      <tr key={d.id}>
                        <td>{d.club_name}</td>
                        <td>{pct(d.rakeback_pct)} {rbEsDefault && <span className="muted" style={{ fontSize: 11 }}>(default)</span>}</td>
                        <td>{pct(d.rebate_pct)} {rebateEsDefault && <span className="muted" style={{ fontSize: 11 }}>(default)</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {deals[0]?.notes && <div className="muted" style={{ marginTop: 10 }}>{deals[0].notes}</div>}
            </div>
          )}
        </div>
      )}

      {historialAgent && (
        <Modal title={`Historial — ${historialAgent.name}`} onClose={() => setHistorialAgent(null)} wide>
          <MovimientosHistorial agentId={historialAgent.id} />
        </Modal>
      )}

      {editando && (
        <Modal title={`Editar agente — ${editando.name}`} onClose={() => setEditando(null)}>
          <EditarAgente
            agente={editando}
            onSaved={() => {
              setEditando(null);
              refresh();
            }}
          />
        </Modal>
      )}

      {configurandoClub && (
        <Modal title={`Configurar club — ${configurandoClub.name}`} onClose={() => setConfigurandoClub(null)} wide>
          <ConfigurarClub
            club={configurandoClub}
            onSaved={() => {
              setConfigurandoClub(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function EditarAgente({ agente, onSaved }: { agente: any; onSaved: () => void }) {
  const [name, setName] = useState(agente.name);
  const [defaultSystem, setDefaultSystem] = useState<"PREPAGO" | "WIN_LOSE">(agente.default_system);
  const [supervisor, setSupervisor] = useState(agente.supervisor ?? "");
  const [accountType, setAccountType] = useState<AccountType>((agente.account_type as AccountType) ?? agente.default_system);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "El nombre es obligatorio." });
    setLoading(true);
    try {
      await api.editarAgente(agente.id, {
        name: name.trim(),
        defaultSystem,
        supervisor: supervisor.trim() || null,
        accountType,
      });
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el agente." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Corrige los datos del agente. No borra ni recalcula nada del historial — para cambiar % de rakeback/rebate usá "Asignar % a agente".
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Sistema por defecto</label>
          <select value={defaultSystem} onChange={(e) => setDefaultSystem(e.target.value as any)}>
            <option value="WIN_LOSE">Win/Lose</option>
            <option value="PREPAGO">Prepago</option>
          </select>
        </div>
        <div className="field">
          <label>Tipo de cuenta</label>
          <select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Supervisor (opcional)</label>
          <input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} />
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Guardar cambios"}</button>
    </form>
  );
}

function NuevoAgente({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [defaultSystem, setDefaultSystem] = useState<"PREPAGO" | "WIN_LOSE">("WIN_LOSE");
  const [supervisor, setSupervisor] = useState("");
  const [accountType, setAccountType] = useState<AccountType | "">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "El nombre es obligatorio." });
    setLoading(true);
    try {
      await api.crearAgente({
        name: name.trim(),
        defaultSystem,
        supervisor: supervisor.trim() || undefined,
        accountType: accountType || undefined,
      });
      setMsg({ ok: true, text: `Agente "${name}" creado.` });
      setName("");
      setSupervisor("");
      setAccountType("");
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo crear el agente." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <h3>Nuevo agente</h3>
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: nuevo_agente" />
          </div>
          <div className="field">
            <label>Sistema por defecto</label>
            <select value={defaultSystem} onChange={(e) => setDefaultSystem(e.target.value as any)}>
              <option value="WIN_LOSE">Win/Lose</option>
              <option value="PREPAGO">Prepago</option>
            </select>
          </div>
          <div className="field">
            <label>Tipo de cuenta (opcional)</label>
            <select value={accountType} onChange={(e) => setAccountType(e.target.value as AccountType | "")}>
              <option value="">Igual al sistema ({defaultSystem === "PREPAGO" ? "Prepago" : "Win/Lose"})</option>
              {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Supervisor (opcional)</label>
            <input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} />
          </div>
        </div>
        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={loading}>{loading ? "Creando..." : "Crear agente"}</button>
      </form>
    </div>
  );
}

function NuevoClub({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<"USD" | "USDT" | "FICHAS">("USD");
  const [currentRate, setCurrentRate] = useState("1");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "El nombre es obligatorio." });
    setLoading(true);
    try {
      await api.crearClub({ name: name.trim(), unit, currentRate: Number(currentRate) || 1 });
      setMsg({ ok: true, text: `Club "${name}" creado.` });
      setName("");
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo crear el club." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <h3>Nuevo club</h3>
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>Nombre</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Fénix GG" />
          </div>
          <div className="field">
            <label>Unidad</label>
            <select value={unit} onChange={(e) => setUnit(e.target.value as any)}>
              <option value="USD">USD</option>
              <option value="USDT">USDT</option>
              <option value="FICHAS">Fichas</option>
            </select>
          </div>
          {unit === "FICHAS" && (
            <div className="field">
              <label>Tasa fichas → USD</label>
              <input value={currentRate} onChange={(e) => setCurrentRate(e.target.value)} type="number" step="0.01" />
            </div>
          )}
        </div>
        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={loading}>{loading ? "Creando..." : "Crear club"}</button>
      </form>
    </div>
  );
}

function ClubesConfig({ clubes, onEdit }: { clubes: any[]; onEdit: (club: any) => void }) {
  return (
    <div className="panel">
      <h3>Configuración por club ({clubes.length})</h3>
      <div className="muted" style={{ marginBottom: 14 }}>
        Estos valores son los que hereda cualquier deal agente↔club que no defina su propio %.
      </div>
      <table>
        <thead>
          <tr><th>Club</th><th>Unidad</th><th>% Rakeback default</th><th>% Rebate default</th><th>Destino rebate</th><th></th></tr>
        </thead>
        <tbody>
          {clubes.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.unit}</td>
              <td>{c.default_rakeback_pct != null ? pct(c.default_rakeback_pct) : "—"}</td>
              <td>{c.default_rebate_pct != null ? pct(c.default_rebate_pct) : "—"}</td>
              <td>{c.rebate_destino === "RAKEBACK_SUPERVISOR" ? "Rakeback supervisor" : c.rebate_destino === "SALDO_OPERATIVO" ? "Saldo operativo" : "—"}</td>
              <td><button className="btn secondary small" onClick={() => onEdit(c)}>Configurar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfigurarClub({ club, onSaved }: { club: any; onSaved: () => void }) {
  const [unit, setUnit] = useState<"USD" | "USDT" | "FICHAS">(club.unit ?? "USD");
  const [currentRate, setCurrentRate] = useState(String(club.current_rate ?? 1));
  const [defaultRakebackPct, setDefaultRakebackPct] = useState(club.default_rakeback_pct != null ? String(Number(club.default_rakeback_pct) * 100) : "");
  const [defaultRebatePct, setDefaultRebatePct] = useState(club.default_rebate_pct != null ? String(Number(club.default_rebate_pct) * 100) : "");
  const [rebateDestino, setRebateDestino] = useState<"SALDO_OPERATIVO" | "RAKEBACK_SUPERVISOR" | "">(club.rebate_destino ?? "");
  const [feePct, setFeePct] = useState(club.fee_pct != null ? String(Number(club.fee_pct) * 100) : "");
  const [platformPct, setPlatformPct] = useState(club.platform_pct != null ? String(Number(club.platform_pct) * 100) : "");
  const [unionPct, setUnionPct] = useState(club.union_pct != null ? String(Number(club.union_pct) * 100) : "");
  const [notes, setNotes] = useState(club.notes ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      await api.configurarClub(club.id, {
        unit,
        currentRate: Number(currentRate) || 1,
        defaultRakebackPct: defaultRakebackPct === "" ? undefined : Number(defaultRakebackPct) / 100,
        defaultRebatePct: defaultRebatePct === "" ? undefined : Number(defaultRebatePct) / 100,
        rebateDestino: rebateDestino || undefined,
        feePct: feePct === "" ? undefined : Number(feePct) / 100,
        platformPct: platformPct === "" ? undefined : Number(platformPct) / 100,
        unionPct: unionPct === "" ? undefined : Number(unionPct) / 100,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar la configuración del club." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="muted" style={{ marginBottom: 14 }}>
        Estos valores son los defaults que hereda un deal agente↔club que no define su propio %. Un deal específico siempre pisa esto.
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Unidad</label>
          <select value={unit} onChange={(e) => setUnit(e.target.value as any)}>
            <option value="USD">USD</option>
            <option value="USDT">USDT</option>
            <option value="FICHAS">Fichas</option>
          </select>
        </div>
        {unit === "FICHAS" && (
          <div className="field">
            <label>Tasa fichas → USD</label>
            <input value={currentRate} onChange={(e) => setCurrentRate(e.target.value)} type="number" step="0.01" />
          </div>
        )}
        <div className="field">
          <label>% Rakeback default</label>
          <input value={defaultRakebackPct} onChange={(e) => setDefaultRakebackPct(e.target.value)} type="number" step="0.01" placeholder="Ej: 70" />
        </div>
        <div className="field">
          <label>% Rebate default</label>
          <input value={defaultRebatePct} onChange={(e) => setDefaultRebatePct(e.target.value)} type="number" step="0.01" placeholder="Ej: 0" />
        </div>
        <div className="field">
          <label>Destino del rebate</label>
          <select value={rebateDestino} onChange={(e) => setRebateDestino(e.target.value as any)}>
            <option value="">Sin definir</option>
            <option value="SALDO_OPERATIVO">Saldo operativo del agente</option>
            <option value="RAKEBACK_SUPERVISOR">Rakeback del supervisor</option>
          </select>
        </div>
        <div className="field">
          <label>% Fee del club</label>
          <input value={feePct} onChange={(e) => setFeePct(e.target.value)} type="number" step="0.01" />
        </div>
        <div className="field">
          <label>% Plataforma</label>
          <input value={platformPct} onChange={(e) => setPlatformPct(e.target.value)} type="number" step="0.01" />
        </div>
        <div className="field">
          <label>% Unión</label>
          <input value={unionPct} onChange={(e) => setUnionPct(e.target.value)} type="number" step="0.01" />
        </div>
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Guardar configuración"}</button>
    </form>
  );
}

function NuevoDeal({ agentes, clubes, onCreated }: { agentes: any[]; clubes: any[]; onCreated: () => void }) {
  const [agentId, setAgentId] = useState("");
  const [clubId, setClubId] = useState("");
  const [system, setSystem] = useState<"PREPAGO" | "WIN_LOSE">("WIN_LOSE");
  const [rakebackPct, setRakebackPct] = useState("70");
  const [rebatePct, setRebatePct] = useState("0");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [usandoDefault, setUsandoDefault] = useState(false);

  function elegirClub(id: string) {
    setClubId(id);
    const club = clubes.find((c) => c.id === id);
    if (club && club.default_rakeback_pct != null) {
      setRakebackPct(String(Number(club.default_rakeback_pct) * 100));
      setRebatePct(club.default_rebate_pct != null ? String(Number(club.default_rebate_pct) * 100) : "0");
      setUsandoDefault(true);
    } else {
      setUsandoDefault(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!agentId || !clubId) return setMsg({ ok: false, text: "Elegí agente y club." });
    setLoading(true);
    try {
      await api.crearDeal({
        agentId,
        clubId,
        system,
        rakebackPct: Number(rakebackPct) / 100,
        rebatePct: Number(rebatePct) / 100,
        notes: notes.trim() || undefined,
      });
      setMsg({ ok: true, text: "Deal guardado. Reemplaza cualquier % anterior para ese agente+club a partir de ahora." });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el deal." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <h3>Asignar % de rakeback/rebate a un agente en un club</h3>
      <div className="muted" style={{ marginBottom: 14 }}>
        Esto no borra el historial: versiona el deal anterior (queda con fecha de fin) y crea uno nuevo vigente.
      </div>
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>Agente</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Elegir...</option>
              {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Club</label>
            <select value={clubId} onChange={(e) => elegirClub(e.target.value)}>
              <option value="">Elegir...</option>
              {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Sistema</label>
            <select value={system} onChange={(e) => setSystem(e.target.value as any)}>
              <option value="WIN_LOSE">Win/Lose</option>
              <option value="PREPAGO">Prepago</option>
            </select>
          </div>
          <div className="field">
            <label>% Rakeback {usandoDefault && <span className="muted">(default del club)</span>}</label>
            <input
              value={rakebackPct}
              onChange={(e) => { setRakebackPct(e.target.value); setUsandoDefault(false); }}
              type="number"
              step="0.01"
            />
          </div>
          <div className="field">
            <label>% Rebate {usandoDefault && <span className="muted">(default del club)</span>}</label>
            <input
              value={rebatePct}
              onChange={(e) => { setRebatePct(e.target.value); setUsandoDefault(false); }}
              type="number"
              step="0.01"
            />
          </div>
        </div>
        <div className="field">
          <label>Notas (opcional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Guardar deal"}</button>
      </form>
    </div>
  );
}
