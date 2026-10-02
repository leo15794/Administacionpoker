import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// "Bancado — Contratos" (pedido Leo 02/10/2026): sistema nuevo e independiente, con la regla de
// cálculo elegida 100% explícita por contrato, nunca un default (ver repo/bancadoContratos.ts).
// No tiene relación con "Jugadores bancados" (api.bancados) ni con agentes account_type=BANCADO
// -- esos quedan intactos, este módulo es aparte.
export default function BancadoContratos() {
  const [contratos, setContratos] = useState<any[] | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  function refresh() {
    setError("");
    api.bancadoContratos.listar().then(setContratos).catch((e) => setError(e.message));
  }
  useEffect(() => { refresh(); }, []);

  const contrato = contratos?.find((c) => c.id === seleccionado) ?? null;

  return (
    <div>
      <div className="topbar">
        <div className="muted">
          Cada contrato elige, de la lista de jugadores/agentes que ya existen en el sistema, su regla de cálculo de
          forma explícita (RMF o REGLA_BANCADO_V1) -- no hay una regla por default.
        </div>
        <button className="btn secondary small" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cerrar" : "+ Nuevo contrato"}</button>
      </div>

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

      {showForm && (
        <div className="panel" style={{ marginTop: 16, maxWidth: 560 }}>
          <NuevoContratoForm
            onCreated={() => { setShowForm(false); refresh(); }}
          />
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        {!contratos ? (
          <div className="muted">Cargando...</div>
        ) : contratos.length === 0 ? (
          <div className="muted">Todavía no hay ningún contrato de bancado creado.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Regla</th>
                <th>Club</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contratos.map((c) => (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setSeleccionado(c.id)}>
                  <td><strong>{c.nombre}</strong></td>
                  <td className="muted">{c.tipo_vinculo === "AGENT" ? "Agente" : "Jugador"}</td>
                  <td><span className="badge neutral">{c.regla_key}</span></td>
                  <td className="muted">{c.club_id ?? "—"}</td>
                  <td className="muted">{c.activo ? "Activo" : "Inactivo"}</td>
                  <td>
                    <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); setSeleccionado(c.id); }}>
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {contrato && (
        <div style={{ marginTop: 20 }}>
          {contrato.regla_key === "RMF" ? (
            <ContratoRmf contrato={contrato} onChanged={refresh} />
          ) : (
            <ContratoV1 contrato={contrato} />
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Alta de contrato
// ------------------------------------------------------------------------------------------
function NuevoContratoForm({ onCreated }: { onCreated: () => void }) {
  const [candidatos, setCandidatos] = useState<any[] | null>(null);
  const [seleccion, setSeleccion] = useState(""); // "PLAYER:<id>" o "AGENT:<id>"
  const [reglaKey, setReglaKey] = useState<"RMF" | "REGLA_BANCADO_V1" | "">("");
  useEffect(() => { api.bancadoContratos.candidatos().then(setCandidatos).catch(() => setCandidatos([])); }, []);
  const [rmfPctJugador, setRmfPctJugador] = useState("50");
  const [rmfPctBanca, setRmfPctBanca] = useState("50");
  const [rmfRakebackPct, setRmfRakebackPct] = useState("0");
  const [rmfRakebackBancaPct, setRmfRakebackBancaPct] = useState("0");
  const [rmfUnionSharePct, setRmfUnionSharePct] = useState("80");
  const [rmfCapitalInicial, setRmfCapitalInicial] = useState("0");
  const [rmfMakeupInicial, setRmfMakeupInicial] = useState("0");
  const [v1RakeDealPct, setV1RakeDealPct] = useState("60");
  const [v1RakeTeambackDirectoPct, setV1RakeTeambackDirectoPct] = useState("20");
  const [v1SplitJugadorPct, setV1SplitJugadorPct] = useState("50");
  const [v1SplitTeambackPct, setV1SplitTeambackPct] = useState("50");
  const [v1ModoMemoriaDefault, setV1ModoMemoriaDefault] = useState<"AUTOMATICO" | "PARCIAL_MANUAL">("AUTOMATICO");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    if (!seleccion) return setMsg({ ok: false, text: "Elegí a qué jugador o agente de la lista corresponde este contrato." });
    if (!reglaKey) return setMsg({ ok: false, text: "Elegí explícitamente la regla -- no hay una por default." });
    const [tipo, id] = seleccion.split(":");
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.crear({
        playerId: tipo === "PLAYER" ? id : undefined,
        agentId: tipo === "AGENT" ? id : undefined,
        reglaKey,
        observaciones: observaciones.trim() || undefined,
        rmfPctJugador: reglaKey === "RMF" ? Number(rmfPctJugador) / 100 : undefined,
        rmfPctBanca: reglaKey === "RMF" ? Number(rmfPctBanca) / 100 : undefined,
        rmfRakebackPct: reglaKey === "RMF" ? Number(rmfRakebackPct) / 100 : undefined,
        rmfRakebackBancaPct: reglaKey === "RMF" ? Number(rmfRakebackBancaPct) / 100 : undefined,
        rmfUnionSharePct: reglaKey === "RMF" ? Number(rmfUnionSharePct) / 100 : undefined,
        rmfCapitalInicial: reglaKey === "RMF" ? Number(rmfCapitalInicial) : undefined,
        rmfMakeupInicial: reglaKey === "RMF" ? Number(rmfMakeupInicial) : undefined,
        v1RakeDealPct: reglaKey === "REGLA_BANCADO_V1" ? Number(v1RakeDealPct) / 100 : undefined,
        v1RakeTeambackDirectoPct: reglaKey === "REGLA_BANCADO_V1" ? Number(v1RakeTeambackDirectoPct) / 100 : undefined,
        v1SplitJugadorPct: reglaKey === "REGLA_BANCADO_V1" ? Number(v1SplitJugadorPct) / 100 : undefined,
        v1SplitTeambackPct: reglaKey === "REGLA_BANCADO_V1" ? Number(v1SplitTeambackPct) / 100 : undefined,
        v1ModoMemoriaDefault: reglaKey === "REGLA_BANCADO_V1" ? v1ModoMemoriaDefault : undefined,
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo crear el contrato." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="field">
        <label>Jugador o agente (de los que ya existen en el sistema)</label>
        <select value={seleccion} onChange={(e) => setSeleccion(e.target.value)}>
          <option value="">-- elegir --</option>
          {candidatos === null && <option disabled>Cargando...</option>}
          {candidatos?.map((c) => (
            <option key={`${c.tipo}:${c.id}`} value={`${c.tipo}:${c.id}`}>
              [{c.tipo === "AGENT" ? "Agente" : "Jugador"}] {c.nombre}{c.club_name ? ` -- ${c.club_name}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Regla (obligatorio elegir una)</label>
        <select value={reglaKey} onChange={(e) => setReglaKey(e.target.value as any)}>
          <option value="">-- elegir --</option>
          <option value="RMF">RMF (la fórmula vieja: reparto 50/50 de mesa + rakeback + memoria)</option>
          <option value="REGLA_BANCADO_V1">REGLA_BANCADO_V1 (parciales semanales + cierre mensual + memoria con dos modos)</option>
        </select>
      </div>

      {reglaKey === "RMF" && (
        <>
          <div className="form-grid">
            <div className="field">
              <label>% Jugador</label>
              <input type="number" step="0.01" value={rmfPctJugador} onChange={(e) => setRmfPctJugador(e.target.value)} />
            </div>
            <div className="field">
              <label>% Banca</label>
              <input type="number" step="0.01" value={rmfPctBanca} onChange={(e) => setRmfPctBanca(e.target.value)} />
            </div>
            <div className="field">
              <label>Rakeback Jugador (%)</label>
              <input type="number" step="0.01" value={rmfRakebackPct} onChange={(e) => setRmfRakebackPct(e.target.value)} />
            </div>
            <div className="field">
              <label title="% independiente sobre el rake total que vuelve a la banca en vez de al jugador -- no tiene que sumar 100% con el rakeback del jugador.">Rakeback Banca (%)</label>
              <input type="number" step="0.01" value={rmfRakebackBancaPct} onChange={(e) => setRmfRakebackBancaPct(e.target.value)} />
            </div>
            <div className="field">
              <label title="% que la Unión (o quien corresponda) le reconoce a la banca sobre el rake total -- solo informativo, no genera ningún movimiento de Wallet/Tesorería.">% Unión sobre rake total (informativo)</label>
              <input type="number" step="0.01" value={rmfUnionSharePct} onChange={(e) => setRmfUnionSharePct(e.target.value)} />
            </div>
            <div className="field">
              <label>Capital inicial (USD)</label>
              <input type="number" step="0.01" value={rmfCapitalInicial} onChange={(e) => setRmfCapitalInicial(e.target.value)} />
            </div>
            <div className="field">
              <label>Makeup inicial (USD)</label>
              <input type="number" step="0.01" value={rmfMakeupInicial} onChange={(e) => setRmfMakeupInicial(e.target.value)} />
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Mismo motor de cálculo (capital/makeup) que "Jugadores bancados" clásico -- es la misma fórmula, aplicada a este contrato.
          </div>
        </>
      )}

      {reglaKey === "REGLA_BANCADO_V1" && (
        <>
          <div className="form-grid">
            <div className="field">
              <label>% rake para el deal</label>
              <input type="number" value={v1RakeDealPct} onChange={(e) => setV1RakeDealPct(e.target.value)} />
            </div>
            <div className="field">
              <label>% rake directo TeamBack</label>
              <input type="number" value={v1RakeTeambackDirectoPct} onChange={(e) => setV1RakeTeambackDirectoPct(e.target.value)} />
            </div>
            <div className="field">
              <label>% split jugador</label>
              <input type="number" value={v1SplitJugadorPct} onChange={(e) => setV1SplitJugadorPct(e.target.value)} />
            </div>
            <div className="field">
              <label>% split TeamBack</label>
              <input type="number" value={v1SplitTeambackPct} onChange={(e) => setV1SplitTeambackPct(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Modo de recuperación de memoria (default)</label>
            <select value={v1ModoMemoriaDefault} onChange={(e) => setV1ModoMemoriaDefault(e.target.value as any)}>
              <option value="AUTOMATICO">Automático (recupera el máximo posible siempre)</option>
              <option value="PARCIAL_MANUAL">Parcial manual (TeamBack decide cuánto aplicar)</option>
            </select>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            La memoria inicial del primer período (ej. los USD 344,75 de Matías migrados del acuerdo anterior) se carga
            al abrir el primer período del contrato, no acá.
          </div>
        </>
      )}

      <div className="field">
        <label>Observaciones (opcional)</label>
        <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Crear contrato"}</button>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Regla RMF -- mismo motor de capital/makeup que "Jugadores bancados" clásico
// (engine/bancados.ts), aplicado a este contrato. Nunca se guarda un capital/makeup "actual"
// mutable -- se deriva siempre del último cierre APLICADO (repo/bancadoContratos.ts).
// ------------------------------------------------------------------------------------------
function ContratoRmf({ contrato, onChanged }: { contrato: any; onChanged: () => void }) {
  const { promptDialog, alertDialog } = useConfirmDialog();
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [resultadoMesas, setResultadoMesas] = useState("0");
  const [rakeBruto, setRakeBruto] = useState("0");
  const [ticketPromocional, setTicketPromocional] = useState("0");
  const [ticketPromocionalNota, setTicketPromocionalNota] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function refresh() {
    api.bancadoContratos.historialRmf(contrato.id).then(setHistorial).catch(() => {});
  }
  useEffect(() => { refresh(); }, [contrato.id]);

  const ultimoAplicado = historial?.find((h) => h.status !== "REVERTIDO") ?? null;
  const capitalActual = ultimoAplicado ? Number(ultimoAplicado.capital_despues) : Number(contrato.rmf_capital_inicial ?? 0);
  const makeupActual = ultimoAplicado ? Number(ultimoAplicado.makeup_nuevo) : Number(contrato.rmf_makeup_inicial ?? 0);

  async function cerrarSemana() {
    if (!desde || !hasta) return setMsg({ ok: false, text: "Faltan las fechas." });
    if ((Number(ticketPromocional) || 0) !== 0 && !ticketPromocionalNota.trim()) {
      return setMsg({ ok: false, text: "Si hay ticket promocional hay que anotar por qué." });
    }
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.cierreRmf(contrato.id, {
        desde,
        hasta,
        resultadoMesas: Number(resultadoMesas) || 0,
        rakeBruto: Number(rakeBruto) || 0,
        ticketPromocional: Number(ticketPromocional) || undefined,
        ticketPromocionalNota: ticketPromocionalNota.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
      });
      setDesde(""); setHasta(""); setResultadoMesas("0"); setRakeBruto("0"); setTicketPromocional("0"); setTicketPromocionalNota(""); setObservaciones("");
      refresh();
      onChanged();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cerrar la semana." });
    } finally {
      setGuardando(false);
    }
  }

  async function revertir(h: any) {
    const motivo = await promptDialog("¿Por qué se revierte este cierre RMF? (queda en el historial, no se borra nada)");
    if (motivo === null) return;
    try {
      await api.bancadoContratos.revertirCierreRmf(h.id, motivo || undefined);
      refresh();
      onChanged();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo revertir.");
    }
  }

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="muted">Capital actual</div>
          <div className="value">{usd(capitalActual)}</div>
        </div>
        <div className="kpi-card">
          <div className="muted">Makeup actual</div>
          <div className="value">{usd(makeupActual)}</div>
        </div>
        <div className="kpi-card">
          <div className="muted">% Jugador / % Banca</div>
          <div className="value">{(Number(contrato.rmf_pct_jugador) * 100).toFixed(0)}% / {(Number(contrato.rmf_pct_banca) * 100).toFixed(0)}%</div>
        </div>
        <div className="kpi-card">
          <div className="muted">Rakeback jugador / banca</div>
          <div className="value">{(Number(contrato.rmf_rakeback_pct) * 100).toFixed(0)}% / {(Number(contrato.rmf_rakeback_banca_pct ?? 0) * 100).toFixed(0)}%</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16, maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Cerrar semana (RMF)</h3>
        <div className="form-grid">
          <div className="field"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="field"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        </div>
        <div className="form-grid">
          <div className="field"><label>Resultado de mesas</label><input type="number" step="0.01" value={resultadoMesas} onChange={(e) => setResultadoMesas(e.target.value)} /></div>
          <div className="field"><label>Rake total</label><input type="number" step="0.01" value={rakeBruto} onChange={(e) => setRakeBruto(e.target.value)} /></div>
        </div>
        <div className="field"><label>Ticket promocional (a nuestro cargo)</label><input type="number" step="0.01" value={ticketPromocional} onChange={(e) => setTicketPromocional(e.target.value)} /></div>
        {(Number(ticketPromocional) || 0) !== 0 && (
          <div className="field"><label>Motivo del ticket promocional</label><input value={ticketPromocionalNota} onChange={(e) => setTicketPromocionalNota(e.target.value)} placeholder="Ej: ticket promocional torneo X" /></div>
        )}
        <div className="field"><label>Observaciones</label><input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={guardando} onClick={cerrarSemana}>{guardando ? "Cerrando..." : "Cerrar semana"}</button>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Historial</h3>
        {!historial ? <div className="muted">Cargando...</div> : historial.length === 0 ? <div className="muted">Todavía no hay cierres.</div> : (
          <table>
            <thead>
              <tr>
                <th>Semana</th>
                <th className="num">Mesa</th>
                <th className="num">Rake</th>
                <th className="num">Rakeback</th>
                <th className="num">Pago jugador</th>
                <th className="num">Ganancia banca</th>
                <th className="num">Makeup antes</th>
                <th className="num">Makeup después</th>
                <th className="num">Capital antes</th>
                <th className="num">Capital después</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id} style={h.status === "REVERTIDO" ? { opacity: 0.5 } : undefined}>
                  <td className="muted">{dateShort(h.desde)} - {dateShort(h.hasta)}</td>
                  <td className="num">{usd(h.resultado_mesas)}</td>
                  <td className="num">{usd(h.rake_total)}</td>
                  <td className="num muted">{usd(h.rakeback_total)}</td>
                  <td className="num money">{usd(h.pago_jugador_total)}</td>
                  <td className="num money">{usd(h.ganancia_banca_mesas)}</td>
                  <td className="num muted">{usd(h.makeup_anterior)}</td>
                  <td className="num muted">{usd(h.makeup_nuevo)}</td>
                  <td className="num muted">{usd(h.capital_anterior)}</td>
                  <td className="num muted">{usd(h.capital_despues)}</td>
                  <td className="muted">{h.status === "REVERTIDO" ? "Revertido" : "Aplicado"}</td>
                  <td>
                    {h.status !== "REVERTIDO" && (
                      <button className="btn secondary small" onClick={() => revertir(h)}>Revertir</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Regla REGLA_BANCADO_V1 -- períodos mensuales
// ------------------------------------------------------------------------------------------
function ContratoV1({ contrato }: { contrato: any }) {
  const [periodos, setPeriodos] = useState<any[] | null>(null);
  const [periodoId, setPeriodoId] = useState<string | null>(null);
  const [showAbrir, setShowAbrir] = useState(false);

  function refresh() {
    api.bancadoContratos.periodos(contrato.id).then((rows) => {
      setPeriodos(rows);
      if (!periodoId && rows.length > 0) setPeriodoId(rows[0].id);
    }).catch(() => {});
  }
  useEffect(() => { setPeriodoId(null); refresh(); }, [contrato.id]);

  return (
    <div>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Períodos de {contrato.nombre}</h3>
        <button className="btn secondary small" onClick={() => setShowAbrir((v) => !v)}>{showAbrir ? "Cerrar" : "+ Abrir período"}</button>
      </div>

      {showAbrir && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 480 }}>
          <AbrirPeriodoForm
            contrato={contrato}
            hayPeriodosPrevios={(periodos?.length ?? 0) > 0}
            onCreated={() => { setShowAbrir(false); refresh(); }}
          />
        </div>
      )}

      <div className="panel" style={{ marginTop: 12 }}>
        {!periodos ? <div className="muted">Cargando...</div> : periodos.length === 0 ? (
          <div className="muted">Todavía no hay ningún período abierto para este contrato.</div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {periodos.map((p) => (
              <button
                key={p.id}
                className={`btn secondary small ${p.id === periodoId ? "active" : ""}`}
                style={p.id === periodoId ? { filter: "brightness(1.15)" } : undefined}
                onClick={() => setPeriodoId(p.id)}
              >
                {MESES[p.mes - 1]} {p.anio} {p.estado === "CERRADO" ? "(cerrado)" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {periodoId && <PeriodoPanel contrato={contrato} periodoId={periodoId} onPeriodoCambiado={refresh} />}
    </div>
  );
}

function AbrirPeriodoForm({ contrato, hayPeriodosPrevios, onCreated }: { contrato: any; hayPeriodosPrevios: boolean; onCreated: () => void }) {
  const hoy = new Date();
  const [anio, setAnio] = useState(String(hoy.getFullYear()));
  const [mes, setMes] = useState(String(hoy.getMonth() + 1));
  const [memoriaInicial, setMemoriaInicial] = useState("");
  const [modoMemoria, setModoMemoria] = useState<"AUTOMATICO" | "PARCIAL_MANUAL">(contrato.v1_modo_memoria_default ?? "AUTOMATICO");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    if (!hayPeriodosPrevios && !memoriaInicial.trim()) {
      return setMsg({ ok: false, text: "Es el primer período de este contrato -- hay que indicar la memoria inicial a mano (ej. la migrada del acuerdo anterior)." });
    }
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.abrirPeriodo(contrato.id, {
        anio: Number(anio),
        mes: Number(mes),
        memoriaInicial: memoriaInicial.trim() ? Number(memoriaInicial) : undefined,
        modoMemoria,
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo abrir el período." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field"><label>Año</label><input type="number" value={anio} onChange={(e) => setAnio(e.target.value)} /></div>
        <div className="field">
          <label>Mes</label>
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Memoria inicial (USD) {hayPeriodosPrevios && <span className="muted">-- opcional, si no se indica hereda la memoria final del período anterior cerrado</span>}</label>
        <input type="number" value={memoriaInicial} onChange={(e) => setMemoriaInicial(e.target.value)} placeholder={hayPeriodosPrevios ? "heredar del período anterior" : "obligatorio: primer período"} />
      </div>
      <div className="field">
        <label>Modo de recuperación de memoria de este período</label>
        <select value={modoMemoria} onChange={(e) => setModoMemoria(e.target.value as any)}>
          <option value="AUTOMATICO">Automático</option>
          <option value="PARCIAL_MANUAL">Parcial manual</option>
        </select>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Abriendo..." : "Abrir período"}</button>
    </div>
  );
}

function PeriodoPanel({ contrato, periodoId, onPeriodoCambiado }: { contrato: any; periodoId: string; onPeriodoCambiado: () => void }) {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [estado, setEstado] = useState<any | null>(null);
  const [parciales, setParciales] = useState<any[] | null>(null);
  const [liquidaciones, setLiquidaciones] = useState<any[] | null>(null);
  const [ajustes, setAjustes] = useState<any[] | null>(null);
  const [showParcial, setShowParcial] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [showCerrar, setShowCerrar] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);

  function refresh() {
    api.bancadoContratos.estadoPeriodo(periodoId).then(setEstado).catch(() => {});
    api.bancadoContratos.parciales(periodoId).then(setParciales).catch(() => {});
    api.bancadoContratos.liquidaciones(contrato.id, periodoId).then(setLiquidaciones).catch(() => {});
    api.bancadoContratos.ajustes(contrato.id).then(setAjustes).catch(() => {});
  }
  useEffect(() => { refresh(); }, [periodoId]);

  async function reabrir() {
    const motivo = window.prompt("Motivo de la reapertura (queda auditado):");
    if (!motivo) return;
    setReabriendo(true);
    try {
      await api.bancadoContratos.reabrirPeriodo(periodoId, motivo);
      refresh();
      onPeriodoCambiado();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo reabrir.");
    } finally {
      setReabriendo(false);
    }
  }

  if (!estado) return <div className="panel" style={{ marginTop: 16 }}><div className="muted">Cargando...</div></div>;
  const { periodo } = estado;
  const cerrado = periodo.estado === "CERRADO";

  return (
    <div style={{ marginTop: 16 }}>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="muted">Memoria inicial</div><div className="value">{usd(periodo.memoria_inicial)}</div></div>
        <div className="kpi-card"><div className="muted">{cerrado ? "Memoria final" : "Memoria proyectada"}</div><div className="value">{usd(cerrado ? periodo.memoria_final : estado.memoriaProyectada)}</div></div>
        <div className="kpi-card"><div className="muted">Resultado deal acumulado</div><div className="value">{usd(estado.acumulados.resultadoDealAcumulado)}</div></div>
        <div className="kpi-card"><div className="muted">{cerrado ? "Split jugador" : "Split jugador proyectado"}</div><div className="value">{usd(estado.splitJugadorProyectado)}</div></div>
        <div className="kpi-card"><div className="muted">Ganancia TeamBack (rake directo acum.)</div><div className="value">{usd(estado.gananciaTeambackAcumuladaRake)}</div></div>
        <div className="kpi-card"><div className="muted">Ganancia TeamBack proyectada total</div><div className="value">{usd(estado.gananciaTeambackProyectada)}</div></div>
      </div>

      {cerrado ? (
        <div className="muted" style={{ marginTop: 10 }}>
          Período CERRADO el {dateShort(periodo.cerrado_en)} por {periodo.cerrado_por}.
          {" "}
          <button className="btn secondary small" disabled={reabriendo} onClick={reabrir}>{reabriendo ? "..." : "Reabrir (auditado)"}</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn secondary small" onClick={() => setShowParcial((v) => !v)}>{showParcial ? "Cerrar" : "+ Cargar parcial semanal"}</button>
          <button className="btn secondary small" onClick={() => setShowExtra((v) => !v)}>{showExtra ? "Cerrar" : "Split extraordinario"}</button>
          <button className="btn small" onClick={() => setShowCerrar((v) => !v)}>{showCerrar ? "Cerrar" : "Cerrar mes"}</button>
        </div>
      )}

      {showParcial && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 480 }}>
          <ParcialForm periodoId={periodoId} onCreated={() => { setShowParcial(false); refresh(); }} />
        </div>
      )}
      {showExtra && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 480 }}>
          <ExtraordinarioForm
            periodoId={periodoId}
            pendienteSugerido={Math.max(0, estado.pendiente)}
            memoriaActual={Number(periodo.memoria_actual)}
            onCreated={() => { setShowExtra(false); refresh(); onPeriodoCambiado(); }}
          />
        </div>
      )}
      {showCerrar && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 520 }}>
          <CerrarMesForm
            periodoId={periodoId}
            modoMemoriaPeriodo={periodo.modo_memoria}
            proyeccion={estado}
            confirmDialog={confirmDialog}
            onCerrado={() => { setShowCerrar(false); refresh(); onPeriodoCambiado(); }}
          />
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Parciales semanales</h3>
        {!parciales ? <div className="muted">Cargando...</div> : parciales.length === 0 ? <div className="muted">Sin parciales todavía.</div> : (
          <table>
            <thead><tr><th>Semana</th><th className="num">Mesa</th><th className="num">Rake</th><th className="num">Deal</th><th className="num">TeamBack</th></tr></thead>
            <tbody>
              {parciales.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{dateShort(p.desde)} - {dateShort(p.hasta)}</td>
                  <td className="num">{usd(p.resultado_mesas)}</td>
                  <td className="num">{usd(p.rake_bruto)}</td>
                  <td className="num"><strong className={Number(p.resultado_deal_semana) >= 0 ? "pos" : "neg"}>{usd(p.resultado_deal_semana)}</strong></td>
                  <td className="num muted">{usd(p.rake_teamback_semana)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Liquidaciones de este período</h3>
        {!liquidaciones ? <div className="muted">Cargando...</div> : liquidaciones.length === 0 ? <div className="muted">Ninguna todavía.</div> : (
          <table>
            <thead><tr><th>Tipo</th><th className="num">Memoria antes</th><th className="num">Aplicada</th><th className="num">Memoria después</th><th className="num">Split jugador</th><th className="num">Split TeamBack</th><th>Fecha</th></tr></thead>
            <tbody>
              {liquidaciones.map((l) => (
                <tr key={l.id}>
                  <td><span className="badge neutral">{l.tipo}</span></td>
                  <td className="num muted">{usd(l.memoria_anterior)}</td>
                  <td className="num muted">{usd(l.memoria_aplicada)}</td>
                  <td className="num muted">{usd(l.memoria_final)}</td>
                  <td className="num money">{usd(l.split_jugador)}</td>
                  <td className="num">{usd(l.split_teamback)}</td>
                  <td className="muted">{dateShort(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Ajustes y créditos pendientes</h3>
        {!ajustes ? <div className="muted">Cargando...</div> : ajustes.length === 0 ? <div className="muted">Sin ajustes.</div> : (
          <table>
            <thead><tr><th>Tipo</th><th className="num">Importe</th><th>Estado</th><th>Motivo</th><th></th></tr></thead>
            <tbody>
              {ajustes.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{a.tipo}</td>
                  <td className="num"><strong className={a.signo === "POSITIVO" ? "pos" : "neg"}>{usd(a.importe)}</strong></td>
                  <td><span className={`badge ${a.estado === "PENDIENTE" ? "neutral" : a.estado === "APLICADO" ? "pos" : "neg"}`}>{a.estado}</span></td>
                  <td className="muted">{a.motivo}</td>
                  <td>
                    {a.estado === "PENDIENTE" && (
                      <button className="btn secondary small" onClick={async () => {
                        await api.bancadoContratos.resolverAjuste(a.id, "APLICADO");
                        refresh();
                      }}>Marcar pagado</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ParcialForm({ periodoId, onCreated }: { periodoId: string; onCreated: () => void }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [resultadoMesas, setResultadoMesas] = useState("");
  const [rakeBruto, setRakeBruto] = useState("");
  const [ajuste, setAjuste] = useState("0");
  const [ajusteNota, setAjusteNota] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    if (!desde || !hasta) return setMsg({ ok: false, text: "Faltan las fechas." });
    if (Number(ajuste) !== 0 && !ajusteNota.trim()) return setMsg({ ok: false, text: "Un ajuste distinto de 0 necesita una nota." });
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.registrarParcial(periodoId, {
        desde,
        hasta,
        resultadoMesas: Number(resultadoMesas),
        rakeBruto: Number(rakeBruto),
        ajuste: Number(ajuste) || 0,
        ajusteNota: ajusteNota.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el parcial." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="field"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Resultado de mesas</label><input type="number" value={resultadoMesas} onChange={(e) => setResultadoMesas(e.target.value)} /></div>
        <div className="field"><label>Rake bruto</label><input type="number" value={rakeBruto} onChange={(e) => setRakeBruto(e.target.value)} /></div>
      </div>
      <div className="field"><label>Ajuste (opcional, se suma al resultado deal)</label><input type="number" value={ajuste} onChange={(e) => setAjuste(e.target.value)} /></div>
      {Number(ajuste) !== 0 && (
        <div className="field"><label>Nota del ajuste (obligatoria)</label><input value={ajusteNota} onChange={(e) => setAjusteNota(e.target.value)} /></div>
      )}
      <div className="field"><label>Observaciones</label><input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Cargar parcial"}</button>
    </div>
  );
}

function ExtraordinarioForm({
  periodoId, pendienteSugerido, memoriaActual, onCreated,
}: { periodoId: string; pendienteSugerido: number; memoriaActual: number; onCreated: () => void }) {
  const [gananciaDisponible, setGananciaDisponible] = useState(String(pendienteSugerido.toFixed(2)));
  const [memoriaAplicada, setMemoriaAplicada] = useState("0");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    if (!motivo.trim()) return setMsg({ ok: false, text: "El split extraordinario necesita un motivo (autorización explícita, sección 17)." });
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.splitExtraordinario(periodoId, {
        gananciaDisponible: Number(gananciaDisponible),
        memoriaAplicada: Number(memoriaAplicada),
        motivo: motivo.trim(),
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo autorizar el split extraordinario." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
        Memoria actual: {usd(memoriaActual)}. Sugerido como ganancia disponible (según los parciales cargados hasta
        ahora): {usd(pendienteSugerido)} -- se puede ajustar.
      </div>
      <div className="field"><label>Ganancia disponible a repartir</label><input type="number" value={gananciaDisponible} onChange={(e) => setGananciaDisponible(e.target.value)} /></div>
      <div className="field"><label>Cuánto de eso va a memoria</label><input type="number" value={memoriaAplicada} onChange={(e) => setMemoriaAplicada(e.target.value)} /></div>
      <div className="field"><label>Motivo / autorización</label><input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Autorizando..." : "Autorizar split extraordinario"}</button>
    </div>
  );
}

function CerrarMesForm({
  periodoId, modoMemoriaPeriodo, proyeccion, confirmDialog, onCerrado,
}: { periodoId: string; modoMemoriaPeriodo: "AUTOMATICO" | "PARCIAL_MANUAL"; proyeccion: any; confirmDialog: any; onCerrado: () => void }) {
  const [modoMemoria, setModoMemoria] = useState<"AUTOMATICO" | "PARCIAL_MANUAL">(modoMemoriaPeriodo);
  const [memoriaAplicadaManual, setMemoriaAplicadaManual] = useState("");
  const [pagoReal, setPagoReal] = useState(String(proyeccion.splitJugadorProyectado));
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function cerrar() {
    if (!(await confirmDialog(
      `Vas a cerrar el mes. Resultado deal acumulado: ${usd(proyeccion.acumulados.resultadoDealAcumulado)}, memoria final estimada ${usd(proyeccion.memoriaProyectada)}, split jugador estimado ${usd(proyeccion.splitJugadorProyectado)}. Esto consolida todos los parciales y NO se puede deshacer salvo una reapertura auditada. ¿Confirmás?`
    ))) return;
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.cerrarMes(periodoId, {
        modoMemoria,
        memoriaAplicadaManual: modoMemoria === "PARCIAL_MANUAL" ? Number(memoriaAplicadaManual) : undefined,
        pagoReal: pagoReal.trim() ? Number(pagoReal) : undefined,
      });
      onCerrado();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cerrar el mes." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Cierre mensual -- pantalla de confirmación</h3>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
        Resultado mesas total: <strong>{usd(proyeccion.acumulados.resultadoMesasAcumulado)}</strong><br />
        Rake bruto total: <strong>{usd(proyeccion.acumulados.rakeBrutoAcumulado)}</strong><br />
        Resultado deal total: <strong>{usd(proyeccion.acumulados.resultadoDealAcumulado)}</strong><br />
        Rake directo TeamBack (nunca se reparte): <strong>{usd(proyeccion.acumulados.rakeTeambackAcumulado)}</strong><br />
        Split jugador estimado: <strong>{usd(proyeccion.splitJugadorProyectado)}</strong> -- Split TeamBack estimado: <strong>{usd(proyeccion.splitTeambackProyectado)}</strong><br />
        Memoria final estimada: <strong>{usd(proyeccion.memoriaProyectada)}</strong>
      </div>
      <div className="field">
        <label>Modo de recuperación de memoria para este cierre</label>
        <select value={modoMemoria} onChange={(e) => setModoMemoria(e.target.value as any)}>
          <option value="AUTOMATICO">Automático</option>
          <option value="PARCIAL_MANUAL">Parcial manual</option>
        </select>
      </div>
      {modoMemoria === "PARCIAL_MANUAL" && (
        <div className="field"><label>Memoria a aplicar</label><input type="number" value={memoriaAplicadaManual} onChange={(e) => setMemoriaAplicadaManual(e.target.value)} /></div>
      )}
      <div className="field"><label>Pago real al jugador (si difiere del teórico)</label><input type="number" value={pagoReal} onChange={(e) => setPagoReal(e.target.value)} /></div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={cerrar}>{guardando ? "Cerrando..." : "Confirmar cierre mensual"}</button>
    </div>
  );
}
