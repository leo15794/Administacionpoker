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
  const [accionandoGlobal, setAccionandoGlobal] = useState<string | null>(null);

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

  async function revertirGlobal(h: any) {
    const motivo = prompt(`Revertir el cierre de banca de ${h.player_name} (semana ${dateShort(h.week_start)} - ${dateShort(h.week_end)}).\n\n¿Por qué lo revertís? (queda en el historial, no se borra nada)`) ?? undefined;
    if (motivo === undefined) return;
    setAccionandoGlobal(h.id);
    try {
      await api.revertirCierreBancado(h.id, motivo || undefined);
      refreshHistorial();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    } finally {
      setAccionandoGlobal(null);
    }
  }

  // BORRADO REAL — solo para limpiar datos de prueba. Sobre plata real siempre "Revertir",
  // nunca esto. Pide escribir "BORRAR" literal para no tocarlo por error de un clic.
  async function borrarGlobal(h: any) {
    const confirmacion = prompt(
      `Esto BORRA DEL TODO el cierre de banca de ${h.player_name} (semana ${dateShort(h.week_start)} - ${dateShort(h.week_end)}) — no queda en ningún historial, a diferencia de "Revertir".\n\nUsalo SOLO para limpiar datos de prueba, nunca sobre plata real ya operada.\n\nEscribí BORRAR para confirmar:`
    );
    if (confirmacion !== "BORRAR") return;
    setAccionandoGlobal(h.id);
    try {
      await api.eliminarCierreBancadoDefinitivo(h.id);
      refreshHistorial();
    } catch (err: any) {
      alert(err.message || "No se pudo borrar.");
    } finally {
      setAccionandoGlobal(null);
    }
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

      <ImportarBancados onCierreAplicado={refreshHistorial} />

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
                  <th>Tipo</th>
                  <th>Jugador</th>
                  <th>Club</th>
                  <th>Resultado mesas</th>
                  <th>Rakeback total</th>
                  <th>RB → Makeup</th>
                  <th>RB → Jugador</th>
                  <th>Makeup (ant. → nuevo)</th>
                  <th>Pago mesas</th>
                  <th>Pago total jugador</th>
                  <th>Ganancia banca</th>
                  <th>Capital (ant. → después)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historialGlobal.map((h) => (
                  <tr key={h.id} style={h.status === "REVERTIDO" ? { opacity: 0.5 } : undefined}>
                    <td>{dateShort(h.week_start)}{h.tipo !== "RECARGA_CAPITAL" ? ` - ${dateShort(h.week_end)}` : ""}</td>
                    <td>
                      {h.tipo === "RECARGA_CAPITAL" ? (
                        <span className="badge neutral">Recarga capital</span>
                      ) : (
                        <span className="muted">Cierre semanal</span>
                      )}
                    </td>
                    <td>{h.player_name} <span className="muted">#{h.player_external_id}</span></td>
                    <td>{h.club_name}</td>
                    <td>{usd(h.resultado_mesas)}</td>
                    <td>{usd(h.rakeback_total)}</td>
                    <td className="muted">{usd(h.rakeback_a_makeup)}</td>
                    <td className="muted">{usd(h.rakeback_excedente_jugador)}</td>
                    <td className="muted">{usd(h.makeup_anterior)} → {usd(h.makeup_nuevo)}</td>
                    <td className="muted">{usd(h.pago_jugador_mesas)}</td>
                    <td><span className={`badge ${Number(h.pago_jugador_total) >= 0 ? "pos" : "neg"}`}>{usd(h.pago_jugador_total)}</span></td>
                    <td>{usd(h.ganancia_banca_mesas)}</td>
                    <td>{usd(h.capital_anterior)} → <strong>{usd(h.capital_despues)}</strong></td>
                    <td className="row-actions">
                      {h.status === "REVERTIDO" ? (
                        <span className="badge neg" style={{ marginRight: 6 }}>Revertido</span>
                      ) : (
                        <button
                          className="btn secondary small"
                          disabled={accionandoGlobal === h.id}
                          onClick={() => revertirGlobal(h)}
                          title="Revertir (queda en el historial, no se borra nada)"
                        >
                          {accionandoGlobal === h.id ? "..." : "Revertir"}
                        </button>
                      )}
                      <button
                        className="btn secondary small"
                        disabled={accionandoGlobal === h.id}
                        onClick={() => borrarGlobal(h)}
                        title="Borrado real — no queda en el historial. Solo para datos de prueba, nunca para plata real."
                        style={{ color: "var(--danger, #e5484d)" }}
                      >
                        {accionandoGlobal === h.id ? "..." : "Borrar"}
                      </button>
                    </td>
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
  const [historialAbierto, setHistorialAbierto] = useState(true);
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

  const [montoRecarga, setMontoRecarga] = useState("0");
  const [fechaRecarga, setFechaRecarga] = useState(() => new Date().toISOString().slice(0, 10));
  const [observacionesRecarga, setObservacionesRecarga] = useState("");
  const [recargando, setRecargando] = useState(false);
  const [errorRecarga, setErrorRecarga] = useState<string | null>(null);

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

  // Recarga/ajuste manual de capital (pedido 18/09/2026): antes solo se podía cargar el capital
  // inicial una vez, en la config — y encima esa config deja de tener efecto en cuanto ya hay
  // algún cierre semanal (el estado vigente se lee siempre del último historial). Esto guarda un
  // movimiento aparte que solo mueve el capital, sin tocar rake/rakeback/makeup.
  async function recargarCapital() {
    if (!Number(montoRecarga)) {
      setErrorRecarga("Cargá un monto distinto de 0.");
      return;
    }
    if (!fechaRecarga) {
      setErrorRecarga("Cargá la fecha de la recarga.");
      return;
    }
    setRecargando(true);
    setErrorRecarga(null);
    try {
      await api.recargarCapitalBancado({
        playerId: jugador.id,
        monto: Number(montoRecarga) || 0,
        fecha: fechaRecarga,
        observaciones: observacionesRecarga || undefined,
      });
      setMontoRecarga("0");
      setObservacionesRecarga("");
      cargarTodo();
      onCierreAplicado();
    } catch (err: any) {
      setErrorRecarga(err.message || "No se pudo registrar la recarga.");
    } finally {
      setRecargando(false);
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

  // BORRADO REAL — solo para limpiar datos de prueba. Sobre plata real siempre "Revertir",
  // nunca esto. Pide escribir "BORRAR" literal para no tocarlo por error de un clic.
  async function borrarDefinitivo(id: string) {
    const confirmacion = prompt(
      'Esto BORRA DEL TODO este cierre de banca — no queda en ningún historial, a diferencia de "Revertir".\n\nUsalo SOLO para limpiar datos de prueba, nunca sobre plata real ya operada.\n\nEscribí BORRAR para confirmar:'
    );
    if (confirmacion !== "BORRAR") return;
    try {
      await api.eliminarCierreBancadoDefinitivo(id);
      cargarTodo();
      onCierreAplicado();
    } catch (err: any) {
      alert(err.message || "No se pudo borrar.");
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
            <h4 style={{ marginTop: 0 }}>Recargar capital</h4>
            <div className="muted" style={{ marginBottom: 10 }}>
              Para cuando el jugador se queda en 0 (o negativo) a mitad de camino y hay que volver a cargarle fichas — no toca
              rake/rakeback/makeup, solo el capital. Un monto negativo lo descuenta en vez de recargarlo.
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Monto (USD)</label>
                <input value={montoRecarga} onChange={(e) => setMontoRecarga(e.target.value)} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>Fecha</label>
                <input value={fechaRecarga} onChange={(e) => setFechaRecarga(e.target.value)} type="date" />
              </div>
            </div>
            <div className="field">
              <label>Observaciones (opcional)</label>
              <input value={observacionesRecarga} onChange={(e) => setObservacionesRecarga(e.target.value)} />
            </div>
            {errorRecarga && <div className="error">{errorRecarga}</div>}
            <button className="btn secondary small" disabled={recargando} onClick={recargarCapital}>
              {recargando ? "Guardando..." : "Registrar recarga"}
            </button>
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
            <div className="topbar" style={{ marginBottom: 10 }}>
              <h4 style={{ margin: 0 }}>Historial de este jugador</h4>
              {historial.length > 0 && (
                <button className="btn secondary small" onClick={() => setHistorialAbierto((v) => !v)}>
                  {historialAbierto ? "Contraer semanas" : "Ver semanas"}
                </button>
              )}
            </div>
            {cargandoHistorial ? (
              <div className="muted">Cargando...</div>
            ) : historial.length === 0 ? (
              <div className="muted">Todavía no se cerró ninguna semana.</div>
            ) : (
              <>
                {/* Totales acumulados: suman TODAS las semanas activas, se vean o no en la tabla
                    de abajo — contraer semanas es solo para no ensuciar la vista, nunca deja
                    afuera una semana de la suma. */}
                {(() => {
                  const activas = historial.filter((h: any) => h.status !== "REVERTIDO");
                  const totalRake = activas.reduce((acc: number, h: any) => acc + Number(h.rake_total), 0);
                  const totalRakeback = activas.reduce((acc: number, h: any) => acc + Number(h.rakeback_total), 0);
                  const totalRakeBanca = totalRake - totalRakeback;
                  return (
                    <div className="muted" style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 10 }}>
                      <span>Rake generado total (acumulado): <strong>{usd(totalRake)}</strong></span>
                      <span>Rakeback Bancado (acumulado): <strong>{usd(totalRakeback)}</strong></span>
                      <span>Rake Banca (acumulado): <strong>{usd(totalRakeBanca)}</strong></span>
                    </div>
                  );
                })()}
                {historialAbierto && (
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Semana</th><th>Tipo</th><th>Resultado</th><th>Rake generado</th>
                          <th>Rakeback total</th><th>RB → Makeup</th><th>RB → Jugador</th><th>Rake Banca</th>
                          <th>Makeup (ant. → nuevo)</th><th>Pago mesas</th><th>Pago total jugador</th>
                          <th>Capital (ant. → después)</th><th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {historial.map((h: any) => (
                          <tr key={h.id} style={h.status === "REVERTIDO" ? { opacity: 0.5 } : undefined}>
                            <td>{dateShort(h.week_start)}{h.tipo !== "RECARGA_CAPITAL" ? ` - ${dateShort(h.week_end)}` : ""}</td>
                            <td>
                              {h.tipo === "RECARGA_CAPITAL" ? (
                                <span className="badge neutral">Recarga capital</span>
                              ) : (
                                <span className="muted">Cierre semanal</span>
                              )}
                            </td>
                            <td>{usd(h.resultado_mesas)}</td>
                            <td>{usd(h.rake_total)}</td>
                            <td>{usd(h.rakeback_total)}</td>
                            <td className="muted">{usd(h.rakeback_a_makeup)}</td>
                            <td className="muted">{usd(h.rakeback_excedente_jugador)}</td>
                            <td>{usd(Number(h.rake_total) - Number(h.rakeback_total))}</td>
                            <td className="muted">{usd(h.makeup_anterior)} → {usd(h.makeup_nuevo)}</td>
                            <td className="muted">{usd(h.pago_jugador_mesas)}</td>
                            <td>{usd(h.pago_jugador_total)}</td>
                            <td>{usd(h.capital_anterior)} → <strong>{usd(h.capital_despues)}</strong></td>
                            <td className="row-actions">
                              {h.status !== "REVERTIDO" ? (
                                <button className="btn secondary small" onClick={() => revertir(h.id)}>Revertir</button>
                              ) : (
                                <span className="badge neg" style={{ marginRight: 6 }}>Revertido</span>
                              )}
                              <button
                                className="btn secondary small"
                                onClick={() => borrarDefinitivo(h.id)}
                                title="Borrado real — no queda en el historial. Solo para datos de prueba, nunca para plata real."
                                style={{ color: "var(--danger, #e5484d)" }}
                              >
                                Borrar
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}


// Carga automática por archivo (pedido 15/09/2026): mismo archivo semanal que se sube en
// Cierres, pero acá solo interesan los jugadores marcados como bancados — reusa tal cual los
// endpoints de importación existentes (analizarImportacionSuprema/TeamBackGG/TinyGG), que YA
// devuelven por club un array `bancados` con playerId/resultado/rake de cada jugador bancado
// que apareció en el archivo (ver repo/imports.ts, JugadorBancadoOmitido) — no hace falta
// ningún endpoint nuevo del lado del backend, solo filtrar/mostrar ese pedazo de la respuesta
// en vez del agregado normal por agente.
function ImportarBancados({ onCierreAplicado }: { onCierreAplicado: () => void }) {
  const [plataforma, setPlataforma] = useState<"suprema" | "teamback-gg" | "tiny-gg">("suprema");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [analizando, setAnalizando] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<any[]>([]);

  // Clubes elegibles para el selector de "a qué club corresponde esta hoja" — mismo patrón
  // que Cierres.tsx: el nombre de la hoja del archivo no siempre coincide con el nombre de
  // ningún club configurado (ej. una hoja genérica "Hoja1" en vez de "Fénix Suprema"/"TeamBack
  // Suprema"), así que hace falta poder elegirlo a mano en vez de asumir que siempre matchea.
  const [clubesDisponibles, setClubesDisponibles] = useState<{ id: string; name: string }[]>([]);
  // Hojas que trae el archivo (con formato reconocido) y a qué club quedó sugerida/asignada
  // cada una. clubIdSugerido = null significa que no hubo auto-match: hay que elegirlo abajo.
  const [hojasDetectadas, setHojasDetectadas] = useState<{ sheetName: string; clubIdSugerido: string | null }[]>([]);
  const [clubElegidoPorHoja, setClubElegidoPorHoja] = useState<Record<string, string>>({});
  const [hojasFormatoInvalido, setHojasFormatoInvalido] = useState<{ sheetName: string; motivo: string }[]>([]);
  const [paso, setPaso] = useState<"elegir_archivo" | "elegir_club" | "resultado">("elegir_archivo");

  useEffect(() => {
    const fetchClubes =
      plataforma === "teamback-gg"
        ? api.clubesImportacionTeamBackGG()
        : plataforma === "tiny-gg"
        ? api.clubesImportacionTinyGG()
        : api.clubesImportacionSuprema();
    fetchClubes.then(setClubesDisponibles).catch(() => setClubesDisponibles([]));
  }, [plataforma]);

  async function subirArchivo(overrides?: Record<string, string>): Promise<any> {
    if (plataforma === "suprema") {
      if (!archivo) throw new Error("Subí el archivo (.xlsx).");
      return api.previsualizarImportacion(archivo, weekEnd, overrides);
    }
    if (plataforma === "teamback-gg") {
      if (!archivo) throw new Error("Subí el archivo (.xlsx).");
      return api.previsualizarImportacionTeamBackGG(archivo, weekEnd, overrides);
    }
    if (archivos.length === 0) throw new Error("Subí los archivos (uno por super agente).");
    return api.previsualizarImportacionTinyGG(archivos, weekEnd, overrides);
  }

  function extraerBancados(result: any) {
    const detectados: any[] = [];
    for (const c of result.clubes ?? []) {
      for (const b of c.bancados ?? []) {
        detectados.push({
          key: `${c.clubId}_${b.playerId}`,
          playerId: b.playerId,
          playerExternalId: b.playerExternalId,
          playerName: b.playerName,
          agentName: b.agentName,
          clubName: c.clubName,
          resultado: Number(b.resultado) || 0,
          rake: Number(b.rake) || 0,
        });
      }
    }
    return detectados;
  }

  // Paso 1: lee el archivo y arma qué hoja quedó resuelta a qué club (o no) — todavía no busca
  // bancados, porque una hoja sin club asignado no cuenta ningún jugador de esa hoja.
  async function analizar() {
    setError("");
    setItems([]);
    if (!weekStart || !weekEnd) {
      setError("Cargá la semana (desde/hasta) antes de analizar el archivo.");
      return;
    }
    setAnalizando(true);
    try {
      const result = await subirArchivo();
      setHojasFormatoInvalido((result.hojasNoReconocidas || []).filter((h: any) => !h.resolvable));
      const sugerencias: Record<string, string> = {};
      const detectadas: { sheetName: string; clubIdSugerido: string | null }[] = [];
      for (const c of result.clubes || []) {
        detectadas.push({ sheetName: c.sheetName, clubIdSugerido: c.clubId });
        sugerencias[c.sheetName] = c.clubId;
      }
      for (const h of (result.hojasNoReconocidas || []).filter((h: any) => h.resolvable)) {
        detectadas.push({ sheetName: h.sheetName, clubIdSugerido: null });
      }
      setHojasDetectadas(detectadas);
      setClubElegidoPorHoja(sugerencias);
      if (detectadas.length === 0) {
        setError("El archivo no trajo ninguna hoja con formato reconocido.");
        setPaso("elegir_archivo");
        return;
      }
      // Si TODAS las hojas ya matchearon un club solas, no hace falta el paso intermedio —
      // vamos directo a buscar los bancados con lo que ya se resolvió.
      if (detectadas.every((h) => h.clubIdSugerido)) {
        await confirmarClubesYBuscar(sugerencias);
      } else {
        setPaso("elegir_club");
      }
    } catch (err: any) {
      setError(err.message || "No se pudo leer el archivo.");
    } finally {
      setAnalizando(false);
    }
  }

  // Paso 2: con el club ya elegido (sugerido o a mano) para cada hoja, vuelve a mandar el mismo
  // archivo con esa elección explícita y ahí sí extrae los jugadores bancados.
  async function confirmarClubesYBuscar(overridesForzados?: Record<string, string>) {
    setError("");
    setAnalizando(true);
    try {
      const overrides = overridesForzados ?? clubElegidoPorHoja;
      const faltantes = hojasDetectadas.filter((h) => !overrides[h.sheetName]);
      if (faltantes.length > 0) {
        setError(`Elegí un club para: ${faltantes.map((h) => h.sheetName).join(", ")}.`);
        setAnalizando(false);
        return;
      }
      const result = await subirArchivo(overrides);
      const detectados = extraerBancados(result);
      setItems(detectados);
      setPaso("resultado");
      if (detectados.length === 0) {
        setError("El archivo no trajo ningún jugador marcado como bancado (revisá que estén marcados en el panel de arriba).");
      }
    } catch (err: any) {
      setError(err.message || "No se pudo leer el archivo.");
    } finally {
      setAnalizando(false);
    }
  }

  function reiniciar() {
    setItems([]);
    setHojasDetectadas([]);
    setClubElegidoPorHoja({});
    setHojasFormatoInvalido([]);
    setError("");
    setPaso("elegir_archivo");
  }

  return (
    <div className="panel">
      <h3>Cargar archivo semanal (solo bancados)</h3>
      <div className="muted" style={{ marginBottom: 10 }}>
        Subí el mismo archivo semanal que usás en Cierres — acá solo se procesan los jugadores que ya están marcados como
        bancados (el resto del archivo se ignora). Para cada uno se usa el resultado y el rake que trae el archivo, junto con
        su configuración de banca ya cargada.
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Plataforma</label>
          <select
            value={plataforma}
            onChange={(e) => { setPlataforma(e.target.value as any); setArchivo(null); setArchivos([]); reiniciar(); }}
          >
            <option value="suprema">SupremaPoker (Fénix/TeamBack Suprema)</option>
            <option value="teamback-gg">GG Poker / TeamBack GG</option>
            <option value="tiny-gg">Tiny GG</option>
          </select>
        </div>
        <div className="field">
          <label>Semana desde</label>
          <input value={weekStart} onChange={(e) => setWeekStart(e.target.value)} type="date" />
        </div>
        <div className="field">
          <label>Semana hasta</label>
          <input value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} type="date" />
        </div>
        <div className="field">
          <label>{plataforma === "tiny-gg" ? "Archivos (uno por super agente)" : "Archivo"}</label>
          {plataforma === "tiny-gg" ? (
            <input type="file" multiple accept=".xlsx,.xls" onChange={(e) => { setArchivos(Array.from(e.target.files ?? [])); reiniciar(); }} />
          ) : (
            <input type="file" accept=".xlsx,.xls" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); reiniciar(); }} />
          )}
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {paso === "elegir_archivo" && (
        <button className="btn small" disabled={analizando} onClick={analizar} style={{ marginTop: 6 }}>
          {analizando ? "Analizando..." : "Analizar archivo"}
        </button>
      )}

      {paso === "elegir_club" && (
        <div style={{ marginTop: 10 }}>
          {hojasFormatoInvalido.length > 0 && (
            <div className="muted" style={{ marginBottom: 10 }}>
              Hojas ignoradas (no tienen el formato esperado): {hojasFormatoInvalido.map((h) => h.sheetName).join(", ")}.
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            El nombre de la hoja no coincide solo con ningún club — elegí a qué club corresponde cada una:
          </div>
          {hojasDetectadas.map((h) => (
            <div className="field" key={h.sheetName} style={{ maxWidth: 420 }}>
              <label>Hoja "{h.sheetName}"</label>
              <select
                value={clubElegidoPorHoja[h.sheetName] ?? ""}
                onChange={(e) => setClubElegidoPorHoja((cur) => ({ ...cur, [h.sheetName]: e.target.value }))}
              >
                <option value="">Elegir club...</option>
                {clubesDisponibles.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          ))}
          <button className="btn small" disabled={analizando} onClick={() => confirmarClubesYBuscar()} style={{ marginTop: 6 }}>
            {analizando ? "Buscando..." : "Confirmar y buscar bancados"}
          </button>
        </div>
      )}

      {paso === "resultado" && (
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={reiniciar}>Analizar otro archivo</button>
          {items.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th>Jugador</th><th>Club</th><th>Agente</th><th>Resultado</th><th>Rake</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <FilaImportBancado key={it.key} item={it} weekStart={weekStart} weekEnd={weekEnd} onCierreAplicado={onCierreAplicado} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FilaImportBancado({
  item,
  weekStart,
  weekEnd,
  onCierreAplicado,
}: {
  item: any;
  weekStart: string;
  weekEnd: string;
  onCierreAplicado: () => void;
}) {
  const [resultadoMesas, setResultadoMesas] = useState(String(item.resultado));
  const [rakeTotal, setRakeTotal] = useState(String(item.rake));
  const [previa, setPrevia] = useState<any | null>(null);
  const [calculando, setCalculando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aplicado, setAplicado] = useState(false);

  async function previsualizar() {
    setCalculando(true);
    setError(null);
    setPrevia(null);
    try {
      const r = await api.previsualizarCierreBancado(item.playerId, Number(resultadoMesas) || 0, Number(rakeTotal) || 0);
      setPrevia(r.calc);
    } catch (err: any) {
      setError(err.message || "No se pudo calcular.");
    } finally {
      setCalculando(false);
    }
  }

  async function confirmar() {
    setCerrando(true);
    setError(null);
    try {
      const r = await api.cerrarCierreBancado({
        playerId: item.playerId,
        weekStart,
        weekEnd,
        resultadoMesas: Number(resultadoMesas) || 0,
        rakeTotal: Number(rakeTotal) || 0,
      });
      if (r.alreadyApplied) {
        setError("Ya había un cierre de banca aplicado para esa semana — no se duplicó.");
      } else {
        setAplicado(true);
        onCierreAplicado();
      }
    } catch (err: any) {
      setError(err.message || "No se pudo cerrar la semana.");
    } finally {
      setCerrando(false);
    }
  }

  return (
    <>
      <tr>
        <td>{item.playerName} <span className="muted">#{item.playerExternalId ?? item.playerId}</span></td>
        <td>{item.clubName}</td>
        <td>{item.agentName}</td>
        <td>
          <input value={resultadoMesas} onChange={(e) => { setResultadoMesas(e.target.value); setPrevia(null); }} type="number" step="0.01" style={{ width: 90 }} disabled={aplicado} />
        </td>
        <td>
          <input value={rakeTotal} onChange={(e) => { setRakeTotal(e.target.value); setPrevia(null); }} type="number" step="0.01" style={{ width: 90 }} disabled={aplicado} />
        </td>
        <td className="row-actions">
          {aplicado ? (
            <span className="badge pos">Cierre aplicado</span>
          ) : (
            <>
              <button className="btn secondary small" disabled={calculando} onClick={previsualizar}>
                {calculando ? "..." : "Previsualizar"}
              </button>
              {previa && (
                <button className="btn small" disabled={cerrando} onClick={confirmar}>
                  {cerrando ? "..." : "Confirmar"}
                </button>
              )}
            </>
          )}
        </td>
      </tr>
      {(error || previa) && (
        <tr>
          <td></td>
          <td colSpan={5}>
            {error && <div className="error">{error}</div>}
            {previa && (
              <div className="muted" style={{ display: "flex", gap: 16, flexWrap: "wrap", padding: "4px 0" }}>
                <span>Rakeback: <strong>{usd(previa.rakebackTotal)}</strong></span>
                <span>Makeup: {usd(previa.makeupAnterior)} → {usd(previa.makeupNuevo)}</span>
                <span>Pago total jugador: <strong>{usd(previa.pagoJugadorTotal)}</strong></span>
                <span>Ganancia banca mesas: {usd(previa.gananciaBancaMesas)}</span>
                <span>Capital después: <strong>{usd(previa.capitalDespues)}</strong></span>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
