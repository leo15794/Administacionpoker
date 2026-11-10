import { useEffect, useState } from "react";
import { api } from "../api";
import { usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";

// "Mis subagentes" del agente (10/11/2026, pedido de Leo, mockup 87): los subagentes salen solos del archivo semanal del club (Suprema y
// TeamBack GG). El agente les crea el usuario y les pone sus % por club; ve cómo ve su última semana el subagente y cuánto le queda a él.
// Mismo armado que "Mis agentes" del supervisor (MisAgentes.tsx). Es un acuerdo entre el agente y su subagente: no cambia lo que le
// liquidamos al agente (ver repo/subagentes.ts).
// Carga a mano (10/11/2026, caso Cachito1976): "Nuevo subagente" + elegir sus jugadores tildándolos; vale también para las semanas viejas.
const pct = (n: number) => `${(Math.round(Number(n) * 10000) / 100).toLocaleString("es-AR")}%`;
const signo = (n: number) => (n < -0.004 ? "neg" : n > 0.004 ? "pos" : "");

export default function MisSubagentes() {
  const [subs, setSubs] = useState<any[] | null>(null);
  const [todos, setTodos] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [elegido, setElegido] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [msgNuevo, setMsgNuevo] = useState("");

  function cargar(seleccionar?: string) {
    api
      .misSubagentes()
      .then((r: any) => {
        setSubs(r.subagentes);
        setTodos(r.jugadores ?? []);
        setElegido((e) => seleccionar ?? e ?? r.subagentes[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }

  async function crear() {
    setMsgNuevo("");
    try {
      const r = await api.crearSubagente((nuevo ?? "").trim());
      setNuevo(null);
      setEditando(r.id);
      cargar(r.id);
    } catch (err: any) {
      setMsgNuevo(err.message || "No se pudo crear.");
    }
  }
  useEffect(() => cargar(), []);

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!subs) return <Loading />;

  const conUsuario = subs.filter((s) => s.usuario?.active).length;
  const jugadores = subs.reduce((t, s) => t + s.jugadores.length, 0);
  // Lo que le queda al agente en la última semana de cada subagente con % cargados.
  const ultimas = subs.flatMap((s) => s.clubes.map((c: any) => c.ultima_semana).filter((u: any) => u && !u.sin_acuerdo));
  const semanaMax = ultimas.reduce((m: string, u: any) => (String(u.week_start) > m ? String(u.week_start) : m), "");
  const teQueda = ultimas.filter((u: any) => String(u.week_start) === semanaMax).reduce((t: number, u: any) => t + Number(u.margen ?? 0), 0);
  const sub = subs.find((s) => s.id === elegido) ?? null;

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <h2>Mis subagentes</h2>
          <div className="muted">
            Creá tus subagentes y elegí sus jugadores (o salen solos del archivo del club). Poneles sus % y, si querés, creales un usuario para que vean sus cierres.
          </div>
        </div>
        {nuevo === null && (
          <button className="btn" onClick={() => setNuevo("")}>+ Nuevo subagente</button>
        )}
      </div>

      {nuevo !== null && (
        <div className="panel sa-nuevo">
          <b>Nuevo subagente</b>
          <input autoFocus value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Nombre (ej. Juan)" onKeyDown={(e) => e.key === "Enter" && nuevo.trim().length >= 2 && crear()} />
          <button className="btn small" disabled={nuevo.trim().length < 2} onClick={crear}>Crear y elegir jugadores</button>
          <button className="btn secondary small" onClick={() => { setNuevo(null); setMsgNuevo(""); }}>Cancelar</button>
          {msgNuevo && <span className="neg" style={{ fontSize: 12 }}>{msgNuevo}</span>}
        </div>
      )}

      <div className="kpi-grid">
        <div className="kpi-card"><div className="label">Subagentes</div><div className="value">{subs.length}</div></div>
        <div className="kpi-card"><div className="label">Con usuario</div><div className="value pos">{conUsuario}</div><div className="kpi-sub muted">pueden entrar</div></div>
        <div className="kpi-card"><div className="label">Jugadores de subagentes</div><div className="value">{jugadores}</div></div>
        <div className="kpi-card">
          <div className="label">Te quedan la última semana</div>
          <div className="value" style={{ color: "var(--gold, #c6a66b)" }}>{semanaMax ? usdCents(teQueda) : "—"}</div>
          <div className="kpi-sub muted">{semanaMax ? `semana del ${dateShort(semanaMax).slice(0, 5)}` : "cargales los % para verlo"}</div>
        </div>
      </div>

      {subs.length === 0 ? (
        <div className="panel muted">
          Todavía no tenés subagentes. Tocá "+ Nuevo subagente", ponele un nombre y elegí sus jugadores. También aparecen solos cuando el archivo del club (Suprema o TeamBack GG) informa un subagente.
        </div>
      ) : (
        <div className="ma-split">
          <div className="panel ma-lista">
            {subs.map((s) => {
              const faltan = s.clubes.filter((c: any) => !c.acuerdo).length;
              return (
                <button key={s.id} type="button" className={`ma-fila ${s.id === elegido ? "on" : ""}`} onClick={() => setElegido(s.id)}>
                  <span className="ma-av">{s.name.slice(0, 2).toUpperCase()}</span>
                  <span className="ma-txt">
                    <b>{s.name}</b>
                    <small>{s.jugadores.length} jugador{s.jugadores.length === 1 ? "" : "es"}{s.clubes.length ? ` · ${s.clubes.map((c: any) => c.club_name).join(" · ")}` : ""}</small>
                    <span className="ma-pills">
                      {s.usuario ? (
                        <span className={`pill ${s.usuario.active ? "g" : "r"}`}>{s.usuario.active ? "Con usuario" : "Usuario desactivado"}</span>
                      ) : (
                        <span className="pill a">Sin usuario</span>
                      )}
                      {s.clubes.length > 0 && (faltan === 0 ? <span className="pill g">% cargados</span> : <span className="pill a">Faltan % en {faltan} club{faltan === 1 ? "" : "es"}</span>)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {sub && (
            <div className="panel ma-det" key={sub.id}>
              <div className="ma-eyebrow">SUBAGENTE</div>
              <h3 style={{ margin: "2px 0 2px", fontSize: 22 }}>{sub.name}</h3>
              <div className="muted">{sub.clubes.length ? `Opera en ${sub.clubes.map((c: any) => c.club_name).join(", ")}` : "Todavía no tiene jugadores: elegilos abajo."}</div>

              <UsuarioSubagente sub={sub} onCambio={() => cargar()} />

              {editando === sub.id ? (
                <ElegirJugadores sub={sub} subs={subs} todos={todos} onListo={() => { setEditando(null); cargar(); }} onCancelar={() => setEditando(null)} />
              ) : (
                <div className="ma-blk">
                  <div className="ma-blk-h">
                    <b>Sus jugadores</b>
                    <button className="btn secondary small" onClick={() => setEditando(sub.id)}>Elegir jugadores</button>
                  </div>
                  {sub.jugadores.length === 0 ? (
                    <div className="muted">Todavía no tiene jugadores.</div>
                  ) : (
                    <div className="sa-jug">
                      {sub.jugadores.map((j: any) => (
                        <span key={`${j.club_id}|${j.id}`}>{j.nombre}<i>{j.id}</i></span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="ma-blk">
                <div className="ma-blk-h">
                  <b>Sus % por club</b>
                  <small>valen desde que los guardás; las semanas anteriores quedan con los de antes</small>
                </div>
                {sub.clubes.length === 0 ? (
                  <div className="muted">Elegí sus jugadores y acá te aparecen sus clubes para ponerle los %.</div>
                ) : (
                  <>
                    <div className="ma-pt ma-pt-h"><span>Club</span><span>Sistema</span><span>Rakeback</span><span>Rebate</span><span /></div>
                    {sub.clubes.map((c: any) => <AcuerdoClub key={c.club_id} subId={sub.id} club={c} onCambio={() => cargar()} />)}
                  </>
                )}
              </div>

              {sub.clubes.some((c: any) => c.ultima_semana) && (
                <div className="ma-blk">
                  <div className="ma-blk-h"><b>Así ve su última semana</b><small>con tus %</small></div>
                  {sub.clubes.filter((c: any) => c.ultima_semana).map((c: any) => {
                    const u = c.ultima_semana;
                    return (
                      <div key={c.club_id} style={{ marginBottom: 10 }}>
                        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                          {dateShort(u.week_start).slice(0, 5)} al {dateShort(u.week_end).slice(0, 5)} · {c.club_name}
                        </div>
                        {u.sin_acuerdo ? (
                          <div className="muted">Cargale los % en este club para que vea su cierre.</div>
                        ) : (
                          <div className="ma-prev">
                            <div><small>Resultado</small><b className={signo(u.result)}>{usdCents(u.result)}</b></div>
                            <div><small>Rake</small><b>{usdCents(u.rake_total)}</b></div>
                            <div><small>Rakeback {pct(u.rakeback_pct)}</small><b className="pos">{usdCents(u.rakeback)}</b></div>
                            {Number(u.rebate) !== 0 && <div><small>Rebate</small><b>{usdCents(u.rebate)}</b></div>}
                            <div><small>Su cierre</small><b className={signo(u.final_closing)}>{usdCents(u.final_closing)}</b></div>
                            <div className="sa-queda"><small>Te queda</small><b>{usdCents(u.margen)}</b></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tildar los jugadores del subagente. Los que el archivo ya le asigna vienen tildados; si un jugador era de otro subagente, pasa a este.
function ElegirJugadores({ sub, subs, todos, onListo, onCancelar }: { sub: any; subs: any[]; todos: any[]; onListo: () => void; onCancelar: () => void }) {
  const k = (j: any) => `${j.club_id}|${j.external_id}`;
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(todos.filter((j) => j.subagente_id === sub.id).map(k)));
  const [busca, setBusca] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const nombreSub = (id: string | null) => subs.find((s) => s.id === id)?.name ?? null;
  const visibles = todos.filter((j) => busca.trim() === "" || `${j.nombre} ${j.external_id}`.toLowerCase().includes(busca.trim().toLowerCase()));
  const clubes = [...new Set(visibles.map((j) => j.club_name))];

  function alternar(j: any) {
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(k(j))) n.delete(k(j));
      else n.add(k(j));
      return n;
    });
  }

  async function guardar() {
    setMsg("");
    setLoading(true);
    try {
      const jugadores = todos.filter((j) => marcados.has(k(j))).map((j) => ({ clubId: j.club_id, playerExternalId: j.external_id }));
      await api.asignarJugadoresSubagente(sub.id, jugadores);
      onListo();
    } catch (err: any) {
      setMsg(err.message || "No se pudo guardar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ma-blk">
      <div className="ma-blk-h">
        <b>Elegí los jugadores de {sub.name}</b>
        <small>{marcados.size} tildado{marcados.size === 1 ? "" : "s"} · valen también para las semanas ya cargadas</small>
      </div>
      {todos.length === 0 ? (
        <div className="muted">Todavía no tenés jugadores cargados.</div>
      ) : (
        <>
          {todos.length > 8 && <input className="ma-busca" placeholder="Buscar jugador..." value={busca} onChange={(e) => setBusca(e.target.value)} />}
          <div className="sa-elegir">
            {clubes.map((club) => (
              <div key={club}>
                {clubes.length > 1 && <div className="sa-club">{club}</div>}
                {visibles.filter((j) => j.club_name === club).map((j) => {
                  const otro = j.subagente_id && j.subagente_id !== sub.id ? nombreSub(j.subagente_id) : null;
                  return (
                    <label key={k(j)} className={`sa-op ${marcados.has(k(j)) ? "on" : ""}`}>
                      <input type="checkbox" checked={marcados.has(k(j))} onChange={() => alternar(j)} />
                      <span><b>{j.nombre}</b><i>{j.external_id}</i></span>
                      {otro && <small>{marcados.has(k(j)) ? `pasa de ${otro}` : `de ${otro}`}</small>}
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
      <div className="ma-urow" style={{ marginTop: 10 }}>
        <button className="btn small" disabled={loading} onClick={guardar}>{loading ? "..." : "Guardar jugadores"}</button>
        <button className="btn secondary small" onClick={onCancelar}>Cancelar</button>
        {msg && <span className="neg" style={{ fontSize: 12 }}>{msg}</span>}
      </div>
    </div>
  );
}

function UsuarioSubagente({ sub, onCambio }: { sub: any; onCambio: () => void }) {
  const u = sub.usuario;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function ejecutar(fn: () => Promise<any>, ok: string) {
    setMsg(null);
    setLoading(true);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setPassword("");
      onCambio();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ma-blk">
      <div className="ma-blk-h">
        <b>Usuario para entrar</b>
        {u && <span className={`pill ${u.active ? "g" : "r"}`}>{u.active ? "Activo" : "Desactivado"}</span>}
      </div>
      {u ? (
        <div className="ma-urow">
          <span>Entra con <b>{u.email}</b></span>
          <span style={{ flex: 1 }} />
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nueva contraseña" style={{ width: 180 }} />
          <button className="btn secondary small" disabled={loading || password.length < 6} onClick={() => ejecutar(() => api.cambiarUsuarioSubagente(sub.id, { password }), "Contraseña cambiada.")}>
            Cambiar contraseña
          </button>
          <button
            className={`btn small ${u.active ? "danger" : ""}`}
            disabled={loading}
            onClick={() => ejecutar(() => api.cambiarUsuarioSubagente(sub.id, { active: !u.active }), u.active ? "Usuario desactivado." : "Usuario activado.")}
          >
            {u.active ? "Desactivar" : "Activar"}
          </button>
        </div>
      ) : (
        <div className="ma-urow">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Usuario (ej. juan123)" style={{ width: 200 }} />
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Contraseña (mín. 6)" style={{ width: 180 }} />
          <button
            className="btn small"
            disabled={loading || email.trim().length < 3 || password.length < 6}
            onClick={() => ejecutar(() => api.crearUsuarioSubagente(sub.id, { email: email.trim(), password }), "Usuario creado. Pasale el usuario y la contraseña.")}
          >
            Crear usuario
          </button>
        </div>
      )}
      {msg && <div className={msg.ok ? "success" : "error"} style={{ marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}

function AcuerdoClub({ subId, club, onCambio }: { subId: string; club: any; onCambio: () => void }) {
  const a = club.acuerdo;
  const [system, setSystem] = useState<"PREPAGO" | "WIN_LOSE">(a?.system ?? "WIN_LOSE");
  const [rakeback, setRakeback] = useState(a ? String(Math.round(a.rakeback_pct * 10000) / 100) : "");
  const [rebate, setRebate] = useState(a ? String(Math.round(a.rebate_pct * 10000) / 100) : "0");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const num = (v: string) => Number(String(v).replace(",", "."));
  const valido = [rakeback, rebate].every((v) => v.trim() !== "" && Number.isFinite(num(v)) && num(v) >= 0 && num(v) <= 100);
  const cambio = !a || a.system !== system || Math.abs(a.rakeback_pct * 100 - num(rakeback)) > 0.001 || Math.abs(a.rebate_pct * 100 - num(rebate)) > 0.001;

  async function guardar() {
    setMsg(null);
    setLoading(true);
    try {
      await api.guardarAcuerdoSubagente(subId, { clubId: club.club_id, system, rakebackPct: num(rakeback), rebatePct: num(rebate) });
      setMsg({ ok: true, text: "✓ Guardado" });
      onCambio();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ma-pt">
      <b>{club.club_name}{!a && <span className="pill a" style={{ marginLeft: 6 }}>sin %</span>}</b>
      <span className="ma-seg">
        <button type="button" className={system === "WIN_LOSE" ? "on" : ""} onClick={() => setSystem("WIN_LOSE")}>Win/Lose</button>
        <button type="button" className={system === "PREPAGO" ? "on" : ""} onClick={() => setSystem("PREPAGO")}>Prepago</button>
      </span>
      <span className="ma-pct"><input value={rakeback} onChange={(e) => setRakeback(e.target.value)} inputMode="decimal" placeholder="ej. 30" />%</span>
      <span className="ma-pct"><input value={rebate} onChange={(e) => setRebate(e.target.value)} inputMode="decimal" />%</span>
      <span>
        {cambio ? (
          <button className="btn small" disabled={loading || !valido} onClick={guardar}>{loading ? "..." : "Guardar"}</button>
        ) : (
          <span className={msg && !msg.ok ? "neg" : "pos"} style={{ fontSize: 12, fontWeight: 700 }}>{msg?.text ?? "✓ Guardado"}</span>
        )}
        {msg && !msg.ok && <div className="neg" style={{ fontSize: 11, marginTop: 4 }}>{msg.text}</div>}
      </span>
    </div>
  );
}
