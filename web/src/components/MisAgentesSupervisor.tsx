import { useEffect, useState } from "react";
import { api } from "../api";
import Loading from "./Loading";
import Modal from "./Modal";
import { PortalPane } from "./PortalUI";

// "Mis agentes" del portal del supervisor (05/11/2026, pedido de Leo): el supervisor crea el usuario de cada agente a cargo
// (para que entre a ver su cuenta), le cambia la contraseña o lo desactiva, y le pone sus % por club: sistema, rakeback y
// rebate. Esos % son el acuerdo entre el supervisor y su agente -- no cambian los cierres ni lo que le pagamos al
// supervisor; el agente ve su cierre calculado con ellos (ver repo/supervisorAcuerdos.ts).
export default function MisAgentesSupervisor({ activa }: { activa: boolean }) {
  const [agentes, setAgentes] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<any | null>(null);

  function cargar() {
    api.misAgentesSupervisor().then(setAgentes).catch((e) => setError(e.message));
  }
  useEffect(cargar, []);

  return (
    <PortalPane activa={activa} titulo="Mis agentes: usuarios y %">
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Creale un usuario a cada agente para que entre a ver su cuenta, y cargale sus % por club. Esos % son tu acuerdo con él:
        con eso ve su cierre de cada semana. No cambian lo que nosotros te acreditamos a vos.
      </div>
      {error ? (
        <div className="error">{error}</div>
      ) : !agentes ? (
        <Loading />
      ) : agentes.length === 0 ? (
        <div className="muted">Todavía no tenés agentes a cargo.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {agentes.map((a) => {
            const conAcuerdo = a.clubes.filter((c: any) => c.acuerdo).length;
            return (
              <button
                key={a.id}
                type="button"
                className="pt-card"
                style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", width: "100%" }}
                onClick={() => setAbierto(a)}
              >
                <div className="b">
                  <div className="t1">
                    <span className="n">{a.name}</span>
                    <span className={`pill ${a.usuario ? (a.usuario.active ? "g" : "r") : "a"}`}>
                      {a.usuario ? (a.usuario.active ? "Con usuario" : "Usuario desactivado") : "Sin usuario"}
                    </span>
                  </div>
                  <div className="t2">
                    <span>{a.usuario ? `Usuario: ${a.usuario.email}` : "Tocá para crearle el usuario"}</span>
                    <span>
                      % cargados en {conAcuerdo} de {a.clubes.length} club{a.clubes.length === 1 ? "" : "es"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      {abierto && (
        <Modal title={abierto.name} onClose={() => setAbierto(null)} wide>
          <GestionAgente
            agente={abierto}
            onCambio={() => {
              api.misAgentesSupervisor().then((lista: any[]) => {
                setAgentes(lista);
                setAbierto(lista.find((x) => x.id === abierto.id) ?? null);
              });
            }}
          />
        </Modal>
      )}
    </PortalPane>
  );
}

function GestionAgente({ agente, onCambio }: { agente: any; onCambio: () => void }) {
  return (
    <div>
      <UsuarioAgente agente={agente} onCambio={onCambio} />
      <h4 style={{ margin: "22px 0 4px" }}>Sus % por club</h4>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Es tu acuerdo con {agente.name}. Cuando lo cambiás, vale desde ahora; las semanas anteriores se le siguen mostrando con el de antes.
      </div>
      {agente.clubes.length === 0 ? (
        <div className="muted">Este agente todavía no opera en ningún club.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {agente.clubes.map((c: any) => (
            <AcuerdoClub key={c.club_id} agentId={agente.id} club={c} onCambio={onCambio} />
          ))}
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
    <div className="panel" style={{ marginBottom: 0 }}>
      <h4 style={{ margin: "0 0 8px" }}>Usuario para entrar</h4>
      {u ? (
        <>
          <div style={{ marginBottom: 10 }}>
            Entra con <b>{u.email}</b> · {u.active ? <span className="pill g">Activo</span> : <span className="pill r">Desactivado</span>}
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Nueva contraseña</label>
              <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn small" disabled={loading || password.length < 6} onClick={() => ejecutar(() => api.cambiarUsuarioMiAgente(agente.id, { password }), "Contraseña cambiada.")}>
              Cambiar contraseña
            </button>
            <button
              className="btn secondary small"
              disabled={loading}
              onClick={() => ejecutar(() => api.cambiarUsuarioMiAgente(agente.id, { active: !u.active }), u.active ? "Usuario desactivado." : "Usuario activado.")}
            >
              {u.active ? "Desactivar usuario" : "Activar usuario"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="form-grid">
            <div className="field">
              <label>Usuario</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ej. juan123 o un email" />
            </div>
            <div className="field">
              <label>Contraseña</label>
              <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" />
            </div>
          </div>
          <button
            className="btn small"
            disabled={loading || email.trim().length < 3 || password.length < 6}
            onClick={() => ejecutar(() => api.crearUsuarioMiAgente(agente.id, { email: email.trim(), password }), "Usuario creado. Pasale el usuario y la contraseña.")}
          >
            Crear usuario
          </button>
        </>
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
      setMsg({ ok: true, text: "Guardado." });
      onCambio();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pt-card" style={{ display: "block" }}>
      <div className="b">
        <div className="t1">
          <span className="n">{club.club_name}</span>
          {!a && <span className="pill a">Sin % cargados</span>}
        </div>
        <div className="form-grid" style={{ marginTop: 8, alignItems: "end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Sistema</label>
            <select value={system} onChange={(e) => setSystem(e.target.value as any)}>
              <option value="WIN_LOSE">Win/Lose</option>
              <option value="PREPAGO">Prepago</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Rakeback %</label>
            <input value={rakeback} onChange={(e) => setRakeback(e.target.value)} inputMode="decimal" placeholder="ej. 30" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Rebate %</label>
            <input value={rebate} onChange={(e) => setRebate(e.target.value)} inputMode="decimal" placeholder="ej. 0" />
          </div>
          <button className="btn small" disabled={loading || !valido || !cambio} onClick={guardar}>
            {loading ? "..." : "Guardar"}
          </button>
        </div>
        {msg && <div className={msg.ok ? "success" : "error"} style={{ marginTop: 8 }}>{msg.text}</div>}
      </div>
    </div>
  );
}
