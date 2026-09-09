import { Fragment, useEffect, useState } from "react";
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
  // Todos los deals vigentes, agrupados por agente — para pintar el % en la lista principal
  // (BIT-nueva: "así sabés de un vistazo cuáles tienen % asignado y cuáles no").
  const [dealsPorAgente, setDealsPorAgente] = useState<Record<string, any[]>>({});
  const [selected, setSelected] = useState<any | null>(null);
  const [deals, setDeals] = useState<any[]>([]);
  const [editandoDeal, setEditandoDeal] = useState<any | "new" | null>(null);
  const [tab, setTab] = useState<"lista" | "nuevo-agente" | "nuevo-club" | "clubes" | "supervisores" | "deal" | "reglas" | "arbol">("lista");
  const [filtro, setFiltro] = useState("");
  // "Dar de baja" nunca borra nada, pero antes desaparecían de la lista sin forma de volver a
  // verlos, reactivarlos o borrarlos de verdad si eran duplicados de prueba — este toggle los
  // trae de vuelta (atenuados) con esas dos acciones.
  const [verDadosDeBaja, setVerDadosDeBaja] = useState(false);
  const [historialAgent, setHistorialAgent] = useState<{ id: string; name: string } | null>(null);
  const [editando, setEditando] = useState<any | null>(null);
  const [configurandoClub, setConfigurandoClub] = useState<any | null>(null);
  const [reglasAgent, setReglasAgent] = useState<{ id: string; name: string } | null>(null);

  function refresh() {
    api.agentes(verDadosDeBaja).then(setAgentes);
    api.clubes().then(setClubes);
    api.todosLosDeals().then((deals: any[]) => {
      const map: Record<string, any[]> = {};
      for (const d of deals) {
        (map[d.agent_id] ??= []).push(d);
      }
      setDealsPorAgente(map);
    });
  }

  useEffect(() => {
    refresh();
  }, [verDadosDeBaja]);

  async function reactivarAgente(a: any) {
    try {
      await api.editarAgente(a.id, { active: true });
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo reactivar al agente.");
    }
  }

  // Borrado real — el backend lo rechaza si tiene cualquier rastro (jugadores, movimientos,
  // deals, etc.), así que este botón nunca puede tirar abajo un agente con historial real; el
  // confirm es solo para evitar un click accidental sobre un agente que sí se puede borrar.
  async function eliminarAgente(a: any) {
    if (!confirm(`¿Borrar definitivamente a "${a.name}"? Esto NO se puede deshacer. Solo funciona si el agente no tiene ningún historial real (si lo tiene, el sistema va a rechazar el borrado y te va a decir por qué).`)) return;
    try {
      await api.eliminarAgente(a.id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo borrar al agente.");
    }
  }

  async function open(agent: any) {
    setSelected(agent);
    setEditandoDeal(null);
    setDeals(await api.agentDeals(agent.id));
    setTab("lista");
  }

  // Dar de baja: NUNCA borra nada — el agente/club deja de listarse como activo (no puede
  // recibir cierres/movimientos nuevos), pero su historial ya cargado queda intacto.
  async function darDeBajaAgente(a: any) {
    if (!confirm(`¿Dar de baja a "${a.name}"? Deja de aparecer para cargar cierres nuevos, pero su historial se conserva igual.`)) return;
    try {
      await api.editarAgente(a.id, { active: false });
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo dar de baja al agente.");
    }
  }

  async function darDeBajaClub(c: any) {
    if (!confirm(`¿Dar de baja el club "${c.name}"? Deja de estar disponible para cargar cierres nuevos, pero su historial se conserva igual.`)) return;
    try {
      await api.configurarClub(c.id, { active: false });
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo dar de baja al club.");
    }
  }

  const agentesFiltrados = agentes.filter((a) => a.name.toLowerCase().includes(filtro.trim().toLowerCase()));

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Administración</h2>
          <div className="muted">Catálogo abierto: cualquier agente puede operar en cualquier club activo (BIT-050).</div>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "lista" ? "active" : ""} onClick={() => setTab("lista")}>Lista</button>
        <button className={tab === "nuevo-agente" ? "active" : ""} onClick={() => setTab("nuevo-agente")}>+ Nuevo agente</button>
        <button className={tab === "nuevo-club" ? "active" : ""} onClick={() => setTab("nuevo-club")}>+ Nuevo club</button>
        <button className={tab === "clubes" ? "active" : ""} onClick={() => setTab("clubes")}>Configurar clubes</button>
        <button className={tab === "supervisores" ? "active" : ""} onClick={() => setTab("supervisores")}>Supervisores</button>
        <button className={tab === "deal" ? "active" : ""} onClick={() => setTab("deal")}>Asignar % a agente</button>
        <button className={tab === "reglas" ? "active" : ""} onClick={() => setTab("reglas")}>Reglas especiales</button>
        <button className={tab === "arbol" ? "active" : ""} onClick={() => setTab("arbol")}>Árbol de clubes</button>
      </div>

      {tab === "nuevo-agente" && <NuevoAgente onCreated={refresh} />}
      {tab === "nuevo-club" && <NuevoClub onCreated={refresh} />}
      {tab === "clubes" && <ClubesConfig clubes={clubes} onEdit={setConfigurandoClub} onDarDeBaja={darDeBajaClub} />}
      {tab === "supervisores" && <SupervisoresView />}
      {tab === "deal" && <NuevoDeal agentes={agentes} clubes={clubes} onCreated={refresh} />}
      {tab === "reglas" && <ReglasGlobal agentes={agentes} clubes={clubes} />}
      {tab === "arbol" && <ArbolClubes agentes={agentes} clubes={clubes} />}

      {tab === "lista" && (
        <div style={{ display: "flex", gap: 20 }}>
          <div className="panel" style={{ flex: 1 }}>
            <div className="topbar" style={{ marginBottom: 14, alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Todos los agentes ({agentesFiltrados.length})</h3>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, whiteSpace: "nowrap" }}>
                  <input type="checkbox" checked={verDadosDeBaja} onChange={(e) => setVerDadosDeBaja(e.target.checked)} />
                  Ver dados de baja
                </label>
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
                <tr><th>Nombre</th><th>Sistema</th><th>Tipo de cuenta</th><th>% Rakeback / Rebate</th><th>Saldo total</th><th>Garantía</th><th></th></tr>
              </thead>
              <tbody>
                {agentesFiltrados.map((a) => (
                  <tr key={a.id} style={a.active === false ? { opacity: 0.55 } : undefined}>
                    <td>
                      {a.name}
                      {a.active === false && <span className="badge neutral" style={{ marginLeft: 8 }}>Dado de baja</span>}
                    </td>
                    <td>{a.default_system === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
                    <td><span className="badge neutral">{ACCOUNT_TYPE_LABELS[(a.account_type as AccountType) ?? a.default_system] ?? a.account_type}</span></td>
                    <td>
                      {(dealsPorAgente[a.id]?.length ?? 0) > 0 ? (
                        <div
                          style={{ display: "flex", flexWrap: "wrap", gap: 4, cursor: "pointer" }}
                          onClick={() => open(a)}
                          title="Ver/editar los deals de este agente"
                        >
                          {dealsPorAgente[a.id].map((d) => (
                            <span key={d.id} className="badge pos" style={{ fontSize: 11.5 }}>
                              {d.club_name}: {pct(d.rakeback_pct)} / {pct(d.rebate_pct)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span
                          className="muted"
                          style={{ cursor: "pointer", textDecoration: "underline dotted" }}
                          onClick={() => open(a)}
                          title="Sin deal propio en ningún club — usa el default de cada club. Click para asignarle uno."
                        >
                          Sin deal (default club)
                        </span>
                      )}
                    </td>
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
                      <button className="btn secondary small" onClick={() => setReglasAgent({ id: a.id, name: a.name })}>Reglas especiales</button>
                      <button className="btn secondary small" onClick={() => setHistorialAgent({ id: a.id, name: a.name })}>Historial</button>
                      <button className="btn secondary small" onClick={() => setEditando(a)}>Editar</button>
                      {a.active === false ? (
                        <>
                          <button className="btn secondary small" onClick={() => reactivarAgente(a)}>Reactivar</button>
                          <button className="btn secondary small" style={{ color: "var(--danger, #e5484d)" }} onClick={() => eliminarAgente(a)} title="Borrado real — solo funciona si no tiene ningún historial (jugadores, movimientos, deals, etc).">
                            Eliminar
                          </button>
                        </>
                      ) : (
                        <button className="btn secondary small" onClick={() => darDeBajaAgente(a)}>Dar de baja</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <div className="panel" style={{ width: 420 }}>
              <div className="topbar" style={{ marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Deals de {selected.name}</h3>
                <button className="btn secondary small" onClick={() => setEditandoDeal("new")}>+ Agregar deal</button>
              </div>
              {editandoDeal && (
                <div style={{ marginBottom: 14 }}>
                  <NuevoDeal
                    agentes={agentes}
                    clubes={clubes}
                    fixedAgentId={selected.id}
                    initial={editandoDeal === "new" ? undefined : editandoDeal}
                    onCreated={async () => { setEditandoDeal(null); setDeals(await api.agentDeals(selected.id)); }}
                  />
                  <button className="btn secondary small" style={{ marginTop: 6 }} onClick={() => setEditandoDeal(null)}>Cancelar</button>
                </div>
              )}
              <table>
                <thead><tr><th>Club</th><th>Sistema</th><th>% RB</th><th>% Rebate</th><th></th></tr></thead>
                <tbody>
                  {deals.map((d) => {
                    const club = clubes.find((c) => c.id === d.club_id);
                    const rbEsDefault = club?.default_rakeback_pct != null && Number(club.default_rakeback_pct) === Number(d.rakeback_pct);
                    const rebateEsDefault = club?.default_rebate_pct != null && Number(club.default_rebate_pct) === Number(d.rebate_pct);
                    return (
                      <tr key={d.id}>
                        <td>{d.club_name}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{d.system === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
                        <td>{pct(d.rakeback_pct)} {rbEsDefault && <span className="muted" style={{ fontSize: 11 }}>(default)</span>}</td>
                        <td>{pct(d.rebate_pct)} {rebateEsDefault && <span className="muted" style={{ fontSize: 11 }}>(default)</span>}</td>
                        <td><button className="btn secondary small" onClick={() => setEditandoDeal(d)}>Editar</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {deals.some((d) => d.notes) && (
                <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
                  {deals.filter((d) => d.notes).map((d) => <div key={d.id}>{d.club_name}: {d.notes}</div>)}
                </div>
              )}
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

      {reglasAgent && (
        <Modal title={`Reglas especiales — ${reglasAgent.name}`} onClose={() => setReglasAgent(null)} wide>
          <ReglasAgente agentId={reglasAgent.id} clubes={clubes} />
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

const RULE_LABELS: Record<string, string> = {
  MANZUR_75_RAKE: "75% del rake total (ignora el rakeback genérico)",
};

function ReglasAgente({ agentId, clubes }: { agentId: string; clubes: any[] }) {
  const [reglas, setReglas] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [terminando, setTerminando] = useState<string | null>(null);

  function refresh() {
    api.agentRules(agentId).then(setReglas);
  }

  useEffect(() => {
    refresh();
  }, [agentId]);

  async function terminar(regla: any) {
    if (!confirm(`¿Terminar la regla "${RULE_LABELS[regla.rule_key] ?? regla.rule_key}"? El agente vuelve a la fórmula genérica desde ahora (no borra el historial).`)) return;
    setTerminando(regla.id);
    try {
      await api.terminarRegla(regla.id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo terminar la regla.");
    } finally {
      setTerminando(null);
    }
  }

  return (
    <div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Reglas especiales versionadas: reemplazan la fórmula genérica de cierre para este agente (en un club específico, o global). Nunca
        se hardcodea en el código — esto es exactamente lo que hace que el cierre de Manzur (75% del rake) se aplique solo, sin que nadie
        tenga que calcularlo a mano.
      </div>
      <div className="topbar" style={{ marginBottom: 12 }}>
        <h4 style={{ margin: 0 }}>Historial de reglas</h4>
        <button className="btn secondary small" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cerrar" : "+ Nueva regla"}</button>
      </div>

      {showForm && <NuevaRegla agentId={agentId} clubes={clubes} onCreated={() => { setShowForm(false); refresh(); }} />}

      {reglas.length === 0 ? (
        <div className="muted">Este agente no tiene reglas especiales — se liquida siempre con la fórmula genérica.</div>
      ) : (
        <table>
          <thead><tr><th>Regla</th><th>Alcance</th><th>Vigencia</th><th>Descripción</th><th></th></tr></thead>
          <tbody>
            {reglas.map((r) => {
              const vigente = !r.valid_to;
              return (
                <tr key={r.id} style={vigente ? undefined : { opacity: 0.55 }}>
                  <td>{RULE_LABELS[r.rule_key] ?? r.rule_key}</td>
                  <td>{r.club_name ?? "Global (todos los clubes)"}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {new Date(r.valid_from).toLocaleDateString("es-AR")} — {vigente ? <strong>vigente</strong> : new Date(r.valid_to).toLocaleDateString("es-AR")}
                  </td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{r.description}</td>
                  <td>
                    {vigente && (
                      <button className="btn secondary small" disabled={terminando === r.id} onClick={() => terminar(r)}>
                        {terminando === r.id ? "..." : "Terminar"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NuevaRegla({ agentId, clubes, onCreated }: { agentId: string; clubes: any[]; onCreated: () => void }) {
  const [ruleKey, setRuleKey] = useState<"MANZUR_75_RAKE">("MANZUR_75_RAKE");
  const [clubId, setClubId] = useState("");
  const [pctRake, setPctRake] = useState("75");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!description.trim()) return setMsg({ ok: false, text: "Contá brevemente por qué existe esta regla (para el historial)." });
    setLoading(true);
    try {
      await api.crearRegla(agentId, {
        ruleKey,
        params: { pctRake: (Number(pctRake) || 0) / 100 },
        description: description.trim(),
        clubId: clubId || null,
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar la regla." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel" style={{ marginBottom: 16 }}>
      <div className="form-grid">
        <div className="field">
          <label>Regla</label>
          <select value={ruleKey} onChange={(e) => setRuleKey(e.target.value as any)}>
            <option value="MANZUR_75_RAKE">{RULE_LABELS.MANZUR_75_RAKE}</option>
          </select>
        </div>
        <div className="field">
          <label>Club (opcional)</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Global (todos los clubes)</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>% del rake</label>
          <input value={pctRake} onChange={(e) => setPctRake(e.target.value)} type="number" step="0.01" />
        </div>
      </div>
      <div className="field">
        <label>Descripción (por qué existe esta regla)</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: acuerdo especial con el agente en Fénix GG" />
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Activar regla"}</button>
    </form>
  );
}

// Vista global de reglas especiales: todos los agentes juntos, sin tener que entrar uno por uno
// a buscar cuáles tienen algo activo. Misma lógica que ReglasAgente/NuevaRegla (versionado,
// nunca se edita en el lugar), solo que acá el agente también se elige en el formulario.
function ReglasGlobal({ agentes, clubes }: { agentes: any[]; clubes: any[] }) {
  const [reglas, setReglas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [terminando, setTerminando] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "vigentes">("vigentes");

  function refresh() {
    setCargando(true);
    api.todasLasReglas().then(setReglas).finally(() => setCargando(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function terminar(regla: any) {
    if (!confirm(`¿Terminar la regla "${RULE_LABELS[regla.rule_key] ?? regla.rule_key}" de ${regla.agent_name}? Vuelve a la fórmula genérica desde ahora (no borra el historial).`)) return;
    setTerminando(regla.id);
    try {
      await api.terminarRegla(regla.id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo terminar la regla.");
    } finally {
      setTerminando(null);
    }
  }

  const visibles = filtro === "vigentes" ? reglas.filter((r) => !r.valid_to) : reglas;

  return (
    <div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Todas las reglas especiales de todos los agentes en un solo lugar — versionadas igual que desde "Reglas
        especiales" en cada agente (nunca se edita en el lugar: terminar una regla la cierra y una nueva queda vigente
        desde ese momento, sin perder el historial para recalcular cierres viejos).
      </div>
      <div className="topbar" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={filtro === "vigentes" ? "btn small" : "btn secondary small"} onClick={() => setFiltro("vigentes")}>Vigentes</button>
          <button className={filtro === "todas" ? "btn small" : "btn secondary small"} onClick={() => setFiltro("todas")}>Todas (con historial)</button>
        </div>
        <button className="btn secondary small" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cerrar" : "+ Nueva regla"}</button>
      </div>

      {showForm && <NuevaReglaGlobal agentes={agentes} clubes={clubes} onCreated={() => { setShowForm(false); refresh(); }} />}

      {cargando ? (
        <div className="muted">Cargando...</div>
      ) : visibles.length === 0 ? (
        <div className="muted">{filtro === "vigentes" ? "Ningún agente tiene una regla especial vigente." : "No hay reglas cargadas todavía."}</div>
      ) : (
        <table>
          <thead><tr><th>Agente</th><th>Regla</th><th>Alcance</th><th>Vigencia</th><th>Descripción</th><th></th></tr></thead>
          <tbody>
            {visibles.map((r) => {
              const vigente = !r.valid_to;
              return (
                <tr key={r.id} style={vigente ? undefined : { opacity: 0.55 }}>
                  <td>{r.agent_name}</td>
                  <td>{RULE_LABELS[r.rule_key] ?? r.rule_key}</td>
                  <td>{r.club_name ?? "Global (todos los clubes)"}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>
                    {new Date(r.valid_from).toLocaleDateString("es-AR")} — {vigente ? <strong>vigente</strong> : new Date(r.valid_to).toLocaleDateString("es-AR")}
                  </td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{r.description}</td>
                  <td>
                    {vigente && (
                      <button className="btn secondary small" disabled={terminando === r.id} onClick={() => terminar(r)}>
                        {terminando === r.id ? "..." : "Terminar"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NuevaReglaGlobal({ agentes, clubes, onCreated }: { agentes: any[]; clubes: any[]; onCreated: () => void }) {
  const [agentId, setAgentId] = useState("");
  const [ruleKey, setRuleKey] = useState<"MANZUR_75_RAKE">("MANZUR_75_RAKE");
  const [clubId, setClubId] = useState("");
  const [pctRake, setPctRake] = useState("75");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!agentId) return setMsg({ ok: false, text: "Elegí a qué agente corresponde esta regla." });
    if (!description.trim()) return setMsg({ ok: false, text: "Contá brevemente por qué existe esta regla (para el historial)." });
    setLoading(true);
    try {
      await api.crearRegla(agentId, {
        ruleKey,
        params: { pctRake: (Number(pctRake) || 0) / 100 },
        description: description.trim(),
        clubId: clubId || null,
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar la regla." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="panel" style={{ marginBottom: 16 }}>
      <div className="form-grid">
        <div className="field">
          <label>Agente</label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Elegir agente...</option>
            {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Regla</label>
          <select value={ruleKey} onChange={(e) => setRuleKey(e.target.value as any)}>
            <option value="MANZUR_75_RAKE">{RULE_LABELS.MANZUR_75_RAKE}</option>
          </select>
        </div>
        <div className="field">
          <label>Club (opcional)</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Global (todos los clubes)</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>% del rake</label>
          <input value={pctRake} onChange={(e) => setPctRake(e.target.value)} type="number" step="0.01" />
        </div>
      </div>
      <div className="field">
        <label>Descripción (por qué existe esta regla)</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej: acuerdo especial con el agente en Fénix GG" />
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Activar regla"}</button>
    </form>
  );
}

// Árbol Club -> Agentes -> Jugadores. Los jugadores no tienen % propio (cobran siempre vía su
// agente) así que solo el agente es editable acá — mismo upsertDeal de siempre (versiona, nunca
// pisa en el lugar). Los jugadores se piden on-demand al expandir cada agente, para no traer de
// una una lista gigante que capaz nadie abre.
// Mismas claves/labels que la pestaña de plataforma del importador (Cierres.tsx) — un club
// puede aparecer bajo más de una si ya se importó desde más de una plataforma.
const PLATFORM_LABELS: Record<string, string> = { SUPREMA: "SupremaPoker", GG: "GG Poker", XPOKER: "X-Poker" };
const PLATFORM_ORDER = ["SUPREMA", "GG", "XPOKER"];

function ArbolClubes({ agentes, clubes }: { agentes: any[]; clubes: any[] }) {
  const [arbol, setArbol] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [clubesAbiertos, setClubesAbiertos] = useState<Record<string, boolean>>({});
  const [agentesAbiertos, setAgentesAbiertos] = useState<Record<string, boolean>>({}); // `${clubId}|${agentId}`
  const [jugadoresPorAgente, setJugadoresPorAgente] = useState<Record<string, any[]>>({});
  const [cargandoJugadores, setCargandoJugadores] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ clubId: string; agentId: string; agentName: string } | null>(null);
  const [eliminandoJugador, setEliminandoJugador] = useState<string | null>(null);
  const [cambiandoPlataforma, setCambiandoPlataforma] = useState<string | null>(null);
  const [moviendoAgente, setMoviendoAgente] = useState<string | null>(null);

  function refresh() {
    setCargando(true);
    api.arbolClubes().then(setArbol).finally(() => setCargando(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function toggleAgente(clubId: string, agentId: string) {
    const clave = `${clubId}|${agentId}`;
    setAgentesAbiertos((s) => ({ ...s, [clave]: !s[clave] }));
    if (!jugadoresPorAgente[clave] && !agentesAbiertos[clave]) {
      setCargandoJugadores(clave);
      try {
        const jugadores = await api.jugadoresDeAgenteEnClub(clubId, agentId);
        setJugadoresPorAgente((s) => ({ ...s, [clave]: jugadores }));
      } finally {
        setCargandoJugadores(null);
      }
    }
  }

  async function eliminarJugador(clave: string, playerId: string, nombre: string) {
    if (!confirm(`¿Eliminar a "${nombre}" de este club? No borra ningún cierre ni movimiento, solo la ficha del jugador — se puede recargar a mano después.`)) return;
    setEliminandoJugador(playerId);
    try {
      await api.eliminarJugador(playerId);
      setJugadoresPorAgente((s) => ({ ...s, [clave]: (s[clave] ?? []).filter((j: any) => j.id !== playerId) }));
      refresh(); // recalcula el conteo de jugadores del agente (y puede desaparecer si quedó en 0)
    } finally {
      setEliminandoJugador(null);
    }
  }

  async function moverAgente(clubId: string, agentId: string, agentName: string, toClubId: string) {
    if (!toClubId) return;
    const clubDestino = clubes.find((c) => c.id === toClubId)?.name ?? toClubId;
    if (!confirm(`¿Mover TODOS los jugadores de "${agentName}" a "${clubDestino}"? No toca ningún cierre ni movimiento del ledger, solo el club del jugador en el catálogo.`)) return;
    setMoviendoAgente(`${clubId}|${agentId}`);
    try {
      const r = await api.moverAgenteDeClub(clubId, agentId, toClubId);
      if (r.saltados > 0) {
        alert(`Se movieron ${r.movidos} de ${r.total} jugadores. ${r.saltados} se saltearon porque ya existía un jugador con ese mismo ID en "${clubDestino}" — revisalos a mano.`);
      }
      refresh();
    } finally {
      setMoviendoAgente(null);
    }
  }

  async function cambiarPlataforma(clubId: string, platform: string) {
    setCambiandoPlataforma(clubId);
    try {
      await api.configurarClub(clubId, { importPlatform: platform || null });
      refresh();
    } finally {
      setCambiandoPlataforma(null);
    }
  }

  const editandoAgente = editando ? agentes.find((a) => a.id === editando.agentId) : null;
  const editandoClub = editando ? clubes.find((c) => c.id === editando.clubId) : null;
  const dealActualParaEditar =
    editando && editandoClub
      ? (() => {
          const nodo = arbol.find((c) => c.clubId === editando.clubId)?.agentes.find((a: any) => a.agentId === editando.agentId);
          return nodo ? { club_id: editando.clubId, system: nodo.system, rakeback_pct: nodo.rakebackPct, rebate_pct: nodo.rebatePct } : undefined;
        })()
      : undefined;

  // Primero por plataforma (un mismo club real puede tener actividad en más de una a la vez,
  // ej. TeamBack en Suprema y en GG), y adentro de cada una, por club como ya se venía haciendo.
  const grupos = [...PLATFORM_ORDER.map((key) => ({ key, label: PLATFORM_LABELS[key], clubes: arbol.filter((c) => c.platform === key) })),
    { key: "SIN_PLATAFORMA", label: "Sin plataforma asignada", clubes: arbol.filter((c) => !c.platform || !PLATFORM_ORDER.includes(c.platform)) },
  ].filter((g) => g.clubes.length > 0);

  return (
    <div>
      <div className="muted" style={{ marginBottom: 14 }}>
        Primero por plataforma (Suprema / GG Poker / X-Poker) y adentro los clubes activos con los agentes que ya tienen
        jugadores cargados ahí (por import o carga manual) y su % vigente. El % es editable por acá mismo — versiona el
        deal anterior, igual que en "Ver deals". Los jugadores son de solo lectura: no tienen % propio, siempre cobran a
        través de su agente. "Sin plataforma asignada" son clubes que todavía no se cargaron desde ningún importador.
      </div>

      {editando && editandoAgente && (
        <div style={{ marginBottom: 16 }}>
          <NuevoDeal
            agentes={agentes}
            clubes={clubes}
            fixedAgentId={editando.agentId}
            initial={dealActualParaEditar}
            onCreated={() => { setEditando(null); refresh(); }}
          />
          <button className="btn secondary small" style={{ marginTop: 6 }} onClick={() => setEditando(null)}>Cancelar</button>
        </div>
      )}

      {cargando ? (
        <div className="muted">Cargando...</div>
      ) : (
        grupos.map((grupo) => (
          <div key={grupo.key} style={{ marginBottom: 22 }}>
            <h3 style={{ marginBottom: 8 }}>{grupo.label}</h3>
            {grupo.clubes.map((club) => {
          const abierto = !!clubesAbiertos[club.clubId];
          return (
            <div key={club.clubId} className="panel" style={{ marginBottom: 10 }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                onClick={() => setClubesAbiertos((s) => ({ ...s, [club.clubId]: !s[club.clubId] }))}
              >
                <h4 style={{ margin: 0 }}>{abierto ? "▾" : "▸"} {club.clubName}</h4>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }} onClick={(e) => e.stopPropagation()}>
                  <span className="muted" style={{ fontSize: 12.5 }}>{club.agentes.length} agente(s)</span>
                  <select
                    value={club.platform ?? ""}
                    disabled={cambiandoPlataforma === club.clubId}
                    title="Mover este club a otra plataforma (o sacarlo de todas)"
                    onChange={(e) => cambiarPlataforma(club.clubId, e.target.value)}
                    style={{ fontSize: 11.5 }}
                  >
                    <option value="">Sin plataforma</option>
                    {PLATFORM_ORDER.map((key) => (
                      <option key={key} value={key}>{PLATFORM_LABELS[key]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {abierto && (
                club.agentes.length === 0 ? (
                  <div className="muted" style={{ marginTop: 10 }}>Todavía no tiene ningún agente con jugadores cargados.</div>
                ) : (
                  <table style={{ marginTop: 10 }}>
                    <thead><tr><th></th><th>Agente</th><th>Jugadores</th><th>% Rakeback</th><th>% Rebate</th><th>Config</th><th></th><th></th></tr></thead>
                    <tbody>
                      {club.agentes.map((ag: any) => {
                        const clave = `${club.clubId}|${ag.agentId}`;
                        const agAbierto = !!agentesAbiertos[clave];
                        return (
                          <Fragment key={clave}>
                            <tr>
                              <td style={{ cursor: "pointer" }} onClick={() => toggleAgente(club.clubId, ag.agentId)}>{agAbierto ? "▾" : "▸"}</td>
                              <td>{ag.agentName}</td>
                              <td>{ag.jugadores}</td>
                              <td>{pct(ag.rakebackPct)}</td>
                              <td>{pct(ag.rebatePct)}</td>
                              <td className="muted" style={{ fontSize: 11.5 }}>{ag.configSource === "deal" ? "propio" : "default club"}</td>
                              <td>
                                <button className="btn secondary small" onClick={() => setEditando({ clubId: club.clubId, agentId: ag.agentId, agentName: ag.agentName })}>
                                  Editar %
                                </button>
                              </td>
                              <td>
                                <select
                                  value=""
                                  disabled={moviendoAgente === clave}
                                  title="Mover TODOS los jugadores de este agente a otro club"
                                  onChange={(e) => moverAgente(club.clubId, ag.agentId, ag.agentName, e.target.value)}
                                  style={{ fontSize: 11.5 }}
                                >
                                  <option value="">{moviendoAgente === clave ? "Moviendo..." : "Mover a..."}</option>
                                  {clubes.filter((c) => c.id !== club.clubId).map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                            {agAbierto && (
                              <tr>
                                <td></td>
                                <td colSpan={7}>
                                  {cargandoJugadores === clave ? (
                                    <span className="muted">Cargando jugadores...</span>
                                  ) : (
                                    <div className="muted" style={{ fontSize: 12.5, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
                                      {(jugadoresPorAgente[clave] ?? []).map((j: any) => (
                                        <span key={j.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                          {j.display_name ?? j.external_id}
                                          <button
                                            className="btn secondary small"
                                            style={{ padding: "0 6px", fontSize: 11 }}
                                            disabled={eliminandoJugador === j.id}
                                            title="Eliminar este jugador de este club (para recargarlo a mano en el club correcto)"
                                            onClick={() => eliminarJugador(clave, j.id, j.display_name ?? j.external_id)}
                                          >
                                            {eliminandoJugador === j.id ? "..." : "✕"}
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )
              )}
            </div>
          );
            })}
          </div>
        ))
      )}
    </div>
  );
}

function SupervisoresView() {
  const [data, setData] = useState<{ supervisores: any[]; supervisoresInvalidos: any[] } | null>(null);

  useEffect(() => {
    api.supervisores().then(setData);
  }, []);

  if (!data) return <div className="muted">Cargando...</div>;

  return (
    <div>
      <div className="panel">
        <h3>Rakeback centralizado por supervisor</h3>
        <div className="muted" style={{ marginBottom: 14 }}>
          Cuando un club tiene el rebate configurado con destino "Rakeback supervisor", ese % de cada cierre de sus agentes a cargo no
          entra al saldo del agente — se acredita acá, centralizado.
        </div>
        {data.supervisores.length === 0 ? (
          <div className="muted">Todavía no hay agentes con tipo de cuenta "Supervisor".</div>
        ) : (
          data.supervisores.map((s) => (
            <div key={s.id} style={{ marginBottom: 22 }}>
              <div className="topbar" style={{ marginBottom: 8 }}>
                <h4 style={{ margin: 0 }}>{s.name}</h4>
                <div style={{ display: "flex", gap: 16 }}>
                  <span className="muted">Rakeback centralizado acreditado: <strong>{usd(s.rakeback_centralizado_acreditado)}</strong></span>
                  <span className={`badge ${Number(s.saldo_total) >= 0 ? "pos" : "neg"}`}>Saldo propio: {usd(s.saldo_total)}</span>
                </div>
              </div>
              {s.agentes.length === 0 ? (
                <div className="muted" style={{ fontSize: 13 }}>Sin agentes a cargo.</div>
              ) : (
                <table>
                  <thead><tr><th>Agente a cargo</th><th>Tipo de cuenta</th><th>Saldo propio</th></tr></thead>
                  <tbody>
                    {s.agentes.map((a: any) => (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td><span className="badge neutral">{ACCOUNT_TYPE_LABELS[a.account_type as AccountType] ?? a.account_type}</span></td>
                        <td><span className={`badge ${Number(a.saldo_total) >= 0 ? "pos" : "neg"}`}>{usd(a.saldo_total)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))
        )}
      </div>

      {data.supervisoresInvalidos.length > 0 && (
        <div className="panel">
          <h3>⚠ Supervisores mal cargados</h3>
          <div className="muted" style={{ marginBottom: 14 }}>
            Estos agentes tienen un supervisor cargado que no coincide con ningún agente activo de tipo "Supervisor". Si alguno de sus
            clubes tiene el rebate con destino "Rakeback supervisor", el cierre semanal se va a bloquear hasta que corrijas esto.
          </div>
          <table>
            <thead><tr><th>Agente</th><th>Supervisor cargado (no válido)</th></tr></thead>
            <tbody>
              {data.supervisoresInvalidos.map((a: any) => (
                <tr key={a.id}><td>{a.name}</td><td>{a.supervisor}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClubesConfig({
  clubes,
  onEdit,
  onDarDeBaja,
}: {
  clubes: any[];
  onEdit: (club: any) => void;
  onDarDeBaja: (club: any) => void;
}) {
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
              <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn secondary small" onClick={() => onEdit(c)}>Configurar</button>
                <button className="btn secondary small" onClick={() => onDarDeBaja(c)}>Dar de baja</button>
              </td>
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
  const [importPlatform, setImportPlatform] = useState<string>(club.import_platform ?? "");
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
        importPlatform: importPlatform || null,
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
        <label>Plataforma de origen (informativo, opcional)</label>
        <select value={importPlatform} onChange={(e) => setImportPlatform(e.target.value)}>
          <option value="">Sin especificar</option>
          <option value="SUPREMA">SupremaPoker</option>
        </select>
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Solo a modo de referencia — no hace falta completarlo para poder elegir este club al importar un archivo.
          Un mismo club real que opera en más de una red (ej. "Fénix" en GG y en Suprema) se maneja como un registro de
          club separado por plataforma, así el importador nunca mezcla cierres de redes distintas. Se completa solo
          cuando elegís este club en el importador de Suprema.
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

// fixedAgentId: cuando se usa desde el panel "Deals de {agente}" el agente ya está elegido y no
// hace falta mostrar el selector. initial: para editar un deal existente (precarga club/sistema/%,
// el submit sigue siendo un upsertDeal normal — versiona el anterior, nunca lo pisa en el lugar).
function NuevoDeal({
  agentes,
  clubes,
  onCreated,
  fixedAgentId,
  initial,
}: {
  agentes: any[];
  clubes: any[];
  onCreated: () => void;
  fixedAgentId?: string;
  initial?: { club_id: string; system: "PREPAGO" | "WIN_LOSE"; rakeback_pct: number; rebate_pct: number; notes?: string | null };
}) {
  const [agentId, setAgentId] = useState(fixedAgentId ?? "");
  const [clubId, setClubId] = useState(initial?.club_id ?? "");
  const [system, setSystem] = useState<"PREPAGO" | "WIN_LOSE">(initial?.system ?? "WIN_LOSE");
  const [rakebackPct, setRakebackPct] = useState(initial ? String(Number(initial.rakeback_pct) * 100) : "70");
  const [rebatePct, setRebatePct] = useState(initial ? String(Number(initial.rebate_pct) * 100) : "0");
  const [notes, setNotes] = useState(initial?.notes ?? "");
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
      setMsg({ ok: true, text: initial ? "Deal actualizado desde ahora (el anterior queda en el historial)." : "Deal guardado. Reemplaza cualquier % anterior para ese agente+club a partir de ahora." });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el deal." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <h3>{initial ? "Editar deal" : "Asignar % de rakeback/rebate a un agente en un club"}</h3>
      <div className="muted" style={{ marginBottom: 14 }}>
        Esto no borra el historial: versiona el deal anterior (queda con fecha de fin) y crea uno nuevo vigente.
      </div>
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          {!fixedAgentId && (
            <div className="field">
              <label>Agente</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                <option value="">Elegir...</option>
                {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}
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
