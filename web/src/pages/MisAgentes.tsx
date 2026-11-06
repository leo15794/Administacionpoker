import { useEffect, useState } from "react";
import { api } from "../api";
import { usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";

// "Mis agentes" del supervisor (06/11/2026, pedido de Leo, mockup 80 aprobado): panel propio, aparte de "Mi supervisión".
// A la izquierda sus agentes a cargo con su estado; a la derecha el agente elegido: su usuario para entrar, sus % por club
// (sistema, rakeback, rebate) y cómo ve su última semana con esos %. Los % son el acuerdo entre el supervisor y su agente:
// no cambian lo que le acreditamos al supervisor (ver repo/supervisorAcuerdos.ts).
const pct = (n: number) => `${(Math.round(Number(n) * 10000) / 100).toLocaleString("es-AR")}%`;
const signo = (n: number) => (n < -0.004 ? "neg" : n > 0.004 ? "pos" : "");

export default function MisAgentes() {
  const [agentes, setAgentes] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [elegido, setElegido] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  function cargar() {
    api
      .misAgentesSupervisor()
      .then((lista: any[]) => {
        setAgentes(lista);
        setElegido((e) => e ?? lista[0]?.id ?? null);
      })
      .catch((e) => setError(e.message));
  }
  useEffect(cargar, []);

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!agentes) return <Loading />;

  const conUsuario = agentes.filter((a) => a.usuario?.active).length;
  const sinUsuario = agentes.filter((a) => !a.usuario).length;
  const clubesTotal = agentes.reduce((t, a) => t + a.clubes.length, 0);
  const clubesConPct = agentes.reduce((t, a) => t + a.clubes.filter((c: any) => c.acuerdo).length, 0);
  const visibles = agentes.filter((a) => busca.trim() === "" || a.name.toLowerCase().includes(busca.trim().toLowerCase()));
  const agente = agentes.find((a) => a.id === elegido) ?? null;

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <h2>Mis agentes</h2>
          <div className="muted">
            Creales el usuario para que entren a ver su cuenta y poneles sus % por club. Es tu acuerdo con cada uno: no cambia lo que nosotros te acreditamos.
          </div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card"><div className="label">Agentes a cargo</div><div className="value">{agentes.length}</div></div>
        <div className="kpi-card"><div className="label">Con usuario</div><div className="value pos">{conUsuario}</div><div className="kpi-sub muted">pueden entrar</div></div>
        <div className="kpi-card"><div className="label">Sin usuario</div><div className="value" style={sinUsuario ? { color: "var(--amber)" } : undefined}>{sinUsuario}</div><div className="kpi-sub muted">todavía no entran</div></div>
        <div className="kpi-card"><div className="label">Clubes con % cargados</div><div className="value">{clubesConPct} de {clubesTotal}</div><div className="kpi-sub muted">{clubesTotal - clubesConPct > 0 ? `faltan ${clubesTotal - clubesConPct}` : "todos cargados"}</div></div>
      </div>

      {agentes.length === 0 ? (
        <div className="panel muted">Todavía no tenés agentes a cargo.</div>
      ) : (
        <div className="ma-split">
          <div className="panel ma-lista">
            <input className="ma-busca" placeholder="Buscar agente..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            {visibles.map((a) => {
              const faltan = a.clubes.filter((c: any) => !c.acuerdo).length;
              return (
                <button key={a.id} type="button" className={`ma-fila ${a.id === elegido ? "on" : ""}`} onClick={() => setElegido(a.id)}>
                  <span className="ma-av">{a.name.slice(0, 2).toUpperCase()}</span>
                  <span className="ma-txt">
                    <b>{a.name}</b>
                    <small>{a.clubes.map((c: any) => c.club_name).join(" · ") || "sin clubes"}</small>
                    <span className="ma-pills">
                      {a.usuario ? (
                        <span className={`pill ${a.usuario.active ? "g" : "r"}`}>{a.usuario.active ? "Con usuario" : "Usuario desactivado"}</span>
                      ) : (
                        <span className="pill a">Sin usuario</span>
                      )}
                      {a.clubes.length > 0 && (faltan === 0 ? <span className="pill g">% cargados</span> : <span className="pill a">Faltan % en {faltan} club{faltan === 1 ? "" : "es"}</span>)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {agente && (
            <div className="panel ma-det" key={agente.id}>
              <div className="ma-eyebrow">AGENTE A CARGO</div>
              <h3 style={{ margin: "2px 0 2px", fontSize: 22 }}>{agente.name}</h3>
              <div className="muted">{agente.clubes.length ? `Opera en ${agente.clubes.map((c: any) => c.club_name).join(", ")}` : "Todavía no opera en ningún club"}</div>

              <UsuarioAgente agente={agente} onCambio={cargar} />

              <div className="ma-blk">
                <div className="ma-blk-h">
                  <b>Sus % por club</b>
                  <small>valen desde que los guardás; las semanas anteriores quedan con los de antes</small>
                </div>
                {agente.clubes.length === 0 ? (
                  <div className="muted">Este agente todavía no opera en ningún club.</div>
                ) : (
                  <>
                    <div className="ma-pt ma-pt-h"><span>Club</span><span>Sistema</span><span>Rakeback</span><span>Rebate</span><span /></div>
                    {agente.clubes.map((c: any) => <AcuerdoClub key={c.club_id} agentId={agente.id} club={c} onCambio={cargar} />)}
                  </>
                )}
              </div>

              {agente.clubes.some((c: any) => c.ultima_semana) && (
                <div className="ma-blk">
                  <div className="ma-blk-h"><b>Así ve su última semana</b><small>con tus %</small></div>
                  {agente.clubes.filter((c: any) => c.ultima_semana).map((c: any) => {
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
                            {Number(u.rebate) !== 0 && <div><small>Rebate {pct(u.rebate_pct)}</small><b>{usdCents(u.rebate)}</b></div>}
                            <div><small>Su cierre</small><b className={signo(u.final_closing)}>{usdCents(u.final_closing)}</b></div>
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

function UsuarioAgente({ agente, onCambio }: { agente: any; onCambio: () => void }) {
  const u = agente.usuario;
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
          <button className="btn secondary small" disabled={loading || password.length < 6} onClick={() => ejecutar(() => api.cambiarUsuarioMiAgente(agente.id, { password }), "Contraseña cambiada.")}>
            Cambiar contraseña
          </button>
          <button
            className={`btn small ${u.active ? "danger" : ""}`}
            disabled={loading}
            onClick={() => ejecutar(() => api.cambiarUsuarioMiAgente(agente.id, { active: !u.active }), u.active ? "Usuario desactivado." : "Usuario activado.")}
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
            onClick={() => ejecutar(() => api.crearUsuarioMiAgente(agente.id, { email: email.trim(), password }), "Usuario creado. Pasale el usuario y la contraseña.")}
          >
            Crear usuario
          </button>
        </div>
      )}
      {msg && <div className={msg.ok ? "success" : "error"} style={{ marginTop: 10 }}>{msg.text}</div>}
    </div>
  );
}

function AcuerdoClub({ agentId, club, onCambio }: { agentId: string; club: any; onCambio: () => void }) {
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
      await api.guardarAcuerdoMiAgente(agentId, { clubId: club.club_id, system, rakebackPct: num(rakeback), rebatePct: num(rebate) });
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
