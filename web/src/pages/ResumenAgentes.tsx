import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";

// "Resumen por agente" (23/09/2026, pedido de Leo): réplica del "Estado de cuenta semanal" que
// ya arma a mano en Excel (PDF de referencia "Cierre El Latigo Loco") -- elegís semana + uno o
// varios agentes y baja un PDF con, para cada agente: resumen por club, detalle por jugador
// (solo para cierres aplicados desde que este sistema empezó a guardarlo -- ver
// repo/closings.ts), subagentes (jugadores con % de rakeback propio) y estado de cuenta. Es de
// SOLO LECTURA: no cambia nada del sistema, ver repo/agentesResumen.ts.
//
// (29/09/2026, pedido de Leo: "misma lógica que Liquidaciones" + "poder ver el preview antes de
// descargar") -- ahora hay un botón "+ Armar resumen" como punto de partida (nunca se arranca
// solo con tildar un agente), un Nombre a mano (no autocompleta con el del agente -- puede
// combinar varias identidades de un mismo agente real bajo un nombre elegido, igual que
// Liquidaciones), y antes de bajar el PDF se ve en pantalla exactamente lo mismo que va a
// terminar en el archivo ("Ver preview"), con un botón para volver a editar si algo no cierra.
// El "combinar" solo afecta la portada (resumen por club + estado de cuenta, que se suman entre
// todos los agentes elegidos, igual que hace Liquidaciones con sus totales) -- el detalle por
// jugador y los subagentes siguen apareciendo por separado, cada uno bajo el nombre real del
// agente al que pertenecen, para no perder de dónde sale cada número.
export default function ResumenAgentes() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  // Tabs (01/10/2026, pedido de Leo: "que aparezcan todos los agentes con el saldo que tienen a
  // la fecha" -- separado a propósito del flujo de armar resumen semanal, que no cambia).
  const [vista, setVista] = useState<"armar" | "saldos">("armar");
  const [agentes, setAgentes] = useState<any[] | null>(null);
  const [semanas, setSemanas] = useState<string[] | null>(null);
  const [weekStart, setWeekStart] = useState("");
  const [query, setQuery] = useState("");
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [nombreGrupo, setNombreGrupo] = useState("");
  // Sistema (30/09/2026, pedido de Leo: "elegir antes de armar el resumen si va a ser winlose o
  // prepago, así queda más prolijo") -- se manda al backend, que ya usa esto para decidir cómo
  // calcular "Cierre semanal" en el estado de cuenta (ver repo/agentesResumen.ts): en Prepago el
  // resultado de juego no es responsabilidad del agente, así que el cierre semanal es solo el
  // rakeback neto, no el total club entero como en Win/Lose.
  const [sistema, setSistema] = useState<"WIN_LOSE" | "PREPAGO">("WIN_LOSE");
  const [armando, setArmando] = useState(false);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState("");

  // Historial de resúmenes guardados (30/09/2026, pedido de Leo: "que queden guardados" +
  // "automatico, pero con boton de borrar" + "filtro de fechas asi de ultima no vemos las
  // viejas") -- se guarda solo al bajar el PDF (ver descargarPdf), este bloque es solo para
  // VER/BORRAR lo ya guardado.
  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");
  const [borrandoHistId, setBorrandoHistId] = useState<string | null>(null);
  const [viendoHistId, setViendoHistId] = useState<string | null>(null);

  useEffect(() => {
    api.agentes().then(setAgentes);
    api.semanasConResumenAgente().then((s: string[]) => {
      setSemanas(s);
      if (s.length > 0) setWeekStart(s[0]);
    });
  }, []);

  function toggle(agentId: string) {
    setSeleccionados((s) => {
      const next = new Set(s);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }

  function cancelarArmado() {
    setArmando(false);
    setSeleccionados(new Set());
    setNombreGrupo("");
    setSistema("WIN_LOSE");
    setQuery("");
    setPreview(null);
    setError("");
  }

  const filtrados = (agentes ?? []).filter(
    (a: any) => !query.trim() || a.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  async function verPreview() {
    if (!nombreGrupo.trim()) return setError("Ponele un nombre a este resumen.");
    if (!weekStart) return setError("Elegí una semana.");
    if (seleccionados.size === 0) return setError("Elegí al menos un agente.");
    setCargandoPreview(true);
    setError("");
    try {
      const resultados = await Promise.all(
        Array.from(seleccionados).map((agentId) => api.resumenAgentePDF(agentId, weekStart, sistema).catch(() => null))
      );
      const datos = resultados.filter((r: any) => r);
      if (datos.length === 0) {
        setError("Ninguno de los agentes elegidos tiene un cierre aplicado en esa semana.");
        return;
      }
      setPreview(combinarResumen(datos, nombreGrupo.trim(), sistema));
    } catch (err: any) {
      setError(err.message || "No se pudo armar el preview.");
    } finally {
      setCargandoPreview(false);
    }
  }

  async function descargarPdf() {
    if (!preview) return;
    setGenerando(true);
    setError("");
    try {
      await generarResumenCombinadoPdf(preview);
      // Guardado AUTOMÁTICO en el historial al bajar el PDF (30/09/2026, pedido de Leo:
      // "automatico") -- best-effort: si esto falla, no rompe la descarga en sí, que ya se hizo
      // arriba -- solo se avisa aparte, sin bloquear nada.
      try {
        await api.guardarResumenHistorial({
          nombreGrupo: preview.nombreGrupo,
          agentIds: preview.porAgente.map((r: any) => r.agentId),
          weekStart: preview.weekStart,
          weekEnd: preview.weekEnd,
          sistema: preview.sistema,
          data: preview,
        });
        if (mostrarHistorial) cargarHistorial();
      } catch {
        setError("El PDF se bajó bien, pero no se pudo guardar en el historial.");
      }
    } catch (err: any) {
      setError(err.message || "No se pudo generar el PDF.");
    } finally {
      setGenerando(false);
    }
  }

  function cargarHistorial() {
    setCargandoHistorial(true);
    api
      .listResumenesHistorial(filtroDesde || undefined, filtroHasta || undefined)
      .then(setHistorial)
      .catch(() => setHistorial([]))
      .finally(() => setCargandoHistorial(false));
  }

  useEffect(() => {
    if (mostrarHistorial) cargarHistorial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarHistorial, filtroDesde, filtroHasta]);

  async function verHistorialItem(id: string) {
    setViendoHistId(id);
    setError("");
    try {
      const r: any = await api.getResumenHistorial(id);
      setPreview(r.data);
      setArmando(false);
      setMostrarHistorial(false);
    } catch (err: any) {
      setError(err.message || "No se pudo abrir ese resumen guardado.");
    } finally {
      setViendoHistId(null);
    }
  }

  async function borrarHistorialItem(id: string) {
    if (!(await confirmDialog("¿Borrar este resumen guardado? No afecta nada del sistema, solo el historial."))) return;
    setBorrandoHistId(id);
    try {
      await api.eliminarResumenHistorial(id);
      cargarHistorial();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo borrar.");
    } finally {
      setBorrandoHistId(null);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Resumen por agente</h2>
          <div className="muted">
            Estado de cuenta semanal en PDF -- resumen por club, detalle por jugador (para cierres cargados desde
            ahora en adelante), subagentes y saldo. Se pueden combinar varias identidades de un mismo agente bajo un
            nombre a elección, igual que en Liquidaciones.
          </div>
        </div>
      </div>

      <div className="tabs" style={{ display: "flex", gap: 6, margin: "14px 0" }}>
        <button type="button" className={`btn small ${vista === "armar" ? "" : "secondary"}`} onClick={() => setVista("armar")}>
          Armar resumen
        </button>
        <button type="button" className={`btn small ${vista === "saldos" ? "" : "secondary"}`} onClick={() => setVista("saldos")}>
          Saldos actuales
        </button>
      </div>

      {vista === "saldos" && <SaldosActuales />}

      {vista === "armar" && (
      <>
      {!armando && !preview && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn" onClick={() => setArmando(true)}>
              + Armar resumen
            </button>
            <button type="button" className="btn small" onClick={() => setMostrarHistorial((v) => !v)}>
              {mostrarHistorial ? "Ocultar historial" : "Ver historial"}
            </button>
          </div>

          {mostrarHistorial && (
            <div style={{ marginTop: 18 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 12 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Desde</label>
                  <input type="date" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Hasta</label>
                  <input type="date" value={filtroHasta} onChange={(e) => setFiltroHasta(e.target.value)} />
                </div>
                {(filtroDesde || filtroHasta) && (
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      setFiltroDesde("");
                      setFiltroHasta("");
                    }}
                  >
                    Limpiar filtro
                  </button>
                )}
                <div className="muted" style={{ fontSize: 12 }}>
                  Filtra por cuándo se guardó la foto (no por la semana que describe) -- así no ves pruebas viejas.
                </div>
              </div>

              {cargandoHistorial && <div className="muted">Cargando...</div>}
              {!cargandoHistorial && historial && historial.length === 0 && (
                <div className="muted">No hay resúmenes guardados {(filtroDesde || filtroHasta) && "en ese rango de fechas"}.</div>
              )}
              {!cargandoHistorial && historial && historial.length > 0 && (
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Guardado</th>
                      <th>Nombre</th>
                      <th>Semana</th>
                      <th>Sistema</th>
                      <th>Agentes</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((h: any) => (
                      <tr key={h.id}>
                        <td className="muted">{dateShort(h.created_at)}</td>
                        <td>{h.nombre_grupo}</td>
                        <td className="muted">
                          {dateShort(h.week_start)} - {dateShort(h.week_end)}
                        </td>
                        <td className="muted">{h.sistema === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
                        <td className="muted">{(h.agent_ids ?? []).length}</td>
                        <td style={{ display: "flex", gap: 6 }}>
                          <button type="button" className="btn small" disabled={viendoHistId === h.id} onClick={() => verHistorialItem(h.id)}>
                            {viendoHistId === h.id ? "Abriendo..." : "Ver"}
                          </button>
                          <button type="button" className="btn danger small" disabled={borrandoHistId === h.id} onClick={() => borrarHistorialItem(h.id)}>
                            {borrandoHistId === h.id ? "Borrando..." : "Borrar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {armando && !preview && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Nombre del resumen {seleccionados.size > 1 && "(varios agentes combinados)"}</label>
              <input value={nombreGrupo} onChange={(e) => setNombreGrupo(e.target.value)} placeholder="Ej: Prodigio" style={{ width: 220 }} autoFocus />
            </div>
            <button type="button" className="btn secondary small" onClick={cancelarArmado}>
              Cancelar
            </button>
          </div>

          <div className="field">
            <label>Sistema</label>
            <select value={sistema} onChange={(e) => setSistema(e.target.value as "WIN_LOSE" | "PREPAGO")}>
              <option value="WIN_LOSE">Win/Lose</option>
              <option value="PREPAGO">Prepago</option>
            </select>
          </div>

          <div className="field">
            <label>Semana</label>
            {!semanas ? (
              <span className="muted">Cargando...</span>
            ) : semanas.length === 0 ? (
              <span className="muted">Todavía no hay ningún cierre aplicado.</span>
            ) : (
              <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)}>
                {semanas.map((s) => (
                  <option key={s} value={s}>{dateShort(s)}</option>
                ))}
              </select>
            )}
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>Agentes ({seleccionados.size} elegido{seleccionados.size === 1 ? "" : "s"})</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar agente..." />
          </div>

          {!agentes ? (
            <div className="muted" style={{ marginTop: 10 }}>Cargando...</div>
          ) : (
            <>
              {filtrados.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn secondary small" onClick={() => setSeleccionados((s) => new Set([...s, ...filtrados.map((a: any) => a.id)]))}>
                    Seleccionar todos
                  </button>
                  <button className="btn secondary small" onClick={() => setSeleccionados((s) => new Set([...s].filter((id) => !filtrados.some((a: any) => a.id === id))))}>
                    Deseleccionar todos
                  </button>
                </div>
              )}
              <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {filtrados.map((a: any) => (
                  <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <input type="checkbox" checked={seleccionados.has(a.id)} onChange={() => toggle(a.id)} />
                    {a.name}
                  </label>
                ))}
                {filtrados.length === 0 && <div className="muted">Sin resultados.</div>}
              </div>
            </>
          )}

          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

          <button className="btn" style={{ marginTop: 14 }} disabled={cargandoPreview} onClick={verPreview}>
            {cargandoPreview ? "Armando preview..." : "Ver preview"}
          </button>
        </div>
      )}

      {preview && (
        <PreviewResumen
          preview={preview}
          generando={generando}
          error={error}
          onDescargar={descargarPdf}
          onVolver={() => setPreview(null)}
          onCancelar={cancelarArmado}
          onRefrescar={verPreview}
        />
      )}
      </>
      )}
    </div>
  );
}

// Junta el resumen por club y el estado de cuenta de todos los agentes elegidos en UNA sola
// portada (mismos totales que hoy suma Liquidaciones para combinar varias identidades de un
// mismo agente real) -- el detalle por jugador y los subagentes NO se combinan, quedan tal cual
// vinieron de cada agente (ver "porAgente" más abajo) para no perder a quién pertenece cada fila.
function combinarResumen(datos: any[], nombreGrupo: string, sistema: "WIN_LOSE" | "PREPAGO") {
  const clubesCombinado = datos.flatMap((r: any) => r.clubes);
  const sum = (fn: (r: any) => number) => datos.reduce((s: number, r: any) => s + fn(r), 0);
  const saldoAnterior = sum((r) => r.estadoCuenta.saldoAnterior);
  const cierreSemanal = sum((r) => r.estadoCuenta.cierreSemanal);
  const pagosPosteriores = sum((r) => r.estadoCuenta.pagosPosteriores);
  const saldoOperativoFinal = saldoAnterior + cierreSemanal + pagosPosteriores;
  // fichasAdelantadasPendientes (29/09/2026, pedido de Leo): ya está incluido en saldoAnterior
  // (ver ADELANTO_FICHAS en deltaParaBalance/repo/agentesResumen.ts) -- esto es solo para
  // mostrarlo aparte, así queda claro cuánto de ese saldo es por fichas adelantadas sin cobrar.
  const fichasAdelantadasPendientes = sum((r) => r.estadoCuenta.fichasAdelantadasPendientes);
  // Desglose de "Saldo anterior" (30/09/2026, pedido de Leo) -- se combina igual que el resto:
  // saldoFichasAntes se suma (es un número por agente), y pendientesAnterioresDetalle se
  // concatena etiquetando cada fila con el agente al que pertenece (necesario acá porque un
  // resumen combinado junta varios agentes bajo un mismo nombre -- sin la etiqueta no se podría
  // saber de dónde sale cada línea del detalle).
  const saldoFichasAntes = sum((r) => r.estadoCuenta.saldoFichasAntes);
  const pendientesAnterioresTotal = sum((r) => r.estadoCuenta.pendientesAnterioresTotal);
  const pendientesAnterioresDetalle = datos.flatMap((r: any) =>
    (r.estadoCuenta.pendientesAnterioresDetalle ?? []).map((d: any) => ({ ...d, agentName: r.agentName }))
  );
  // ajustesPendientesTotal/Detalle + movimientosAjustables (05/10/2026, pedido de Leo: "que un
  // ajuste pendiente se arrastre semana a semana en Saldo anterior hasta que se pague") -- se
  // combinan con el mismo criterio que pendientesAnterioresDetalle arriba: se suman, y el
  // detalle se concatena etiquetado con el agente al que pertenece.
  const ajustesPendientesTotal = sum((r) => r.estadoCuenta.ajustesPendientesTotal ?? 0);
  const ajustesPendientesDetalle = datos.flatMap((r: any) =>
    (r.estadoCuenta.ajustesPendientesDetalle ?? []).map((d: any) => ({ ...d, agentName: r.agentName }))
  );
  const movimientosAjustables = datos.flatMap((r: any) =>
    (r.estadoCuenta.movimientosAjustables ?? []).map((m: any) => ({ ...m, agentName: r.agentName, agentId: r.agentId }))
  );
  return {
    nombreGrupo,
    sistema,
    weekStart: datos[0].weekStart,
    weekEnd: datos[0].weekEnd,
    clubesCombinado,
    estadoCuentaCombinado: {
      saldoAnterior,
      cierreSemanal,
      pagosPosteriores,
      saldoOperativoFinal,
      nosDebe: saldoOperativoFinal < 0 ? -saldoOperativoFinal : 0,
      debemos: saldoOperativoFinal > 0 ? saldoOperativoFinal : 0,
      situacion: saldoOperativoFinal < 0 ? "AGENTE ENVÍA" : saldoOperativoFinal > 0 ? "NOSOTROS ENVIAMOS" : "AL DÍA",
      fichasAdelantadasPendientes,
      saldoFichasAntes,
      pendientesAnterioresTotal,
      pendientesAnterioresDetalle,
      ajustesPendientesTotal,
      ajustesPendientesDetalle,
      movimientosAjustables,
    },
    porAgente: datos,
  };
}

// Vista en pantalla de exactamente lo que va a bajar en el PDF (portada combinada + detalle por
// club de cada agente + subagentes) -- para poder revisarlo antes de descargar el archivo.
function PreviewResumen({
  preview,
  generando,
  error,
  onDescargar,
  onVolver,
  onCancelar,
  onRefrescar,
}: {
  preview: any;
  generando: boolean;
  error: string;
  onDescargar: () => void;
  onVolver: () => void;
  onCancelar: () => void;
  onRefrescar: () => void;
}) {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [marcandoId, setMarcandoId] = useState<string | null>(null);
  // marcarPendiente (05/10/2026, pedido de Leo: "que un ajuste pendiente se arrastre semana a
  // semana en Saldo anterior hasta que se pague, con posibilidad de volver todo para atras") --
  // toggle reversible: no mueve plata ni genera ningún movimiento, solo prende/apaga la bandera
  // que decide si ESTE AJUSTE/COBRO/PAGO puntual sigue arrastrándose en "Saldo anterior" la
  // semana que viene (ver marcarSaldoPendiente en repo/agentesResumen.ts). Se puede volver para
  // atrás en cualquier momento con el mismo botón.
  async function marcarPendiente(m: any, pendiente: boolean) {
    const verbo = pendiente ? "marcar" : "desmarcar";
    if (
      !(await confirmDialog(
        `¿${pendiente ? "Marcar" : "Desmarcar"} este ${m.type.toLowerCase()} de ${usd(m.amount)} (${m.agentName}) como pendiente? ${
          pendiente
            ? "Va a seguir sumando en \"Saldo anterior\" semana a semana hasta que lo desmarques."
            : "Deja de arrastrarse de acá en adelante -- se puede volver a marcar cuando quieras."
        }`
      ))
    ) {
      return;
    }
    setMarcandoId(m.id);
    try {
      await api.marcarSaldoPendiente(m.id, pendiente);
      onRefrescar();
    } catch (err: any) {
      await alertDialog(err.message || `No se pudo ${verbo} como pendiente.`);
    } finally {
      setMarcandoId(null);
    }
  }
  const mostrarRodeo = preview.clubesCombinado.some((c: any) => Number(c.rodeo) !== 0);
  const mostrarAjuste = preview.clubesCombinado.some((c: any) => Number(c.ajusteManual) !== 0);
  const sumClub = (fn: (c: any) => number) => preview.clubesCombinado.reduce((s: number, c: any) => s + fn(c), 0);
  const notasAjuste = preview.clubesCombinado.filter((c: any) => Number(c.ajusteManual) !== 0 && c.ajusteManualNota);
  const ec = preview.estadoCuentaCombinado;

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <strong>{preview.nombreGrupo}</strong>
          <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
            Cierre {dateShort(preview.weekStart)} - {dateShort(preview.weekEnd)} · {preview.sistema === "PREPAGO" ? "Prepago" : "Win/Lose"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn secondary small" onClick={onVolver}>
            Volver a editar
          </button>
          <button type="button" className="btn secondary small" onClick={onCancelar}>
            Cancelar
          </button>
        </div>
      </div>

      <h3 style={{ marginBottom: 8 }}>Resumen por club</h3>
      <table>
        <thead>
          <tr>
            <th>Club</th>
            <th className="num">Resultado</th>
            <th className="num">Rebate</th>
            <th className="num">Rakeback bruto</th>
            <th className="num">Rakeback neto</th>
            {mostrarRodeo && <th className="num">Rodeo</th>}
            {mostrarAjuste && <th className="num">Ajuste</th>}
            <th className="num">Total club</th>
          </tr>
        </thead>
        <tbody>
          {preview.clubesCombinado.map((c: any, i: number) => (
            <tr key={i}>
              <td>{c.clubName}</td>
              <td className="num money">{usd(c.resultado)}</td>
              <td className="num money">{usd(c.rebate)}</td>
              <td className="num money">{usd(c.rakebackBruto)}</td>
              <td className="num money">{usd(c.rakebackNeto)}</td>
              {mostrarRodeo && <td className="num money">{usd(c.rodeo)}</td>}
              {mostrarAjuste && <td className="num money">{usd(c.ajusteManual)}</td>}
              <td className="num money">{usd(c.totalClub)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td><strong>TOTAL SEMANAL</strong></td>
            <td className="num"><strong>{usd(sumClub((c) => c.resultado))}</strong></td>
            <td className="num"><strong>{usd(sumClub((c) => c.rebate))}</strong></td>
            <td className="num"><strong>{usd(sumClub((c) => c.rakebackBruto))}</strong></td>
            <td className="num"><strong>{usd(sumClub((c) => c.rakebackNeto))}</strong></td>
            {mostrarRodeo && <td className="num"><strong>{usd(sumClub((c) => c.rodeo))}</strong></td>}
            {mostrarAjuste && <td className="num"><strong>{usd(sumClub((c) => c.ajusteManual))}</strong></td>}
            <td className="num"><strong>{usd(sumClub((c) => c.totalClub))}</strong></td>
          </tr>
        </tfoot>
      </table>

      {notasAjuste.length > 0 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {notasAjuste.map((c: any, i: number) => (
            <div key={i}>Ajuste {c.clubName} ({usd(c.ajusteManual)}): {c.ajusteManualNota}</div>
          ))}
        </div>
      )}

      <h3 style={{ marginTop: 20, marginBottom: 8 }}>Estado de cuenta</h3>
      <table style={{ maxWidth: 420 }}>
        <tbody>
          <tr><td>Saldo anterior</td><td className="num money">{usd(ec.saldoAnterior)}</td></tr>
          <tr><td>Cierre semanal</td><td className="num money">{usd(ec.cierreSemanal)}</td></tr>
          <tr><td>Pagos / movimientos de la semana</td><td className="num money">{usd(ec.pagosPosteriores)}</td></tr>
          <tr><td><strong>Saldo operativo final</strong></td><td className="num"><strong>{usd(ec.saldoOperativoFinal)}</strong></td></tr>
          {/* (29/09/2026, pedido de Leo: "necesito poder ver las fichas que se le cargaron y
              estan pendiente de cobrar") -- solo Prepago, que es la modalidad que usa esto (ver
              nota en repo/advances.ts). Ya está incluido en Saldo anterior, se muestra aparte
              solo como referencia de cuánto de eso es por esto. */}
          {preview.sistema === "PREPAGO" && Number(ec.fichasAdelantadasPendientes) > 0 && (
            <tr><td className="muted">Fichas adelantadas pendientes de cobro</td><td className="num money muted">{usd(ec.fichasAdelantadasPendientes)}</td></tr>
          )}
          <tr><td>Nos debe</td><td className="num money">{usd(ec.nosDebe)}</td></tr>
          <tr><td>Debemos / saldo a favor</td><td className="num money">{usd(ec.debemos)}</td></tr>
          <tr><td>Situación</td><td>{ec.situacion}</td></tr>
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
        Saldo anterior = cargas/descargas/adelantos de fichas antes de esta semana ({usd(ec.saldoFichasAntes)}) +
        pendientes de cierres anteriores todavía sin pagar del todo ({usd(ec.pendientesAnterioresTotal)}) +
        ajustes marcados como pendientes ({usd(ec.ajustesPendientesTotal ?? 0)}).
      </div>

      {/* Desglose de "Saldo anterior" (30/09/2026, pedido de Leo: "necesito que me hagas un
          desglose de como se compone el saldo anterior y despues que se haga la suma") -- antes
          era un solo número sin forma de auditar de dónde salía. */}
      <h4 style={{ marginTop: 16, marginBottom: 6 }}>Desglose del saldo anterior</h4>
      <table style={{ maxWidth: 620 }}>
        <tbody>
          <tr>
            <td>Cargas / descargas / adelantos de fichas (antes de esta semana)</td>
            <td className="num money">{usd(ec.saldoFichasAntes)}</td>
          </tr>
          <tr>
            <td>Pendientes de cierres anteriores sin pagar del todo</td>
            <td className="num money">{usd(ec.pendientesAnterioresTotal)}</td>
          </tr>
          <tr>
            <td>Ajustes/cobros/pagos marcados como pendientes</td>
            <td className="num money">{usd(ec.ajustesPendientesTotal ?? 0)}</td>
          </tr>
          <tr>
            <td><strong>= Saldo anterior</strong></td>
            <td className="num"><strong>{usd(ec.saldoAnterior)}</strong></td>
          </tr>
        </tbody>
      </table>
      {ec.ajustesPendientesDetalle && ec.ajustesPendientesDetalle.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 4 }}>
            Detalle de los ajustes marcados como pendientes que componen el {usd(ec.ajustesPendientesTotal ?? 0)} de arriba:
          </div>
          <table style={{ maxWidth: 620 }}>
            <thead>
              <tr>
                {preview.porAgente.length > 1 && <th>Agente</th>}
                <th>Club</th>
                <th>Fecha</th>
                <th>Nota</th>
                <th className="num">Monto</th>
              </tr>
            </thead>
            <tbody>
              {ec.ajustesPendientesDetalle.map((d: any, i: number) => (
                <tr key={i}>
                  {preview.porAgente.length > 1 && <td className="muted">{d.agentName}</td>}
                  <td>{d.clubName}</td>
                  <td className="muted">{dateShort(d.occurredAt)}</td>
                  <td className="muted">{d.observation || "—"}</td>
                  <td className="num money">{usd(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Marcar/desmarcar manual (05/10/2026, pedido de Leo) -- lista los últimos AJUSTE/COBRO/
          PAGO/TICKET_PROMOCIONAL del agente hasta el fin de esta semana, para poder decidir cuál
          sigue siendo una deuda real (se marca "pendiente", se arrastra) y cuál ya se resolvió
          (queda sin marcar, desaparece la semana que viene como hasta ahora). */}
      {ec.movimientosAjustables && ec.movimientosAjustables.length > 0 && (
        <>
          <h4 style={{ marginTop: 16, marginBottom: 6 }}>Ajustes / cobros / pagos — marcar como pendiente</h4>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            Marcado como pendiente = sigue sumando en "Saldo anterior" semana a semana hasta que lo desmarques. Reversible en cualquier momento.
          </div>
          <table style={{ maxWidth: 760 }}>
            <thead>
              <tr>
                {preview.porAgente.length > 1 && <th>Agente</th>}
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Club</th>
                <th>Nota</th>
                <th className="num">Monto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ec.movimientosAjustables.map((m: any) => (
                <tr key={m.id}>
                  {preview.porAgente.length > 1 && <td className="muted">{m.agentName}</td>}
                  <td className="muted">{dateShort(m.occurredAt)}</td>
                  <td>{m.type}</td>
                  <td>{m.clubName}</td>
                  <td className="muted">{m.observation || "—"}</td>
                  <td className="num money">{usd(m.amount)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn secondary small"
                      disabled={marcandoId === m.id}
                      onClick={() => marcarPendiente(m, !m.saldoPendiente)}
                    >
                      {marcandoId === m.id ? "..." : m.saldoPendiente ? "Pendiente ✓ (desmarcar)" : "Marcar pendiente"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {ec.pendientesAnterioresDetalle && ec.pendientesAnterioresDetalle.length > 0 && (
        <>
          <div className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 4 }}>
            Detalle de los pendientes de cierres anteriores que componen el {usd(ec.pendientesAnterioresTotal)} de arriba:
          </div>
          <table style={{ maxWidth: 620 }}>
            <thead>
              <tr>
                {preview.porAgente.length > 1 && <th>Agente</th>}
                <th>Club</th>
                <th>Semana del cierre</th>
                <th className="num">Monto del pendiente</th>
                <th className="num">Ya pagado</th>
                <th className="num">Disponible</th>
              </tr>
            </thead>
            <tbody>
              {ec.pendientesAnterioresDetalle.map((d: any, i: number) => (
                <tr key={i}>
                  {preview.porAgente.length > 1 && <td className="muted">{d.agentName}</td>}
                  <td>{d.clubName}</td>
                  <td className="muted">{dateShort(d.weekStart)} - {dateShort(d.weekEnd)}</td>
                  <td className="num money">{usd(d.amount)}</td>
                  <td className="num money muted">{usd(d.consumed)}</td>
                  <td className="num money">{usd(d.disponible)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {preview.porAgente.map((r: any) => (
        <div key={r.agentId}>
          {r.detallePorClub
            .filter((club: any) => club.jugadores.length > 0)
            .map((club: any) =>
              club.jugadores.map((j: any, i: number) => (
                <div key={`${club.clubId}-${i}`} style={{ marginTop: 20 }}>
                  <h3 style={{ marginBottom: 4 }}>Jugador / cuenta: {j.playerName}</h3>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    Club: {club.clubName}
                    {j.subagenteName && <> · Subagente: {j.subagenteName}</>}
                  </div>
                  <table>
                    <thead>
                      <tr>
                        <th className="num">Resultado</th>
                        <th className="num">Rake</th>
                        <th className="num">Rebate {pct(j.rebatePct)}</th>
                        <th className="num">Rakeback {pct(j.rakebackPct)}</th>
                        <th className="num">Rakeback neto</th>
                        <th className="num">Cierre semanal</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="num money">{usd(j.resultado)}</td>
                        <td className="num money">{usd(j.rake)}</td>
                        <td className="num money">{usd(j.rebate)}</td>
                        <td className="num money">{usd(j.rakebackBruto)}</td>
                        <td className="num money">{usd(j.rakebackNeto)}</td>
                        <td className="num money">{usd(j.cierre)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <table style={{ maxWidth: 460, marginTop: 8 }}>
                    <tbody>
                      <tr><td>Resultado de juego</td><td className="num money">{usd(j.resultado)}</td></tr>
                      <tr><td>Rebate = (resultado + rake) × {pct(j.rebatePct)}</td><td className="num money">{usd(j.rebate)}</td></tr>
                      <tr><td>Rakeback bruto = rake × {pct(j.rakebackPct)}</td><td className="num money">{usd(j.rakebackBruto)}</td></tr>
                      <tr><td>Rakeback neto = rakeback + rebate</td><td className="num money">{usd(j.rakebackNeto)}</td></tr>
                      <tr><td><strong>Cierre semanal = resultado + rakeback neto</strong></td><td className="num"><strong>{usd(j.cierre)}</strong></td></tr>
                    </tbody>
                  </table>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    Cierre individual del período; no incluye saldo anterior ni pagos posteriores.
                  </div>
                </div>
              ))
            )}

          {r.subagentes.length > 0 && (
            <div>
              <h3 style={{ marginTop: 20, marginBottom: 8 }}>Liquidación de subagentes · {r.agentName}</h3>
              <table>
                <thead>
                  <tr>
                    <th>Subagente</th>
                    <th>Club</th>
                    <th className="num">Resultado</th>
                    <th className="num">Rake</th>
                    <th className="num">% RB principal</th>
                    <th className="num">RB principal</th>
                    <th className="num">% RB subagente</th>
                    <th className="num">RB subagente</th>
                    <th className="num">Margen principal</th>
                    <th className="num">Cierre subagente</th>
                    <th className="num">Impacto principal</th>
                  </tr>
                </thead>
                <tbody>
                  {r.subagentes.map((s: any, i: number) => (
                    <tr key={i}>
                      <td>{s.subagenteName}</td>
                      <td>{s.clubName}</td>
                      <td className="num money">{usd(s.resultado)}</td>
                      <td className="num money">{usd(s.rake)}</td>
                      <td className="num">{pct(s.rakebackPctPrincipal)}</td>
                      <td className="num money">{usd(s.rakebackPrincipal)}</td>
                      <td className="num">{pct(s.rakebackPctSubagente)}</td>
                      <td className="num money">{usd(s.rakebackSubagente)}</td>
                      <td className="num money">{usd(s.margenPrincipal)}</td>
                      <td className="num money">{usd(s.cierreSubagente)}</td>
                      <td className="num money">{usd(s.impactoPrincipal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                {r.subagentes.map((s: any, i: number) => (
                  <div key={i}>{s.subagenteName}: {s.jugadores.join(" + ")}.</div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

      <button className="btn" style={{ marginTop: 20 }} disabled={generando} onClick={onDescargar}>
        {generando ? "Generando..." : "Descargar PDF"}
      </button>
    </div>
  );
}

// Arma el PDF a partir de lo mismo que ya se ve en el preview: una portada combinada (resumen
// por club + estado de cuenta bajo el nombre elegido), seguida de una página por club con
// detalle de jugadores (si hay) y una página de subagentes, por cada agente original -- todo en
// UN SOLO archivo.
async function generarResumenCombinadoPdf(preview: any) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const margen = 14;

  function encabezado(titulo: string) {
    doc.setFillColor(40, 50, 90);
    doc.rect(0, 0, 210, 14, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(titulo, 105, 9.5, { align: "center" });
    doc.setTextColor(0);
  }

  let y = 22;

  // --- Portada combinada: estado de cuenta semanal ---
  encabezado("ESTADO DE CUENTA SEMANAL");
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Nombre", margen, y);
  doc.setFont("helvetica", "normal");
  doc.text(preview.nombreGrupo, margen + 26, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Período", margen, y);
  doc.setFont("helvetica", "normal");
  doc.text(`${dateShort(preview.weekStart)} al ${dateShort(preview.weekEnd)}`, margen + 26, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.text("Sistema", margen, y);
  doc.setFont("helvetica", "normal");
  doc.text(preview.sistema === "PREPAGO" ? "Prepago" : "Win/Lose", margen + 26, y);
  y += 8;

  const mostrarRodeo = preview.clubesCombinado.some((c: any) => Number(c.rodeo) !== 0);
  const mostrarAjuste = preview.clubesCombinado.some((c: any) => Number(c.ajusteManual) !== 0);
  const headResumen = [
    "Club", "Resultado", "Rebate", "Rakeback bruto", "Rakeback neto",
    ...(mostrarRodeo ? ["Rodeo"] : []), ...(mostrarAjuste ? ["Ajuste"] : []), "Total club",
  ];
  const bodyResumen = preview.clubesCombinado.map((c: any) => [
    c.clubName, usd(c.resultado), usd(c.rebate), usd(c.rakebackBruto), usd(c.rakebackNeto),
    ...(mostrarRodeo ? [usd(c.rodeo)] : []), ...(mostrarAjuste ? [usd(c.ajusteManual)] : []), usd(c.totalClub),
  ]);
  const sumClub = (fn: (c: any) => number) => preview.clubesCombinado.reduce((s: number, c: any) => s + fn(c), 0);
  const footResumen = [
    "TOTAL SEMANAL", usd(sumClub((c: any) => c.resultado)), usd(sumClub((c: any) => c.rebate)),
    usd(sumClub((c: any) => c.rakebackBruto)), usd(sumClub((c: any) => c.rakebackNeto)),
    ...(mostrarRodeo ? [usd(sumClub((c: any) => c.rodeo))] : []),
    ...(mostrarAjuste ? [usd(sumClub((c: any) => c.ajusteManual))] : []),
    usd(sumClub((c: any) => c.totalClub)),
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [headResumen],
    body: bodyResumen,
    foot: [footResumen],
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [40, 50, 90] },
    footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  const notasAjuste = preview.clubesCombinado.filter((c: any) => Number(c.ajusteManual) !== 0 && c.ajusteManualNota);
  if (notasAjuste.length > 0) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(90);
    notasAjuste.forEach((c: any) => {
      doc.text(`Ajuste ${c.clubName} (${usd(c.ajusteManual)}): ${c.ajusteManualNota}`, margen, y);
      y += 4;
    });
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
  }
  y += 6;

  const ec = preview.estadoCuentaCombinado;
  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Estado de cuenta", "Importe"]],
    body: [
      ["Saldo anterior", usd(ec.saldoAnterior)],
      ["Cierre semanal", usd(ec.cierreSemanal)],
      ["Pagos / movimientos de la semana", usd(ec.pagosPosteriores)],
      ["Saldo operativo final", usd(ec.saldoOperativoFinal)],
      ...(preview.sistema === "PREPAGO" && Number(ec.fichasAdelantadasPendientes) > 0
        ? [["Fichas adelantadas pendientes de cobro", usd(ec.fichasAdelantadasPendientes)]]
        : []),
      ["Nos debe", usd(ec.nosDebe)],
      ["Debemos / saldo a favor", usd(ec.debemos)],
      ["Situación", ec.situacion],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 50, 90] },
    didParseCell: (data: any) => {
      if (data.row.section === "body" && data.row.index === 3) data.cell.styles.fontStyle = "bold";
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;
  doc.setFontSize(7.5);
  doc.setTextColor(120);
  doc.text(
    `Saldo anterior = cargas/descargas/adelantos de fichas antes de esta semana (${usd(ec.saldoFichasAntes)}) + pendientes de cierres anteriores sin pagar del todo (${usd(ec.pendientesAnterioresTotal)}).`,
    margen,
    y
  );
  doc.setTextColor(0);
  y += 8;

  // Desglose de "Saldo anterior" (30/09/2026, pedido de Leo) -- misma tabla que se ve en
  // pantalla en el preview, ahora también en el PDF.
  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Desglose del saldo anterior", "Importe"]],
    body: [
      ["Cargas / descargas / adelantos de fichas (antes de esta semana)", usd(ec.saldoFichasAntes)],
      ["Pendientes de cierres anteriores sin pagar del todo", usd(ec.pendientesAnterioresTotal)],
      ["= Saldo anterior", usd(ec.saldoAnterior)],
    ],
    styles: { fontSize: 8.5 },
    headStyles: { fillColor: [40, 50, 90] },
    didParseCell: (data: any) => {
      if (data.row.section === "body" && data.row.index === 2) data.cell.styles.fontStyle = "bold";
    },
  });
  y = (doc as any).lastAutoTable.finalY + 4;

  if (ec.pendientesAnterioresDetalle && ec.pendientesAnterioresDetalle.length > 0) {
    const multi = preview.porAgente.length > 1;
    autoTable(doc, {
      startY: y,
      margin: { left: margen, right: margen },
      head: [[...(multi ? ["Agente"] : []), "Club", "Semana del cierre", "Monto", "Ya pagado", "Disponible"]],
      body: ec.pendientesAnterioresDetalle.map((d: any) => [
        ...(multi ? [d.agentName] : []),
        d.clubName,
        `${dateShort(d.weekStart)} - ${dateShort(d.weekEnd)}`,
        usd(d.amount),
        usd(d.consumed),
        usd(d.disponible),
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [90, 90, 100] },
    });
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  // --- Una página "ESTADO DE CUENTA SEMANAL" por JUGADOR (no una tabla combinada por club) --
  // réplica exacta del PDF de referencia que pasó Leo ("Cierre El Latigo Loco"): cada jugador
  // tiene su propia página con la tabla de resultado/rake/rebate/rakeback y el desglose
  // "Detalle del cálculo" paso a paso -- más varias filas juntas en una tabla, esto es lo que
  // hacía el sistema viejo que se está igualando acá (30/09/2026).
  for (const r of preview.porAgente) {
    for (const club of r.detallePorClub) {
      for (const j of club.jugadores) {
        doc.addPage();
        encabezado("ESTADO DE CUENTA SEMANAL");
        y = 22;
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Jugador / cuenta", margen, y);
        doc.setFont("helvetica", "normal");
        doc.text(String(j.playerName), margen + 38, y);
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.text("Período", margen, y);
        doc.setFont("helvetica", "normal");
        doc.text(`${dateShort(r.weekStart)} al ${dateShort(r.weekEnd)}`, margen + 38, y);
        y += 6;
        doc.setFont("helvetica", "bold");
        doc.text("Club", margen, y);
        doc.setFont("helvetica", "normal");
        doc.text(String(club.clubName), margen + 38, y);
        if (j.subagenteName) {
          y += 6;
          doc.setFont("helvetica", "bold");
          doc.text("Subagente", margen, y);
          doc.setFont("helvetica", "normal");
          doc.text(String(j.subagenteName), margen + 38, y);
        }
        y += 8;

        autoTable(doc, {
          startY: y,
          margin: { left: margen, right: margen },
          head: [["Resultado", "Rake", `Rebate ${pct(j.rebatePct)}`, `Rakeback ${pct(j.rakebackPct)}`, "Rakeback neto", "Cierre semanal"]],
          body: [[usd(j.resultado), usd(j.rake), usd(j.rebate), usd(j.rakebackBruto), usd(j.rakebackNeto), usd(j.cierre)]],
          styles: { fontSize: 9 },
          headStyles: { fillColor: [40, 50, 90] },
        });
        y = (doc as any).lastAutoTable.finalY + 8;

        autoTable(doc, {
          startY: y,
          margin: { left: margen, right: margen },
          head: [["Detalle del cálculo", "Importe"]],
          body: [
            ["Resultado de juego", usd(j.resultado)],
            [`Rebate = (resultado + rake) × ${pct(j.rebatePct)}`, usd(j.rebate)],
            [`Rakeback bruto = rake × ${pct(j.rakebackPct)}`, usd(j.rakebackBruto)],
            ["Rakeback neto = rakeback + rebate", usd(j.rakebackNeto)],
            ["Cierre semanal = resultado + rakeback neto", usd(j.cierre)],
          ],
          styles: { fontSize: 9 },
          headStyles: { fillColor: [40, 50, 90] },
          didParseCell: (data: any) => {
            if (data.row.section === "body" && data.row.index === 4) data.cell.styles.fontStyle = "bold";
          },
        });
        y = (doc as any).lastAutoTable.finalY + 4;
        doc.setFontSize(7.5);
        doc.setTextColor(120);
        doc.text("Cierre individual del período; no incluye saldo anterior ni pagos posteriores.", margen, y);
        doc.setTextColor(0);
      }
    }

    if (r.subagentes.length > 0) {
      doc.addPage();
      encabezado(`LIQUIDACIÓN DE SUBAGENTES · ${r.agentName.toUpperCase()}`);
      y = 26;
      autoTable(doc, {
        startY: y,
        margin: { left: margen, right: margen },
        head: [["Subagente", "Club", "Resultado", "Rake", "% RB principal", "RB principal", "% RB subagente", "RB subagente", "Margen principal", "Cierre subagente", "Impacto principal"]],
        body: r.subagentes.map((s: any) => [
          s.subagenteName, s.clubName, usd(s.resultado), usd(s.rake), pct(s.rakebackPctPrincipal), usd(s.rakebackPrincipal),
          pct(s.rakebackPctSubagente), usd(s.rakebackSubagente), usd(s.margenPrincipal), usd(s.cierreSubagente), usd(s.impactoPrincipal),
        ]),
        styles: { fontSize: 7.5 },
        headStyles: { fillColor: [40, 50, 90] },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
      doc.setFontSize(7.5);
      doc.setTextColor(120);
      for (const s of r.subagentes) {
        doc.text(`${s.subagenteName}: ${s.jugadores.join(" + ")}.`, margen, y);
        y += 4;
      }
      doc.setTextColor(0);
    }
  }

  const nombreArchivo = `Cierre_${preview.nombreGrupo.replace(/[^a-z0-9]+/gi, "-")}_${preview.weekStart}_al_${preview.weekEnd}.pdf`;
  doc.save(nombreArchivo);
}

// "Saldos actuales" (01/10/2026, pedido de Leo: "que aparezcan todos los agentes con el saldo
// que tienen a la fecha... quiero saber como se constituye el saldo del agente ahi en ese
// momento" -- ejemplo que dio: "cajerouy" con Saldo neto total US$ 1.528,19 y Adelantos
// pendientes US$ 620,00, que en realidad tendrían que netearse). Foto de HOY de todos los
// agentes activos, de solo lectura (ver repo/agentesResumen.ts, listSaldosActualesAgentes) --
// NO toca la función de armar resumen semanal de arriba, que sigue igual. Confirmado con Leo:
// esta resta (saldo neto total - adelantos pendientes = saldo real) es SOLO acá, no cambia la
// definición de "saldo" en ningún otro lugar del sistema.
type ColumnaOrdenSaldos = "nombre" | "saldoNetoTotal" | "adelantosPendientes" | "saldoReal";

function SaldosActuales() {
  const [datos, setDatos] = useState<any[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sistemaFiltro, setSistemaFiltro] = useState<"TODOS" | "WIN_LOSE" | "PREPAGO">("TODOS");
  const [mostrarEnCero, setMostrarEnCero] = useState(false);
  const [orden, setOrden] = useState<ColumnaOrdenSaldos>("saldoReal");
  const [ordenAsc, setOrdenAsc] = useState(false);
  const [expandido, setExpandido] = useState<string | null>(null);
  // Reconstruir a una fecha (01/10/2026, pedido de Leo: "agregar un filtro por fecha e ir
  // reconstruyendo los saldos, ya lo habiamos realizado en otra seccion" -- misma idea que
  // "Evolución del saldo"). Vacío = HOY (camino rápido, lee balances directo). Con fecha,
  // reconstruye cada agente desde el historial de movimientos -- tarda un poco más.
  const [fecha, setFecha] = useState("");

  function cargar(fechaElegida?: string) {
    setCargando(true);
    setError("");
    api
      .saldosActualesAgentes(fechaElegida || undefined)
      .then(setDatos)
      .catch((err: any) => setError(err.message || "No se pudieron cargar los saldos."))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onFechaChange(v: string) {
    setFecha(v);
    cargar(v);
  }

  function ordenarPor(col: ColumnaOrdenSaldos) {
    if (orden === col) {
      setOrdenAsc((v) => !v);
    } else {
      setOrden(col);
      setOrdenAsc(col === "nombre");
    }
  }

  function flecha(col: ColumnaOrdenSaldos) {
    if (orden !== col) return "";
    return ordenAsc ? " ▲" : " ▼";
  }

  const filtrados = (datos ?? [])
    .filter((a: any) => !query.trim() || a.agentName.toLowerCase().includes(query.trim().toLowerCase()))
    .filter((a: any) => sistemaFiltro === "TODOS" || a.defaultSystem === sistemaFiltro)
    .filter((a: any) => mostrarEnCero || a.saldoReal !== 0)
    .sort((a: any, b: any) => {
      const cmp = orden === "nombre" ? a.agentName.localeCompare(b.agentName) : a[orden] - b[orden];
      return ordenAsc ? cmp : -cmp;
    });

  const totales = filtrados.reduce(
    (acc: any, a: any) => ({
      saldoNetoTotal: acc.saldoNetoTotal + a.saldoNetoTotal,
      adelantosPendientes: acc.adelantosPendientes + a.adelantosPendientes,
      saldoReal: acc.saldoReal + a.saldoReal,
    }),
    { saldoNetoTotal: 0, adelantosPendientes: 0, saldoReal: 0 }
  );

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="muted" style={{ marginBottom: 12 }}>
        Foto de HOY de todos los agentes activos -- no afecta nada del sistema. "Saldo real" descuenta del saldo
        neto total (fichas + resultado de mesas para Prepago) los adelantos de rakeback todavía pendientes de
        cobrar. Esta resta es solo acá, en esta pantalla -- en el resto del sistema "Saldo neto total" y
        "Adelantos pendientes" se siguen mostrando por separado, sin netear.
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <input
          placeholder="Buscar agente..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <button className={`chip${sistemaFiltro === "TODOS" ? " chip-active" : ""}`} onClick={() => setSistemaFiltro("TODOS")}>
            Todos
          </button>
          <button className={`chip${sistemaFiltro === "PREPAGO" ? " chip-active" : ""}`} onClick={() => setSistemaFiltro("PREPAGO")}>
            Prepago
          </button>
          <button className={`chip${sistemaFiltro === "WIN_LOSE" ? " chip-active" : ""}`} onClick={() => setSistemaFiltro("WIN_LOSE")}>
            Win/Lose
          </button>
        </div>
        <label className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={mostrarEnCero} onChange={(e) => setMostrarEnCero(e.target.checked)} />
          Mostrar en cero
        </label>
        <div className="field" style={{ margin: 0 }}>
          <label className="muted" style={{ fontSize: 11, display: "block" }}>Reconstruir a la fecha</label>
          <input type="date" value={fecha} onChange={(e) => onFechaChange(e.target.value)} />
        </div>
        {fecha && (
          <button type="button" className="btn secondary small" onClick={() => onFechaChange("")}>
            Volver a hoy
          </button>
        )}
        <button type="button" className="btn secondary small" onClick={() => cargar(fecha)} disabled={cargando}>
          {cargando ? "Actualizando..." : "Actualizar"}
        </button>
        <div className="muted" style={{ fontSize: 12, marginLeft: "auto" }}>
          {filtrados.length} agente{filtrados.length === 1 ? "" : "s"}
        </div>
      </div>

      {fecha && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Mostrando el saldo reconstruido tal como estaba el {dateShort(fecha)} -- no el de hoy.
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {cargando && !datos && <div className="muted">Cargando...</div>}

      {datos && (
        <table>
          <thead>
            <tr>
              <th className="row-click" onClick={() => ordenarPor("nombre")}>
                Agente{flecha("nombre")}
              </th>
              <th>Sistema</th>
              <th className="row-click" onClick={() => ordenarPor("saldoNetoTotal")}>
                Saldo neto total{flecha("saldoNetoTotal")}
              </th>
              <th className="row-click" onClick={() => ordenarPor("adelantosPendientes")}>
                Adelantos pendientes{flecha("adelantosPendientes")}
              </th>
              <th className="row-click" onClick={() => ordenarPor("saldoReal")}>
                Saldo real{flecha("saldoReal")}
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((a: any) => (
              <FilaAgenteSaldo
                key={a.agentId}
                agente={a}
                expandido={expandido === a.agentId}
                onToggle={() => setExpandido((e) => (e === a.agentId ? null : a.agentId))}
              />
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Sin agentes para este filtro.
                </td>
              </tr>
            )}
          </tbody>
          {filtrados.length > 0 && (
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={2}>Total ({filtrados.length})</td>
                <td className={totales.saldoNetoTotal >= 0 ? "money pos" : "money neg"}>{usd(totales.saldoNetoTotal)}</td>
                <td className="money neg">{usd(totales.adelantosPendientes)}</td>
                <td className={totales.saldoReal >= 0 ? "money pos" : "money neg"}>{usd(totales.saldoReal)}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
    </div>
  );
}

// Fila expandible: al hacer click muestra el desglose completo de "cómo se constituye el saldo"
// (pedido explícito de Leo) -- saldo por club y el detalle itemizado de cada adelanto pendiente.
function FilaAgenteSaldo({ agente, expandido, onToggle }: { agente: any; expandido: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="row-click" onClick={onToggle}>
        <td>
          {agente.agentName}
          {agente.supervisor ? (
            <span className="muted" style={{ fontSize: 11 }}>
              {" "}
              · sup: {agente.supervisor}
            </span>
          ) : (
            ""
          )}
        </td>
        <td className="muted">{agente.defaultSystem === "PREPAGO" ? "Prepago" : "Win/Lose"}</td>
        <td className={agente.saldoNetoTotal >= 0 ? "money pos" : "money neg"}>{usd(agente.saldoNetoTotal)}</td>
        <td className={agente.adelantosPendientes !== 0 ? "money neg" : "muted"}>
          {agente.adelantosPendientes !== 0 ? usd(agente.adelantosPendientes) : "—"}
        </td>
        <td className={agente.saldoReal >= 0 ? "money pos" : "money neg"} style={{ fontWeight: 600 }}>
          {usd(agente.saldoReal)}
        </td>
        <td className="muted" style={{ fontSize: 12 }}>
          {expandido ? "▲ ocultar" : "▼ detalle"}
        </td>
      </tr>
      {expandido && (
        <tr>
          <td colSpan={6} style={{ background: "rgba(127,127,127,0.07)", padding: "10px 16px" }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div style={{ minWidth: 240 }}>
                <div className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>
                  Saldo por club
                </div>
                {agente.saldoPorClub.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Sin saldo cargado.
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Club</th>
                        <th>Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agente.saldoPorClub.map((b: any) => (
                        <tr key={b.clubId}>
                          <td>{b.clubName}</td>
                          <td className={b.saldoNeto >= 0 ? "money pos" : "money neg"}>{usd(b.saldoNeto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div style={{ minWidth: 340 }}>
                <div className="muted" style={{ fontWeight: 600, marginBottom: 6 }}>
                  Adelantos pendientes
                </div>
                {agente.adelantos.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Sin adelantos pendientes.
                  </div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Medio</th>
                        <th>Club origen</th>
                        <th>Monto</th>
                        <th>Consumido</th>
                        <th>Disponible</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agente.adelantos.map((ad: any) => (
                        <tr key={ad.id}>
                          <td>{dateShort(ad.createdAt)}</td>
                          <td className="muted">{ad.medio ?? "—"}</td>
                          <td className="muted">{ad.clubOrigenName ?? "—"}</td>
                          <td>{usd(ad.amount)}</td>
                          <td className="muted">{usd(ad.consumed)}</td>
                          <td className="money neg">{usd(ad.disponible)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
