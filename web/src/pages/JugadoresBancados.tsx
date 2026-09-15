import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";

/**
 * "Jugadores bancados" (pedido 14/09/2026): un jugador puntual de un agente que hay que excluir
 * del cierre agregado de ese agente porque se contabiliza aparte. Ver players.bancado y
 * repo/imports.ts para la exclusión, y engine/bancados.ts para el motor de liquidación propio
 * (capital / makeup / rakeback) agregado el 15/09/2026 — réplica exacta de la lógica ya probada
 * en la planilla (motor "DIGIPLAYERS · MOTOR DE JUGADORES BANCADOS").
 *
 * NO confundir con agents.account_type = "BANCADO" (cuenta de AGENTE con motor de cierre
 * propio) — esto es un JUGADOR individual dentro del roster de un agente normal.
 */
export default function JugadoresBancados() {
  const [bancados, setBancados] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [historialGlobal, setHistorialGlobal] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(true);

  function refresh() {
    setCargando(true);
    api
      .jugadoresBancados()
      .then(setBancados)
      .catch((e: any) => setError(e.message))
      .finally(() => setCargando(false));
  }

  function refreshHistorial() {
    setCargandoHistorial(true);
    api
      .historialBancadoGlobal()
      .then(setHistorialGlobal)
      .catch((e: any) => setError(e.message))
      .finally(() => setCargandoHistorial(false));
  }

  useEffect(() => {
    refresh();
    refreshHistorial();
  }, []);

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const timeout = setTimeout(() => {
      api
        .buscarJugadores(busqueda)
        .then(setResultados)
        .catch((e: any) => setError(e.message))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [busqueda]);

  async function marcar(playerId: string, bancado: boolean) {
    setMarcando(playerId);
    try {
      await api.setJugadorBancado(playerId, bancado);
      refresh();
      if (bancado) {
        setResultados((rs) => rs.map((r) => (r.id === playerId ? { ...r, bancado: true } : r)));
      }
    } catch (err: any) {
      alert(err.message || "No se pudo actualizar el jugador.");
    } finally {
      setMarcando(null);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Jugadores bancados</h2>
          <div className="muted">
            Un jugador marcado acá se omite del cierre agregado de su agente en la próxima importación — su plata se liquida
            aparte, con su propio capital y makeup (desplegá su fila para configurar la banca y cerrar semanas).
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Buscar y marcar un jugador</h3>
        <input
          type="text"
          placeholder="Nombre o ID del jugador..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          style={{ width: 320, marginBottom: 10 }}
        />
        {error && <div className="error">{error}</div>}
        {busqueda.trim().length >= 2 && (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Jugador</th>
                  <th>ID</th>
                  <th>Club</th>
                  <th>Agente</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {buscando && (
                  <tr>
                    <td colSpan={5} className="muted">Buscando...</td>
                  </tr>
                )}
                {!buscando && resultados.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">Sin resultados.</td>
                  </tr>
                )}
                {resultados.map((r) => (
                  <tr key={r.id}>
                    <td>{r.display_name ?? <span className="muted">Sin nombre</span>}</td>
                    <td className="muted">{r.external_id}</td>
                    <td>{r.club_name}</td>
                    <td>{r.agent_name ?? <span className="muted">Sin agente</span>}</td>
                    <td className="row-actions">
                      {r.bancado ? (
                        <span className="badge pos">Ya es bancado</span>
                      ) : (
                        <button className="btn secondary small" disabled={marcando === r.id} onClick={() => marcar(r.id, true)}>
                          {marcando === r.id ? "..." : "Marcar bancado"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Jugadores marcados como bancados ({bancados.length})</h3>
        {cargando ? (
          <div className="muted">Cargando...</div>
        ) : bancados.length === 0 ? (
          <div className="muted">Todavía no hay ningún jugador marcado como bancado.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Jugador</th>
                  <th>ID</th>
                  <th>Club</th>
                  <th>Agente</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bancados.map((b) => (
                  <FilaBancado
                    key={b.id}
                    jugador={b}
                    abierto={expandido === b.id}
                    onToggle={() => setExpandido((cur) => (cur === b.id ? null : b.id))}
                    onQuitar={() => marcar(b.id, false)}
                    quitando={marcando === b.id}
                    onCierreAplicado={refreshHistorial}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="topbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Historial de la banca</h3>
        </div>
        {cargandoHistorial ? (
          <div className="muted">Cargando...</div>
        ) : historialGlobal.length === 0 ? (
          <div className="muted">Todavía no se cerró ninguna semana de banca.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Semana</th>
                  <th>Jugador</th>
                  <th>Club</th>
                  <th>Resultado mesas</th>
                  <th>Rakeback</th>
                  <th>Makeup</th>
                  <th>Pago jugador</th>
                  <th>Ganancia banca</th>
                  <th>Capital después</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historialGlobal.map((h) => (
                  <tr key={h.id} style={h.status === "REVERTIDO" ? { opacity: 0.5 } : undefined}>
                    <td>{dateShort(h.week_start)} - {dateShort(h.week_end)}</td>
                    <td>{h.player_name} <span className="muted">#{h.player_external_id}</span></td>
                    <td>{h.club_name}</td>
                    <td>{usd(h.resultado_mesas)}</td>
                    <td>{usd(h.rakeback_total)}</td>
                    <td>{usd(h.makeup_nuevo)}</td>
                    <td><span className={`badge ${Number(h.pago_jugador_total) >= 0 ? "pos" : "neg"}`}>{usd(h.pago_jugador_total)}</span></td>
                    <td>{usd(h.ganancia_banca_mesas)}</td>
                    <td>{usd(h.capital_despues)}</td>
                    <td>{h.status === "REVERTIDO" && <span className="badge neg">Revertido</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function FilaBancado({
  jugador,
  abierto,
  onToggle,
  onQuitar,
  quitando,
  onCierreAplicado,
}: {
  jugador: any;
  abierto: boolean;
  onToggle: () => void;
  onQuitar: () => void;
  quitando: boolean;
  onCierreAplicado: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          <button className="btn secondary small" onClick={onToggle} style={{ padding: "2px 8px" }}>
            {abierto ? "▾" : "▸"}
          </button>
        </td>
        <td>{jugador.display_name ?? <span className="muted">Sin nombre</span>}</td>
        <td className="muted">{jugador.external_id}</td>
        <td>{jugador.club_name}</td>
        <td>{jugador.agent_name ?? <span className="muted">Sin agente</span>}</td>
        <td className="row-actions">
          <button
            className="btn secondary small"
            disabled={quitando}
            onClick={onQuitar}
            title="Vuelve a contarlo dentro del cierre normal de su agente en la próxima importación."
          >
            {quitando ? "..." : "Quitar"}
          </button>
        </td>
      </tr>
      {abierto && (
        <tr>
          <td></td>
          <td colSpan={5}>
            <PanelBanca jugador={jugador} onCierreAplicado={onCierreAplicado} />
          </td>
        </tr>
      )}
    </>
  );
}

function PanelBanca({ jugador, onCierreAplicado }: { jugador: any; onCierreAplicado: () => void }) {
  const [config, setConfig] = useState<any | null>(null);
  const [estado, setEstado] = useState<any | null>(null);
  const [cargandoConfig, setCargandoConfig] = useState(true);
  const [editandoConfig, setEditandoConfig] = useState(false);
  const [guardandoConfig, setGuardandoConfig] = useState(false);

  const [pctJugador, setPctJugador] = useState("50");
  const [pctBanca, setPctBanca] = useState("50");
  const [rakebackPct, setRakebackPct] = useState("0");
  const [capitalInicial, setCapitalInicial] = useState("0");
  const [makeupInicial, setMakeupInicial] = useState("0");
  const [moneda, setMoneda] = useState("USD");
  const [regla, setRegla] = useState("");
  const [observacionesCfg, setObservacionesCfg] = useState("");

  const [historial, setHistorial] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(true);

  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [resultadoMesas, setResultadoMesas] = useState("0");
  const [rakeTotal, setRakeTotal] = useState("0");
  const [observacionesCierre, setObservacionesCierre] = useState("");
  const [previa, setPrevia] = useState<any | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);

  function cargarTodo() {
    setCargandoConfig(true);
    api
      .bancadoEstado(jugador.id)
      .then((r: any) => {
        setConfig(r.config);
        setEstado(r.estado);
        setPctJugador(String(Number(r.config.pct_jugador) * 100));
        setPctBanca(String(Number(r.config.pct_banca) * 100));
        setRakebackPct(String(Number(r.config.rakeback_pct) * 100));
        setCapitalInicial(String(r.config.capital_inicial));
        setMakeupInicial(String(r.config.makeup_inicial));
        setMoneda(r.config.moneda ?? "USD");
        setRegla(r.config.regla ?? "");
        setObservacionesCfg(r.config.observaciones ?? "");
      })
      .catch(() => {
        setConfig(null);
        setEstado(null);
        setEditandoConfig(true); // sin config todavía: abre el form directo para cargarla
      })
      .finally(() => setCargandoConfig(false));
    setCargandoHistorial(true);
    api
      .historialBancado(jugador.id)
      .then(setHistorial)
      .finally(() => setCargandoHistorial(false));
  }

  useEffect(() => {
    cargarTodo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jugador.id]);

  async function guardarConfig() {
    setGuardandoConfig(true);
    try {
      await api.guardarBancadoConfig(jugador.id, {
        pctJugador: (Number(pctJugador) || 0) / 100,
        pctBanca: (Number(pctBanca) || 0) / 100,
        rakebackPct: (Number(rakebackPct) || 0) / 100,
        capitalInicial: Number(capitalInicial) || 0,
        makeupInicial: Number(makeupInicial) || 0,
        moneda,
        regla: regla || undefined,
        observaciones: observacionesCfg || undefined,
      });
      setEditandoConfig(false);
      cargarTodo();
    } catch (err: any) {
      alert(err.message || "No se pudo guardar la configuración.");
    } finally {
      setGuardandoConfig(false);
    }
  }

  async function previsualizar() {
    setCalculando(true);
    setErrorCierre(null);
    setPrevia(null);
    try {
      const r = await api.previsualizarCierreBancado(jugador.id, Number(resultadoMesas) || 0, Number(rakeTotal) || 0);
      setPrevia(r.calc);
    } catch (err: any) {
      setErrorCierre(err.message || "No se pudo calcular.");
    } finally {
      setCalculando(false);
    }
  }

  async function confirmarCierre() {
    if (!weekStart || !weekEnd) {
      setErrorCierre("Cargá la semana (desde/hasta) antes de confirmar.");
      return;
    }
    setCerrando(true);
    setErrorCierre(null);
    try {
      const r = await api.cerrarCierreBancado({
        playerId: jugador.id,
        weekStart,
        weekEnd,
        resultadoMesas: Number(resultadoMesas) || 0,
        rakeTotal: Number(rakeTotal) || 0,
        observaciones: observacionesCierre || undefined,
      });
      if (r.alreadyApplied) {
        setErrorCierre("Ya había un cierre de banca aplicado para esa semana — no se duplicó.");
      } else {
        setPrevia(null);
        setResultadoMesas("0");
        setRakeTotal("0");
        setObservacionesCierre("");
        cargarTodo();
        onCierreAplicado();
      }
    } catch (err: any) {
      setErrorCierre(err.message || "No se pudo cerrar la semana.");
    } finally {
      setCerrando(false);
    }
  }

  async function revertir(id: string) {
    const motivo = prompt("¿Por qué se revierte este cierre de banca? (queda en el historial, no se borra nada)") ?? undefined;
    if (motivo === undefined) return;
    try {
      await api.revertirCierreBancado(id, motivo || undefined);
      cargarTodo();
      onCierreAplicado();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    }
  }

  if (cargandoConfig) return <div className="muted" style={{ padding: "10px 0" }}>Cargando banca...</div>;

  return (
    <div style={{ padding: "10px 0 16px" }}>
      {(!config || editandoConfig) && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h4 style={{ marginTop: 0 }}>{config ? "Editar configuración de la banca" : "Configurar la banca (primera vez)"}</h4>
          <div className="form-grid">
            <div className="field">
              <label>% Jugador</label>
              <input value={pctJugador} onChange={(e) => setPctJugador(e.target.value)} type="number" step="0.01" />
            </div>
            <div className="field">
              <label>% Banca</label>
              <input value={pctBanca} onChange={(e) => setPctBanca(e.target.value)} type="number" step="0.01" />
            </div>
            <div className="field">
              <label>% Rakeback</label>
              <input value={rakebackPct} onChange={(e) => setRakebackPct(e.target.value)} type="number" step="0.01" />
            </div>
            <div className="field">
              <label>Capital inicial (USD)</label>
              <input value={capitalInicial} onChange={(e) => setCapitalInicial(e.target.value)} type="number" step="0.01" />
            </div>
            <div className="field">
              <label>Makeup inicial (USD)</label>
              <input value={makeupInicial} onChange={(e) => setMakeupInicial(e.target.value)} type="number" step="0.01" />
            </div>
            <div className="field">
              <label>Moneda</label>
              <input value={moneda} onChange={(e) => setMoneda(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Regla / deal (opcional)</label>
            <input value={regla} onChange={(e) => setRegla(e.target.value)} />
          </div>
          <div className="field">
            <label>Observaciones (opcional)</label>
            <input value={observacionesCfg} onChange={(e) => setObservacionesCfg(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn small" disabled={guardandoConfig} onClick={guardarConfig}>
              {guardandoConfig ? "Guardando..." : "Guardar configuración"}
            </button>
            {config && (
              <button className="btn secondary small" onClick={() => setEditandoConfig(false)}>Cancelar</button>
            )}
          </div>
        </div>
      )}

      {config && !editandoConfig && (
        <>
          <div className="panel" style={{ marginBottom: 12 }}>
            <div className="topbar" style={{ marginBottom: 10 }}>
              <h4 style={{ margin: 0 }}>Estado actual</h4>
              <button className="btn secondary small" onClick={() => setEditandoConfig(true)}>Editar configuración</button>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <span>Capital actual: <strong>{usd(estado?.capitalActual ?? 0)}</strong></span>
              <span>Makeup actual: <strong className={Number(estado?.makeupActual ?? 0) > 0 ? "neg" : "pos"}>{usd(estado?.makeupActual ?? 0)}</strong></span>
              <span className="muted">% Jugador {(Number(config.pct_jugador) * 100).toFixed(1)}% · % Banca {(Number(config.pct_banca) * 100).toFixed(1)}% · % Rakeback {(Number(config.rakeback_pct) * 100).toFixed(1)}%</span>
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 12 }}>
            <h4 style={{ marginTop: 0 }}>Cerrar semana</h4>
            <div className="form-grid">
              <div className="field">
                <label>Semana desde</label>
                <input value={weekStart} onChange={(e) => { setWeekStart(e.target.value); setPrevia(null); }} type="date" />
              </div>
              <div className="field">
                <label>Semana hasta</label>
                <input value={weekEnd} onChange={(e) => { setWeekEnd(e.target.value); setPrevia(null); }} type="date" />
              </div>
              <div className="field">
                <label>Resultado mesas (USD)</label>
                <input value={resultadoMesas} onChange={(e) => { setResultadoMesas(e.target.value); setPrevia(null); }} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>Rake total (USD)</label>
                <input value={rakeTotal} onChange={(e) => { setRakeTotal(e.target.value); setPrevia(null); }} type="number" step="0.01" />
              </div>
            </div>
            <div className="field">
              <label>Observaciones (opcional)</label>
              <input value={observacionesCierre} onChange={(e) => setObservacionesCierre(e.target.value)} />
            </div>
            {errorCierre && <div className="error">{errorCierre}</div>}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <button className="btn secondary small" disabled={calculando} onClick={previsualizar}>
                {calculando ? "Calculando..." : "Previsualizar"}
              </button>
              {previa && (
                <button className="btn small" disabled={cerrando} onClick={confirmarCierre}>
                  {cerrando ? "Cerrando..." : "Confirmar cierre"}
                </button>
              )}
            </div>
            {previa && (
              <table style={{ marginTop: 12 }}>
                <tbody>
                  <tr><td>Resultado mesas</td><td>{usd(previa.resultadoMesas)}</td></tr>
                  <tr><td>Rake generado</td><td>{usd(previa.rakeTotal)}</td></tr>
                  <tr><td>Rakeback total</td><td>{usd(previa.rakebackTotal)}</td></tr>
                  <tr><td>Makeup anterior</td><td>{usd(previa.makeupAnterior)}</td></tr>
                  <tr><td>Pérdida que agrega makeup</td><td>{usd(previa.perdidaAgregaMakeup)}</td></tr>
                  <tr><td>RB aplicado a makeup</td><td>{usd(previa.rakebackAMakeup)}</td></tr>
                  <tr><td>Makeup nuevo</td><td>{usd(previa.makeupNuevo)}</td></tr>
                  <tr><td>Pago jugador por mesas</td><td>{usd(previa.pagoJugadorMesas)}</td></tr>
                  <tr><td>RB excedente para jugador</td><td>{usd(previa.rakebackExcedenteJugador)}</td></tr>
                  <tr><td><strong>Pago total jugador</strong></td><td><strong>{usd(previa.pagoJugadorTotal)}</strong></td></tr>
                  <tr><td>Ganancia banca mesas</td><td>{usd(previa.gananciaBancaMesas)}</td></tr>
                  <tr><td>Capital después</td><td>{usd(previa.capitalDespues)}</td></tr>
                </tbody>
              </table>
            )}
          </div>

          <div className="panel">
            <h4 style={{ marginTop: 0 }}>Historial de este jugador</h4>
            {cargandoHistorial ? (
              <div className="muted">Cargando...</div>
            ) : historial.length === 0 ? (
              <div className="muted">Todavía no se cerró ninguna semana.</div>
            ) : (
              <table>
                <thead>
                  <tr><th>Semana</th><th>Resultado</th><th>Rakeback</th><th>Makeup</th><th>Pago jugador</th><th>Capital después</th><th></th></tr>
                </thead>
                <tbody>
                  {historial.map((h: any) => (
                    <tr key={h.id} style={h.status === "REVERTIDO" ? { opacity: 0.5 } : undefined}>
                      <td>{dateShort(h.week_start)} - {dateShort(h.week_end)}</td>
                      <td>{usd(h.resultado_mesas)}</td>
                      <td>{usd(h.rakeback_total)}</td>
                      <td>{usd(h.makeup_nuevo)}</td>
                      <td>{usd(h.pago_jugador_total)}</td>
                      <td>{usd(h.capital_despues)}</td>
                      <td>
                        {h.status !== "REVERTIDO" ? (
                          <button className="btn secondary small" onClick={() => revertir(h.id)}>Revertir</button>
                        ) : (
                          <span className="badge neg">Revertido</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
