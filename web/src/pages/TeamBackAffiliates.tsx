// TeamBack Affiliates V1 (25/09/2026, pedido de Leo) -- pantalla TOTALMENTE APARTE del resto
// del sistema (nada de agentes/clubes/liquidaciones de DigiPlayers). Programa de rakeback +
// referidos directo al jugador, sobre Suprema Poker.
import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";
import Modal from "../components/Modal";

type Tab = "resumen" | "jugadores" | "import" | "config";

export default function TeamBackAffiliates() {
  const [tab, setTab] = useState<Tab>("resumen");

  return (
    <div className="page">
      <div className="topbar">
        <h2>TeamBack Affiliates</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          Programa de rakeback + referidos directo al jugador — Suprema Poker. Sección aparte, no toca nada del resto del sistema.
        </div>
      </div>

      <div className="tabs" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className={`btn small ${tab === "resumen" ? "" : "secondary"}`} onClick={() => setTab("resumen")}>Liquidaciones</button>
        <button className={`btn small ${tab === "jugadores" ? "" : "secondary"}`} onClick={() => setTab("jugadores")}>Jugadores / árbol</button>
        <button className={`btn small ${tab === "import" ? "" : "secondary"}`} onClick={() => setTab("import")}>Importar semana</button>
        <button className={`btn small ${tab === "config" ? "" : "secondary"}`} onClick={() => setTab("config")}>Configuración</button>
      </div>

      {tab === "resumen" && <LiquidacionesTab />}
      {tab === "jugadores" && <JugadoresTab />}
      {tab === "import" && <ImportTab />}
      {tab === "config" && <ConfigTab />}
    </div>
  );
}

// ===================================================================================
// Liquidaciones
// ===================================================================================

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function LiquidacionesTab() {
  const [semanas, setSemanas] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [filas, setFilas] = useState<any[]>([]);
  const [calculando, setCalculando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [individual, setIndividual] = useState<any | null>(null);

  async function cargarSemanas() {
    const r = await api.teamback.semanasDisponibles();
    setSemanas(r);
    if (r[0]) {
      setWeekStart(String(r[0].week_start).slice(0, 10));
      cargarFilas(String(r[0].week_start).slice(0, 10));
    }
  }

  async function cargarFilas(ws: string) {
    if (!ws) return;
    setFilas(await api.teamback.liquidacionesSemana(ws));
  }

  useEffect(() => {
    cargarSemanas();
  }, []);

  async function calcular() {
    if (!weekStart || !weekEnd) return setMsg({ ok: false, text: "Elegí fecha de inicio y fin de semana." });
    setCalculando(true);
    setMsg(null);
    try {
      const r = await api.teamback.calcularLiquidaciones(weekStart, weekEnd);
      setFilas(r);
      setMsg({ ok: true, text: `Calculado -- ${r.length} jugador(es) con liquidación esta semana.` });
      cargarSemanas();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo calcular." });
    } finally {
      setCalculando(false);
    }
  }

  const totalGeneral = filas.reduce((acc, f) => acc + Number(f.total_acreditado), 0);

  return (
    <div className="panel">
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Semana ya calculada</label>
          <select
            value={weekStart}
            onChange={(e) => {
              setWeekStart(e.target.value);
              cargarFilas(e.target.value);
            }}
          >
            <option value="">Elegir...</option>
            {semanas.map((s) => (
              <option key={s.week_start} value={String(s.week_start).slice(0, 10)}>
                {dateShort(s.week_start)} al {dateShort(s.week_end)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Calcular semana nueva -- inicio</label>
          <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </div>
        <div className="field">
          <label>fin</label>
          <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} max={hoyISO()} />
        </div>
        <div className="field" style={{ alignSelf: "flex-end" }}>
          <button className="btn" disabled={calculando} onClick={calcular}>
            {calculando ? "Calculando..." : "Calcular / recalcular"}
          </button>
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}

      <table>
        <thead>
          <tr>
            <th>Jugador</th>
            <th>ID Suprema</th>
            <th>Rake propio</th>
            <th>Referidos activos</th>
            <th>Escalón</th>
            <th>Rakeback</th>
            <th>Rake referidos</th>
            <th>Comisión 3%</th>
            <th>Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id}>
              <td>{f.player_name}</td>
              <td className="muted">{f.suprema_player_id}</td>
              <td>{usd(f.rake_propio)}</td>
              <td>{f.referidos_activos_count}</td>
              <td>
                {pct(f.rakeback_pct)}{" "}
                <span className="muted" style={{ fontSize: 11 }}>
                  ({f.tier_alcanzado_por === "BASE" ? "base" : f.tier_alcanzado_por === "VOLUMEN" ? "volumen" : "referidos"})
                </span>
              </td>
              <td>{usd(f.rakeback_generado)}</td>
              <td>{usd(f.rake_referidos_directos)}</td>
              <td>
                {usd(f.comision_3pct_acreditada)}
                {f.comision_3pct_pausada && (
                  <span className="badge neg" style={{ marginLeft: 6, fontSize: 10 }} title="El referente no tuvo actividad propia en la ventana de semanas configurada -- comisión pausada esta semana.">
                    pausada
                  </span>
                )}
              </td>
              <td>
                <strong>{usd(f.total_acreditado)}</strong>
              </td>
              <td>
                <button className="btn secondary small" onClick={() => setIndividual({ player_name: f.player_name, weekStart: String(f.week_start).slice(0, 10), playerId: f.player_id })}>
                  Ver liquidación
                </button>
              </td>
            </tr>
          ))}
          {filas.length === 0 && (
            <tr>
              <td colSpan={10} className="muted">
                Sin datos para esta semana todavía.
              </td>
            </tr>
          )}
        </tbody>
        {filas.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={8}>
                <strong>Total general</strong>
              </td>
              <td>
                <strong>{usd(totalGeneral)}</strong>
              </td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>

      {individual && (
        <Modal title={`Liquidación — ${individual.player_name}`} onClose={() => setIndividual(null)}>
          <LiquidacionIndividual playerId={individual.playerId} weekStart={individual.weekStart} />
        </Modal>
      )}
    </div>
  );
}

function LiquidacionIndividual({ playerId, weekStart }: { playerId: string; weekStart: string }) {
  const [data, setData] = useState<any | null>(null);
  useEffect(() => {
    api.teamback.liquidacionIndividual(playerId, weekStart).then(setData);
  }, [playerId, weekStart]);

  if (!data) return <div className="muted">Cargando...</div>;
  const l = data.liquidacion;
  const texto = [
    `Rake propio: ${usd(l.rake_propio)}`,
    `Referidos activos: ${l.referidos_activos_count}`,
    `Rakeback aplicado: ${pct(l.rakeback_pct)}`,
    `Rakeback generado: ${usd(l.rakeback_generado)}`,
    `Rake generado por referidos: ${usd(l.rake_referidos_directos)}`,
    `Comisión de afiliado 3%: ${usd(l.comision_3pct_acreditada)}${l.comision_3pct_pausada ? " (pausada esta semana)" : ""}`,
    `Total acreditado: ${usd(l.total_acreditado)}`,
  ].join("\n");

  return (
    <div>
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, lineHeight: 1.7 }}>{texto}</pre>
      <button
        className="btn secondary small"
        onClick={() => {
          navigator.clipboard?.writeText(texto);
        }}
      >
        Copiar
      </button>
    </div>
  );
}

// ===================================================================================
// Jugadores / árbol
// ===================================================================================

function JugadoresTab() {
  const [jugadores, setJugadores] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState<any | null>(null);

  async function cargar() {
    setJugadores(await api.teamback.listPlayers(true));
  }
  useEffect(() => {
    cargar();
  }, []);

  return (
    <div className="panel">
      <div className="topbar" style={{ marginBottom: 10 }}>
        <h3 style={{ margin: 0 }}>Jugadores</h3>
        <button className="btn small" onClick={() => setNuevo({})}>+ Nuevo jugador</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>ID Suprema</th>
            <th>Fecha de alta</th>
            <th>Referido por</th>
            <th># Referidos</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {jugadores.map((j) => (
            <tr key={j.id} style={j.active ? undefined : { opacity: 0.55 }}>
              <td>{j.name}</td>
              <td className="muted">{j.suprema_player_id}</td>
              <td>{dateShort(j.fecha_alta)}</td>
              <td className="muted">{j.referido_por_name ?? "—"}</td>
              <td>{j.referidos_count}</td>
              <td>{j.active ? <span className="badge pos">Activo</span> : <span className="badge neg">Inactivo</span>}</td>
              <td>
                <button className="btn secondary small" onClick={() => setNuevo(j)}>
                  Editar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {nuevo && (
        <Modal title={nuevo.id ? `Editar — ${nuevo.name}` : "Nuevo jugador"} onClose={() => setNuevo(null)}>
          <FormJugador jugador={nuevo} jugadores={jugadores} onSaved={() => { setNuevo(null); cargar(); }} />
        </Modal>
      )}
    </div>
  );
}

function FormJugador({ jugador, jugadores, onSaved }: { jugador: any; jugadores: any[]; onSaved: () => void }) {
  const [supremaPlayerId, setSupremaPlayerId] = useState(jugador.suprema_player_id ?? "");
  const [name, setName] = useState(jugador.name ?? "");
  const [fechaAlta, setFechaAlta] = useState(jugador.fecha_alta ? String(jugador.fecha_alta).slice(0, 10) : hoyISO());
  const [referidoPorId, setReferidoPorId] = useState(jugador.referido_por_id ?? "");
  const [active, setActive] = useState(jugador.active ?? true);
  const [notes, setNotes] = useState(jugador.notes ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!supremaPlayerId.trim() || !name.trim()) return setMsg({ ok: false, text: "ID de Suprema y nombre son obligatorios." });
    setLoading(true);
    try {
      const data = { supremaPlayerId: supremaPlayerId.trim(), name: name.trim(), fechaAlta, referidoPorId: referidoPorId || null, notes: notes.trim() || null };
      if (jugador.id) await api.teamback.actualizarPlayer(jugador.id, { ...data, active });
      else await api.teamback.crearPlayer(data);
      onSaved();
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
          <label>ID / nickname de Suprema</label>
          <input value={supremaPlayerId} onChange={(e) => setSupremaPlayerId(e.target.value)} />
        </div>
        <div className="field">
          <label>Nombre</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label>Fecha de alta</label>
          <input type="date" value={fechaAlta} onChange={(e) => setFechaAlta(e.target.value)} />
        </div>
        <div className="field">
          <label>Referido por (opcional)</label>
          <select value={referidoPorId} onChange={(e) => setReferidoPorId(e.target.value)}>
            <option value="">Nadie (llegó directo)</option>
            {jugadores.filter((j) => j.id !== jugador.id).map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} ({j.suprema_player_id})
              </option>
            ))}
          </select>
        </div>
        {jugador.id && (
          <div className="field">
            <label>Estado</label>
            <select value={active ? "1" : "0"} onChange={(e) => setActive(e.target.value === "1")}>
              <option value="1">Activo</option>
              <option value="0">Inactivo</option>
            </select>
          </div>
        )}
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Notas (opcional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>
        {loading ? "Guardando..." : "Guardar"}
      </button>
    </form>
  );
}

// ===================================================================================
// Import semanal
// ===================================================================================

function ImportTab() {
  const [file, setFile] = useState<File | null>(null);
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [preview, setPreview] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function analizar() {
    if (!file) return setMsg({ ok: false, text: "Elegí un archivo." });
    setLoading(true);
    setMsg(null);
    try {
      setPreview(await api.teamback.previsualizarImport(file));
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo leer el archivo." });
    } finally {
      setLoading(false);
    }
  }

  async function aplicar() {
    if (!preview || !weekStart || !weekEnd) return setMsg({ ok: false, text: "Elegí fecha de inicio y fin de semana." });
    setLoading(true);
    setMsg(null);
    try {
      const rows = preview.conocidos.map((c: any) => ({ supremaPlayerId: c.player.suprema_player_id, supremaPlayerName: c.player.name, rake: c.rake }));
      const r = await api.teamback.aplicarImport({ weekStart, weekEnd, rows, importSource: file?.name });
      setMsg({ ok: true, text: `Importado -- ${r.importados} jugador(es) cargado(s).` });
      setPreview(null);
      setFile(null);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo importar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Archivo de Suprema (.xlsx)</label>
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="field" style={{ alignSelf: "flex-end" }}>
          <button className="btn secondary" disabled={loading} onClick={analizar}>
            {loading ? "Leyendo..." : "Analizar archivo"}
          </button>
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}

      {preview && (
        <>
          <div className="form-grid" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>Inicio de semana</label>
              <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
            </div>
            <div className="field">
              <label>Fin de semana</label>
              <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} max={hoyISO()} />
            </div>
            <div className="field" style={{ alignSelf: "flex-end" }}>
              <button className="btn" disabled={loading || preview.conocidos.length === 0} onClick={aplicar}>
                Importar {preview.conocidos.length} jugador(es) conocido(s)
              </button>
            </div>
          </div>

          {preview.desconocidos.length > 0 && (
            <div className="error" style={{ marginBottom: 12 }}>
              {preview.desconocidos.length} jugador(es) del archivo NO están dados de alta todavía (no se van a importar) -- dalos de alta en "Jugadores / árbol" primero, con el mismo ID de Suprema, y volvé a analizar el archivo:
              <ul>
                {preview.desconocidos.map((d: any) => (
                  <li key={d.supremaPlayerId}>
                    {d.supremaPlayerName} ({d.supremaPlayerId}) -- {usd(d.rake)} de rake
                  </li>
                ))}
              </ul>
            </div>
          )}

          <table>
            <thead>
              <tr>
                <th>Jugador</th>
                <th>ID Suprema</th>
                <th>Rake esta semana</th>
              </tr>
            </thead>
            <tbody>
              {preview.conocidos.map((c: any) => (
                <tr key={c.player.id}>
                  <td>{c.player.name}</td>
                  <td className="muted">{c.player.suprema_player_id}</td>
                  <td>{usd(c.rake)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ===================================================================================
// Configuración
// ===================================================================================

function ConfigTab() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.teamback.getConfig().then(setCfg);
  }, []);

  if (!cfg) return <div className="panel muted">Cargando...</div>;

  function num(key: string) {
    return {
      value: cfg[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCfg((c: any) => ({ ...c, [key]: Number(e.target.value) })),
    };
  }

  async function guardar() {
    setLoading(true);
    setMsg(null);
    try {
      setCfg(await api.teamback.updateConfig(cfg));
      setMsg({ ok: true, text: "Configuración guardada." });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <div className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
        Los porcentajes van de 0 a 1 (ej. 0.60 = 60%). Cambiar esto NO recalcula liquidaciones ya guardadas -- cada una queda con el % vigente al momento en que se calculó.
      </div>
      <div className="form-grid">
        <div className="field">
          <label>% Rakeback base</label>
          <input type="number" step="0.01" {...num("pctBase")} />
        </div>
        <div className="field">
          <label>% Rakeback escalón 2</label>
          <input type="number" step="0.01" {...num("pctTier2")} />
        </div>
        <div className="field">
          <label>% Rakeback escalón 3</label>
          <input type="number" step="0.01" {...num("pctTier3")} />
        </div>
        <div className="field">
          <label>Volumen propio para escalón 2 (USD/semana)</label>
          <input type="number" step="1" {...num("umbralVolumenTier2Usd")} />
        </div>
        <div className="field">
          <label>Volumen propio para escalón 3 (USD/semana)</label>
          <input type="number" step="1" {...num("umbralVolumenTier3Usd")} />
        </div>
        <div className="field">
          <label># Referidos activos para escalón 2</label>
          <input type="number" step="1" {...num("umbralReferidosTier2")} />
        </div>
        <div className="field">
          <label># Referidos activos para escalón 3</label>
          <input type="number" step="1" {...num("umbralReferidosTier3")} />
        </div>
        <div className="field">
          <label>Mínimo de rake para que un referido cuente como "activo" (USD/semana)</label>
          <input type="number" step="1" {...num("umbralReferidoActivoUsd")} />
        </div>
        <div className="field">
          <label>% Comisión de afiliado (sobre rake de referidos directos)</label>
          <input type="number" step="0.01" {...num("pctComisionReferido")} />
        </div>
        <div className="field">
          <label>Ventana de actividad para mantener la comisión (semanas)</label>
          <input type="number" step="1" {...num("ventanaActividadSemanas")} />
        </div>
        <div className="field">
          <label>¿El mínimo de USD también aplica a la comisión del 3%?</label>
          <select value={cfg.aplicarUmbralAComision ? "1" : "0"} onChange={(e) => setCfg((c: any) => ({ ...c, aplicarUmbralAComision: e.target.value === "1" }))}>
            <option value="0">No -- la comisión se paga sobre lo que rakee cada referido, sin piso (default)</option>
            <option value="1">Sí -- un referido por debajo del mínimo no genera comisión esa semana</option>
          </select>
        </div>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading} onClick={guardar}>
        {loading ? "Guardando..." : "Guardar configuración"}
      </button>
    </div>
  );
}
