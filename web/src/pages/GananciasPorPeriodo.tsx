import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import Modal from "../components/Modal";
import { useConfirmDialog } from "../components/ConfirmProvider";
import Loading from "../components/Loading";
import Cifra from "../components/Cifra";
import { Contexto } from "../components/Identidad";

// Recreación de las pestañas GANANCIAS_POR_PERIODO + AJUSTES EXTRAORDINARIOS de la planilla
// (15/09/2026). Un período agrupa semanas ya cerradas bajo un nombre ("Agosto 2026") y, al
// cerrarlo, congela los números — ganancia operativa (ya sale de nuestros propios cierres),
// retiros/gastos/ingresos de Cuentas de socios en ese rango de fechas, y una cuota de cada
// ajuste extraordinario todavía activo (pérdidas/retenciones que se amortizan de a poco contra
// la ganancia de DigiPlayers).

export default function GananciasPorPeriodo() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [periodos, setPeriodos] = useState<any[] | null>(null);
  const [ajustes, setAjustes] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [showNuevoPeriodo, setShowNuevoPeriodo] = useState(false);
  const [showDetalle, setShowDetalle] = useState<string | null>(null);
  const [showNuevoAjuste, setShowNuevoAjuste] = useState(false);
  const [showEditarAjuste, setShowEditarAjuste] = useState<any | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showRevision, setShowRevision] = useState<string | null>(null);

  function refresh() {
    setError("");
    api.periodos().then(setPeriodos).catch((e) => setError(e.message));
    api.ajustesExtraordinarios().then(setAjustes).catch(() => {});
  }

  useEffect(() => {
    refresh();
  }, []);

  // Cerrar pasa siempre por la revisión previa (RevisionCierre), que es la que cierra.
  function cerrar(p: any) {
    setShowRevision(p.id);
  }

  async function reabrir(p: any) {
    if (!(await confirmDialog(`¿Reabrir el período "${p.name}"? Le devuelve la cuota consumida a cada ajuste que tocó. Solo hacé esto en orden — del más nuevo cerrado hacia atrás.`))) return;
    setBusy(p.id);
    try {
      await api.reabrirPeriodo(p.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo reabrir el período.");
    } finally {
      setBusy(null);
    }
  }

  async function eliminarPeriodo(p: any) {
    if (!(await confirmDialog(`¿Eliminar el período "${p.name}"? No se puede deshacer.`))) return;
    setBusy(p.id);
    try {
      await api.eliminarPeriodo(p.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar el período.");
    } finally {
      setBusy(null);
    }
  }

  async function eliminarAjuste(a: any) {
    if (!(await confirmDialog(`¿Eliminar el ajuste "${a.descripcion}"? No se puede deshacer.`))) return;
    setBusy(a.id);
    try {
      await api.eliminarAjusteExtraordinario(a.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar el ajuste.");
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Ganancias por período: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!periodos || !ajustes) return <Loading />;

  return (
    <div style={{ marginTop: 16 }}>
      <div className="topbar">
        <div>
          <Contexto
            chips={[
              { texto: `${periodos.length} período${periodos.length === 1 ? "" : "s"} · ${periodos.filter((p) => p.status === "CERRADO").length} cerrado${periodos.filter((p) => p.status === "CERRADO").length === 1 ? "" : "s"}` },
              periodos.some((p) => p.status === "ABIERTO") && {
                texto: `Abierto: ${periodos.filter((p) => p.status === "ABIERTO").map((p) => p.name).join(", ")}`,
                tono: "alerta",
              },
            ]}
          />
          <div className="muted" style={{ marginTop: 10, maxWidth: 820 }}>
            Agrupá semanas ya cerradas bajo un nombre (ej. "Agosto 2026") para ver la ganancia neta de ese tramo --
            descontando retiros, gastos y las cuotas de ajustes extraordinarios pendientes. "Ganancia operativa" acá
            es exactamente la misma cuenta (cierres + bancados) que ya ves en la pestaña "Resumen" de arriba, para
            esas mismas semanas. Al cerrar un período, los números quedan congelados como foto histórica.
          </div>
        </div>
        <button className="btn" onClick={() => setShowNuevoPeriodo(true)}>+ Nuevo período</button>
      </div>

      <div className="panel">
        <h3>Períodos</h3>
        {periodos.length === 0 ? (
          <div className="muted">Todavía no hay ningún período creado.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Nombre</th><th>Semanas</th><th>Estado</th><th className="num">Ganancia neta final</th><th>Cerrado</th><th></th></tr>
            </thead>
            <tbody>
              {periodos.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.semanas?.length ?? 0}</td>
                  <td><span className={`badge ${p.status === "CERRADO" ? "pos" : "neutral"}`}>{p.status === "CERRADO" ? "Cerrado" : "Abierto"}</span></td>
                  <td className="num">{p.ganancia_neta_final !== null ? <span className={Number(p.ganancia_neta_final) >= 0 ? "pos" : "neg"}>{usd(p.ganancia_neta_final)}</span> : <span className="muted">—</span>}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{p.closed_at ? dateShort(p.closed_at) : "—"}</td>
                  <td className="row-actions">
                    <button className="btn secondary small" onClick={() => setShowDetalle(p.id)}>Ver</button>
                    {p.status === "ABIERTO" ? (
                      <button className="btn secondary small" disabled={busy === p.id} onClick={() => cerrar(p)}>{busy === p.id ? "..." : "Cerrar"}</button>
                    ) : (
                      <button className="btn secondary small" disabled={busy === p.id} onClick={() => reabrir(p)}>{busy === p.id ? "..." : "Reabrir"}</button>
                    )}
                    <button
                      className="btn secondary small"
                      disabled={busy === p.id}
                      onClick={() => eliminarPeriodo(p)}
                      style={{ color: "var(--red)" }}
                    >
                      {busy === p.id ? "..." : "Eliminar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="topbar" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Ajustes extraordinarios</h3>
          <button className="btn secondary small" onClick={() => setShowNuevoAjuste(true)}>+ Nuevo ajuste</button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Pérdidas o retenciones extraordinarias (fichas confiscadas, retención de club, etc.) cuya parte a cargo de
          DigiPlayers se descuenta de a cuotas contra la ganancia de los próximos períodos que se vayan cerrando.
        </div>
        {ajustes.length === 0 ? (
          <div className="muted">No hay ajustes extraordinarios cargados.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th className="num">Absorbe DP</th><th>Cuotas</th><th className="num">Próxima cuota</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {ajustes.map((a) => (
                <tr key={a.id}>
                  <td>{dateShort(a.occurred_at)}</td>
                  <td>{a.tipo}</td>
                  <td style={{ maxWidth: 320 }} title={a.descripcion}>{a.descripcion}</td>
                  <td className="num money">{usd(a.absorbe_digiplayers)}</td>
                  <td>{a.periodos_aplicados} / {a.periodos_totales}</td>
                  <td className="num">{a.estado === "ACTIVO" ? usd(a.proximaCuota) : <span className="muted">—</span>}</td>
                  <td><span className={`badge ${a.estado === "ACTIVO" ? "neutral" : "pos"}`}>{a.estado === "ACTIVO" ? "Activo" : "Finalizado"}</span></td>
                  <td className="row-actions">
                    <button className="btn secondary small" onClick={() => setShowEditarAjuste(a)}>Editar</button>
                    <button
                      className="btn secondary small"
                      disabled={busy === a.id}
                      onClick={() => eliminarAjuste(a)}
                      style={{ color: "var(--red)" }}
                    >
                      {busy === a.id ? "..." : "Eliminar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNuevoPeriodo && (
        <Modal title="Nuevo período" onClose={() => setShowNuevoPeriodo(false)} wide>
          <NuevoPeriodoForm
            onDone={() => {
              setShowNuevoPeriodo(false);
              refresh();
            }}
          />
        </Modal>
      )}

      {showDetalle && (
        <Modal title="Detalle del período" onClose={() => setShowDetalle(null)} wide>
          <PeriodoDetalle id={showDetalle} onChanged={refresh} />
        </Modal>
      )}

      {showRevision && (
        <Modal title="Revisión antes de cerrar" onClose={() => setShowRevision(null)} wide>
          <RevisionCierre
            id={showRevision}
            onCerrado={() => {
              setShowRevision(null);
              refresh();
            }}
          />
        </Modal>
      )}

      {showNuevoAjuste && (
        <Modal title="Nuevo ajuste extraordinario" onClose={() => setShowNuevoAjuste(false)}>
          <AjusteForm
            onDone={() => {
              setShowNuevoAjuste(false);
              refresh();
            }}
          />
        </Modal>
      )}

      {showEditarAjuste && (
        <Modal title="Editar ajuste extraordinario" onClose={() => setShowEditarAjuste(null)}>
          <AjusteForm
            ajuste={showEditarAjuste}
            onDone={() => {
              setShowEditarAjuste(null);
              refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function ResumenPreview({ preview }: { preview: any }) {
  if (!preview) return null;
  return (
    <div className="kpi-grid" style={{ marginTop: 12 }}>
      <div className="kpi-card">
        <div className="label">Ganancia cierres</div>
        <div className="value">{usd(preview.gananciaCierres)}</div>
      </div>
      <div className="kpi-card">
        <div className="label">Ganancia bancados</div>
        <div className="value">{usd(preview.gananciaBancados)}</div>
      </div>
      <div className="kpi-card">
        <div className="label">Ganancia operativa (cierres + bancados)</div>
        <div className="value">{usd(preview.gananciaOperativa)}</div>
      </div>
      <div className="kpi-card">
        <div className="label">Retiros</div>
        <div className="value">{usd(preview.retiros)}</div>
      </div>
      <div className="kpi-card">
        <div className="label">Gastos operativos</div>
        <div className="value">{usd(preview.gastos)}</div>
      </div>
      <div className="kpi-card">
        <div className="label">Ingresos/ajustes</div>
        <div className="value">{usd(preview.ingresosAjustes)}</div>
      </div>
      <div className="kpi-card">
        <div className="label">Ganancia antes de ajustes DP</div>
        <div className="value">{usd(preview.gananciaAntesAjustesDp)}</div>
      </div>
      <div className="kpi-card">
        <div className="label">Ajustes extraordinarios DP</div>
        <div className="value">{usd(preview.ajustesExtraordinariosDp)}</div>
        {preview.ajustesExtraordinariosDetalle?.length > 0 && (
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {preview.ajustesExtraordinariosDetalle.map((d: any) => (
              <div key={d.id}>{d.descripcion}: {usd(d.cuota)}</div>
            ))}
          </div>
        )}
      </div>
      <div className="kpi-card">
        <div className="label">Ganancia neta final</div>
        <div className={`value ${Number(preview.gananciaNetaFinal) >= 0 ? "pos" : "neg"}`}><Cifra texto={usd(preview.gananciaNetaFinal)} /></div>
      </div>
    </div>
  );
}

function NuevoPeriodoForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [semanas, setSemanas] = useState<any[] | null>(null);
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);
  const [preview, setPreview] = useState<any | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.semanasDisponiblesPeriodo().then(setSemanas).catch(() => setSemanas([]));
  }, []);

  useEffect(() => {
    if (seleccionadas.length === 0) {
      setPreview(null);
      return;
    }
    api.previewPeriodo(seleccionadas).then(setPreview).catch(() => setPreview(null));
  }, [seleccionadas.join(",")]);

  function toggleSemana(ws: string) {
    setSeleccionadas((prev) => (prev.includes(ws) ? prev.filter((x) => x !== ws) : [...prev, ws]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "El nombre es obligatorio." });
    if (seleccionadas.length === 0) return setMsg({ ok: false, text: "Elegí al menos una semana." });
    setLoading(true);
    try {
      await api.crearPeriodo(name.trim(), seleccionadas);
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo crear el período." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label>Nombre del período</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Agosto 2026" />
      </div>
      <div className="field">
        <label>Semanas (elegí las que forman este período)</label>
        {!semanas ? (
          <div className="muted">Cargando semanas...</div>
        ) : semanas.length === 0 ? (
          <div className="muted">No hay semanas con cierres cargados todavía.</div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <button type="button" className="btn secondary small" onClick={() => setSeleccionadas(semanas.map((s) => s.week_start))}>
                Seleccionar todas
              </button>
              <button type="button" className="btn secondary small" onClick={() => setSeleccionadas([])}>
                Deseleccionar todas
              </button>
            </div>
          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
            {semanas.map((s) => (
              <label key={s.week_start} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={seleccionadas.includes(s.week_start)} onChange={() => toggleSemana(s.week_start)} />
                {dateShort(s.week_start)} al {dateShort(s.week_end)}
              </label>
            ))}
          </div>
          </>
        )}
      </div>

      <ResumenPreview preview={preview} />

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading} style={{ marginTop: 12 }}>{loading ? "Creando..." : "Crear período"}</button>
    </form>
  );
}

function PeriodoDetalle({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [periodo, setPeriodo] = useState<any | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [revisando, setRevisando] = useState(false);

  function load() {
    api.periodoDetalle(id).then((p) => {
      setPeriodo(p);
      if (p.status === "ABIERTO" && p.semanas?.length) {
        api.previewPeriodo(p.semanas).then(setPreview).catch(() => setPreview(null));
      }
    });
  }

  useEffect(() => {
    load();
  }, [id]);

  if (!periodo) return <Loading />;

  function cerrar() {
    setRevisando(true);
  }

  async function reabrir() {
    if (!(await confirmDialog(`¿Reabrir "${periodo.name}"?`))) return;
    setBusy(true);
    try {
      await api.reabrirPeriodo(id);
      load();
      onChanged();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo reabrir el período.");
    } finally {
      setBusy(false);
    }
  }

  const cerrado = periodo.status === "CERRADO";
  const numeros = cerrado
    ? {
        gananciaOperativa: periodo.ganancia_operativa,
        gananciaCierres: periodo.ganancia_cierres,
        gananciaBancados: periodo.ganancia_bancados,
        retiros: periodo.retiros,
        gastos: periodo.gastos,
        ingresosAjustes: periodo.ingresos_ajustes,
        gananciaAntesAjustesDp: periodo.ganancia_antes_ajustes_dp,
        ajustesExtraordinariosDp: periodo.ajustes_extraordinarios_dp,
        ajustesExtraordinariosDetalle: periodo.ajustesAplicados?.map((a: any) => ({ id: a.id, descripcion: a.descripcion, cuota: a.amount })),
        gananciaNetaFinal: periodo.ganancia_neta_final,
      }
    : preview;

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 4 }}>
        <div>
          <h3 style={{ margin: 0 }}>{periodo.name}</h3>
          <span className={`badge ${cerrado ? "pos" : "neutral"}`}>{cerrado ? "Cerrado" : "Abierto"}</span>
        </div>
        {cerrado ? (
          <button className="btn secondary small" disabled={busy} onClick={reabrir}>{busy ? "..." : "Reabrir"}</button>
        ) : (
          <button className="btn small" disabled={busy} onClick={cerrar}>{busy ? "..." : "Cerrar período"}</button>
        )}
      </div>

      <ResumenPreview preview={numeros} />

      <SueldoManos
        sueldo={cerrado ? periodo.sueldoManos : null}
        previa={!cerrado ? preview?.sueldoManos : null}
        gananciaNetaFinal={numeros?.gananciaNetaFinal}
        onChanged={() => {
          load();
          onChanged();
        }}
      />

      {revisando && (
        <Modal title="Revisión antes de cerrar" onClose={() => setRevisando(false)} wide>
          <RevisionCierre
            id={id}
            onCerrado={() => {
              setRevisando(false);
              load();
              onChanged();
            }}
          />
        </Modal>
      )}

      <h4 style={{ marginTop: 20 }}>Detalle por semana y club</h4>
      {periodo.detalle?.length === 0 ? (
        <div className="muted">Sin cierres en las semanas elegidas.</div>
      ) : (
        <table>
          <thead><tr><th>Semana</th><th>Club</th><th>Tipo</th><th className="num">Ganancia</th></tr></thead>
          <tbody>
            {periodo.detalle?.map((d: any, i: number) => (
              <tr key={i}>
                <td>{dateShort(d.week_start)} al {dateShort(d.week_end)}</td>
                <td>{d.club_name}</td>
                <td className="muted">{d.tipo === "BANCADO" ? "Bancado" : "Cierre"}</td>
                <td className="num money">{usd(d.ganancia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// Revisión antes de cerrar (03/11/2026, pedido de Leo): muestra lo que se va a congelar y los
// chequeos del backend (revisionCierrePeriodo). Una alerta no bloquea: pide tildar que se revisó.
function RevisionCierre({ id, onCerrado }: { id: string; onCerrado: () => void }) {
  const { alertDialog } = useConfirmDialog();
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState("");
  const [revisado, setRevisado] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    api.revisionCierrePeriodo(id).then(setData).catch((e) => setError(e.message || "No se pudo armar la revisión."));
  }, [id]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <Loading />;

  const alertas = data.chequeos.filter((c: any) => c.estado === "ALERTA").length;
  const s = data.numeros.sueldoManos;

  async function cerrar() {
    setCerrando(true);
    try {
      await api.cerrarPeriodo(id);
      onCerrado();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo cerrar el período.");
    } finally {
      setCerrando(false);
    }
  }

  return (
    <div>
      <h3 style={{ margin: 0 }}>{data.periodo.name}</h3>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Esto es lo que va a quedar congelado al cerrar. Todavía no se guardó nada.
      </div>

      <ResumenPreview preview={data.numeros} />

      <div className="kpi-grid" style={{ marginTop: 12 }}>
        <div className="kpi-card">
          <div className="label">Sueldo Manos</div>
          <div className="value">{usd(s.sueldo)}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{s.aplicaMinimo ? "mínimo de US$ 400" : "10% de la ganancia neta final"}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Ganancia disponible para socios</div>
          <div className={`value ${Number(s.gananciaDisponibleSocios) >= 0 ? "pos" : "neg"}`}><Cifra texto={usd(s.gananciaDisponibleSocios)} /></div>
        </div>
      </div>

      <h4 style={{ marginTop: 20 }}>Chequeos {alertas > 0 ? <span className="badge neg">{alertas} con alertas</span> : <span className="badge pos">Todo bien</span>}</h4>
      {data.chequeos.map((c: any) => (
        <div key={c.id} className="panel" style={{ marginTop: 8, padding: 12, borderLeft: `4px solid var(${c.estado === "OK" ? "--green" : "--red"})` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`badge ${c.estado === "OK" ? "pos" : "neg"}`}>{c.estado === "OK" ? "OK" : "Revisar"}</span>
            <strong>{c.titulo}</strong>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{c.resumen}</div>
          {c.items.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
              {c.items.map((it: string, i: number) => <li key={i}>{it}</li>)}
            </ul>
          )}
        </div>
      ))}

      <h4 style={{ marginTop: 20 }}>Movimientos de socios que entran</h4>
      {data.movimientos.length === 0 ? (
        <div className="muted">Ninguno en el rango del período.</div>
      ) : (
        <table>
          <thead><tr><th>Fecha</th><th>Cuenta</th><th>Categoría</th><th>Concepto</th><th className="num">Monto</th></tr></thead>
          <tbody>
            {data.movimientos.map((m: any) => (
              <tr key={m.id}>
                <td>{dateShort(m.fecha)}</td>
                <td>{m.cuenta}</td>
                <td className="muted">{m.category === "GASTO" ? "Gasto" : m.category === "RETIRO" ? "Retiro" : "Ajuste"}</td>
                <td>{m.concept}</td>
                <td className={`num money ${m.category !== "AJUSTE" && m.amount < 0 ? "neg" : ""}`}>{usd(m.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {alertas > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} />
            Revisé las alertas y quiero cerrar igual
          </label>
        )}
        <button className="btn" disabled={cerrando || (alertas > 0 && !revisado)} onClick={cerrar}>
          {cerrando ? "Cerrando..." : "Cerrar período"}
        </button>
      </div>
    </div>
  );
}

// Sueldo de Manos (03/11/2026): 10% de la ganancia neta final, mínimo US$ 400. Con el período
// abierto es solo una vista previa; al cerrarlo queda guardado como PENDIENTE y se paga desde acá
// (Juan lo paga en pesos: le baja la deuda, no mueve Wallet Manos). Ver repo/sueldoManos.ts.
const ESTADOS_SUELDO: Record<string, { texto: string; clase: string }> = {
  PENDIENTE: { texto: "Pendiente", clase: "neutral" },
  PAGADO: { texto: "Pagado", clase: "pos" },
  REVISAR_DIFERENCIA: { texto: "Revisar diferencia", clase: "neg" },
  REQUIERE_REVISION: { texto: "Requiere revisión", clase: "neg" },
};

function SueldoManos({ sueldo, previa, gananciaNetaFinal, onChanged }: { sueldo: any | null; previa: any | null; gananciaNetaFinal: any; onChanged: () => void }) {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [pagando, setPagando] = useState(false);
  const [complemento, setComplemento] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!sueldo && !previa) return null;

  const base = sueldo ? Number(sueldo.base_calculo_usdt) : Number(previa.base);
  const importe = sueldo ? Number(sueldo.sueldo_usdt) : Number(previa.sueldo);
  const disponible = sueldo ? Number(sueldo.ganancia_disponible_socios) : Number(previa.gananciaDisponibleSocios);
  const neta = gananciaNetaFinal != null ? Number(gananciaNetaFinal) : base;
  const estado = sueldo ? ESTADOS_SUELDO[sueldo.estado] : null;
  const diezPorCiento = Math.round(base * 10) / 100;

  async function accion(fn: () => Promise<any>, pregunta?: string) {
    if (pregunta && !(await confirmDialog(pregunta))) return;
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo completar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="topbar" style={{ marginBottom: 8 }}>
        <h4 style={{ margin: 0 }}>Sueldo de Manos</h4>
        {estado ? <span className={`badge ${estado.clase}`}>{estado.texto}</span> : <span className="badge neutral">Vista previa</span>}
      </div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Ganancia neta final antes del sueldo</div>
          <div className="value">{usd(neta)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Sueldo Manos</div>
          <div className="value">{usd(importe)}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            {sueldo?.regla_manual
              ? "Cargado a mano (antes de la regla automática)"
              : `10% = ${usd(diezPorCiento)}${diezPorCiento < 400 ? " → se aplica el mínimo de US$ 400" : ""}`}
          </div>
        </div>
        <div className="kpi-card">
          <div className="label">Ganancia disponible para socios</div>
          <div className={`value ${disponible >= 0 ? "pos" : "neg"}`}><Cifra texto={usd(disponible)} /></div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>ganancia neta final − sueldo Manos</div>
        </div>
      </div>

      {!sueldo && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Es una vista previa: el sueldo se genera como pendiente al cerrar el período.
        </div>
      )}

      {sueldo && (sueldo.estado === "PAGADO" || sueldo.equivalente_usdt != null) && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {sueldo.fecha_pago && <>Pago del {dateShort(sueldo.fecha_pago)}</>}
          {sueldo.pesos_pagados != null && <> · ARS {Number(sueldo.pesos_pagados).toLocaleString("es-AR")} a {Number(sueldo.cotizacion_ars_usdt)} = {usd(sueldo.equivalente_usdt)}</>}
          {sueldo.estado === "PAGADO" && <> · bajó la deuda de Juan, no movió Wallet Manos</>}
        </div>
      )}

      {sueldo?.estado === "REVISAR_DIFERENCIA" && (
        <div className="error" style={{ marginTop: 10 }}>
          Esperado {usd(sueldo.sueldo_usdt)} · ingresado {usd(sueldo.equivalente_usdt)} · diferencia{" "}
          {usd(Number(sueldo.equivalente_usdt) - Number(sueldo.sueldo_usdt))}. No se tocó la cuenta de Juan.
        </div>
      )}

      {sueldo?.estado === "REQUIERE_REVISION" && (
        <div className="error" style={{ marginTop: 10 }}>
          El período se volvió a cerrar con otra ganancia ({usd(sueldo.revision_base_usdt)}). Con la regla el sueldo sería{" "}
          {usd(sueldo.revision_sueldo_usdt)} y se pagó {usd(sueldo.sueldo_usdt)}: diferencia{" "}
          {usd(Number(sueldo.revision_sueldo_usdt) - Number(sueldo.sueldo_usdt))}.
        </div>
      )}

      {sueldo?.observaciones && (
        <div className="muted" style={{ fontSize: 11, marginTop: 8, whiteSpace: "pre-line" }}>{sueldo.observaciones}</div>
      )}

      {sueldo && (
        <div className="row-actions" style={{ marginTop: 10, justifyContent: "flex-start" }}>
          {(sueldo.estado === "PENDIENTE" || sueldo.estado === "REVISAR_DIFERENCIA") && (
            <button className="btn small" disabled={busy} onClick={() => setPagando(true)}>
              {sueldo.estado === "PENDIENTE" ? "Registrar pago" : "Corregir pago"}
            </button>
          )}
          {sueldo.estado === "REVISAR_DIFERENCIA" && (
            <button
              className="btn secondary small"
              disabled={busy}
              onClick={() =>
                accion(
                  () => api.aceptarDiferenciaSueldoManos(sueldo.id),
                  `¿Aceptar la diferencia? A Juan se le baja lo que pagó (${usd(sueldo.equivalente_usdt)}) y el sueldo queda pagado.`
                )
              }
            >
              Aceptar diferencia
            </button>
          )}
          {sueldo.estado === "REQUIERE_REVISION" && (
            <>
              <button
                className="btn secondary small"
                disabled={busy}
                onClick={() => accion(() => api.revisionSueldoManos(sueldo.id, { accion: "MANTENER" }), "¿Mantener el sueldo que ya se pagó como definitivo?")}
              >
                Mantener lo pagado
              </button>
              {Number(sueldo.revision_sueldo_usdt) > Number(sueldo.sueldo_usdt) && (
                <button className="btn small" disabled={busy} onClick={() => setComplemento(true)}>Registrar complemento</button>
              )}
            </>
          )}
        </div>
      )}

      {pagando && sueldo && (
        <Modal title={`Pago del sueldo de Manos · ${sueldo.period_name}`} onClose={() => setPagando(false)}>
          <PagoSueldoForm
            esperado={Number(sueldo.sueldo_usdt)}
            onSubmit={async (d) => {
              const r = await api.pagarSueldoManos(sueldo.id, d);
              setPagando(false);
              onChanged();
              if (r.sueldo?.estado === "REVISAR_DIFERENCIA") {
                await alertDialog(`No coincide: esperado ${usd(r.esperado)}, ingresado ${usd(r.equivalente)} (diferencia ${usd(r.diferencia)}). Quedó en "Revisar diferencia" y no se tocó la cuenta de Juan.`);
              }
            }}
          />
        </Modal>
      )}

      {complemento && sueldo && (
        <Modal title={`Complemento del sueldo de Manos · ${sueldo.period_name}`} onClose={() => setComplemento(false)}>
          <PagoSueldoForm
            esperado={Math.round((Number(sueldo.revision_sueldo_usdt) - Number(sueldo.sueldo_usdt)) * 100) / 100}
            onSubmit={async (d) => {
              await api.revisionSueldoManos(sueldo.id, { accion: "AJUSTAR", fechaPago: d.fechaPago, pesos: d.pesos, cotizacion: d.cotizacion });
              setComplemento(false);
              onChanged();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function PagoSueldoForm({ esperado, onSubmit }: { esperado: number; onSubmit: (d: { fechaPago: string; pesos: number; cotizacion: number; observaciones?: string | null }) => Promise<void> }) {
  const [fechaPago, setFechaPago] = useState(new Date().toISOString().slice(0, 10));
  const [pesos, setPesos] = useState("");
  const [cotizacion, setCotizacion] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const p = Number(pesos);
  const c = Number(cotizacion);
  const equivalente = p > 0 && c > 0 ? Math.round((p / c) * 100) / 100 : null;
  const diferencia = equivalente != null ? Math.round((equivalente - esperado) * 100) / 100 : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    if (!fechaPago) return setMsg("La fecha de pago es obligatoria.");
    if (!(p > 0)) return setMsg("Los pesos pagados tienen que ser mayores a 0.");
    if (!(c > 0)) return setMsg("La cotización tiene que ser mayor a 0.");
    setLoading(true);
    try {
      await onSubmit({ fechaPago, pesos: p, cotizacion: c, observaciones: observaciones.trim() || null });
    } catch (err: any) {
      setMsg(err.message || "No se pudo registrar el pago.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="muted" style={{ marginBottom: 10 }}>
        Juan lo paga en pesos: al quedar pagado se le baja la deuda por {usd(esperado)}. No mueve Wallet Manos ni la cuenta de Manos.
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Fecha de pago</label>
          <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
        </div>
        <div className="field">
          <label>Pesos pagados (ARS)</label>
          <input type="number" step="0.01" min="0" value={pesos} onChange={(e) => setPesos(e.target.value)} />
        </div>
        <div className="field">
          <label>Cotización ARS/USDT</label>
          <input type="number" step="0.0001" min="0" value={cotizacion} onChange={(e) => setCotizacion(e.target.value)} />
        </div>
      </div>
      {equivalente != null && (
        <div className={Math.abs(diferencia!) <= 0.01 ? "success" : "error"} style={{ marginBottom: 10 }}>
          Equivalente {usd(equivalente)} · esperado {usd(esperado)}
          {Math.abs(diferencia!) > 0.01 && <> · diferencia {usd(diferencia!)} (quedaría en "Revisar diferencia")</>}
        </div>
      )}
      <div className="field">
        <label>Observaciones (opcional)</label>
        <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
      </div>
      {msg && <div className="error">{msg}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Registrar pago"}</button>
    </form>
  );
}

const TIPOS_AJUSTE = ["Fichas confiscadas", "Retención de club", "Venta Emoji/VIP", "Otro"];
const AFECTADO_TIPOS = ["Agente", "Supervisor", "Compartido", "Otro"];

function AjusteForm({ ajuste, onDone }: { ajuste?: any; onDone: () => void }) {
  const [occurredAt, setOccurredAt] = useState(ajuste?.occurred_at ? String(ajuste.occurred_at).slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [tipo, setTipo] = useState(ajuste?.tipo ?? TIPOS_AJUSTE[0]);
  const [descripcion, setDescripcion] = useState(ajuste?.descripcion ?? "");
  const [responsable, setResponsable] = useState(ajuste?.responsable ?? "");
  const [clubAgencia, setClubAgencia] = useState(ajuste?.club_agencia ?? "");
  const [montoOriginal, setMontoOriginal] = useState(ajuste ? String(ajuste.monto_original) : "");
  const [absorbeDigiplayers, setAbsorbeDigiplayers] = useState(ajuste ? String(ajuste.absorbe_digiplayers) : "0");
  const [absorbeAgente, setAbsorbeAgente] = useState(ajuste ? String(ajuste.absorbe_agente) : "0");
  const [absorbeSupervisor, setAbsorbeSupervisor] = useState(ajuste ? String(ajuste.absorbe_supervisor) : "0");
  const [modoDistribucion, setModoDistribucion] = useState<"IGUAL_POR_PERIODO" | "PERSONALIZADO">(ajuste?.modo_distribucion ?? "IGUAL_POR_PERIODO");
  const [periodosTotales, setPeriodosTotales] = useState(ajuste ? String(ajuste.periodos_totales) : "1");
  const [afectadoTipo, setAfectadoTipo] = useState(ajuste?.afectado_tipo ?? "");
  const [afectadoNombre, setAfectadoNombre] = useState(ajuste?.afectado_nombre ?? "");
  const [observaciones, setObservaciones] = useState(ajuste?.observaciones ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const yaAplicado = ajuste?.periodos_aplicados > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!descripcion.trim()) return setMsg({ ok: false, text: "La descripción es obligatoria." });
    const monto = Number(montoOriginal);
    if (!(monto > 0)) return setMsg({ ok: false, text: "El monto original tiene que ser mayor a 0." });
    setLoading(true);
    // Si ya tiene cuotas aplicadas, el backend rechaza el pedido entero si vienen presentes
    // estos 4 campos (aunque el valor sea el mismo) — se omiten del todo para poder editar el
    // resto (descripción, responsable, observaciones) sin chocar contra ese bloqueo.
    const data: Record<string, any> = {
      occurredAt,
      tipo,
      descripcion: descripcion.trim(),
      responsable: responsable.trim() || null,
      clubAgencia: clubAgencia.trim() || null,
      absorbeAgente: Number(absorbeAgente) || 0,
      absorbeSupervisor: Number(absorbeSupervisor) || 0,
      afectadoTipo: afectadoTipo.trim() || null,
      afectadoNombre: afectadoNombre.trim() || null,
      observaciones: observaciones.trim() || null,
    };
    if (!yaAplicado) {
      data.montoOriginal = monto;
      data.absorbeDigiplayers = Number(absorbeDigiplayers) || 0;
      data.modoDistribucion = modoDistribucion;
      data.periodosTotales = modoDistribucion === "PERSONALIZADO" ? 1 : Math.max(1, Number(periodosTotales) || 1);
    }
    try {
      if (ajuste) await api.editarAjusteExtraordinario(ajuste.id, data);
      else await api.crearAjusteExtraordinario(data as any);
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el ajuste." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {yaAplicado && (
        <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
          Este ajuste ya tiene {ajuste.periodos_aplicados} cuota(s) aplicada(s) — el monto, lo que absorbe DigiPlayers y la
          cantidad de cuotas quedan bloqueados hasta reabrir esos períodos.
        </div>
      )}
      <div className="form-grid">
        <div className="field">
          <label>Fecha</label>
          <input value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} type="date" />
        </div>
        <div className="field">
          <label>Tipo</label>
          <input list="tipos-ajuste" value={tipo} onChange={(e) => setTipo(e.target.value)} />
          <datalist id="tipos-ajuste">
            {TIPOS_AJUSTE.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="field">
          <label>Club / agencia afectada (opcional)</label>
          <input value={clubAgencia} onChange={(e) => setClubAgencia(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Descripción</label>
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: Retención total del cierre de..." />
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Monto original (USD)</label>
          <input value={montoOriginal} onChange={(e) => setMontoOriginal(e.target.value)} type="number" step="0.01" disabled={yaAplicado} />
        </div>
        <div className="field">
          <label>Absorbe DigiPlayers (USD)</label>
          <input value={absorbeDigiplayers} onChange={(e) => setAbsorbeDigiplayers(e.target.value)} type="number" step="0.01" disabled={yaAplicado} />
        </div>
        <div className="field">
          <label>Responsable (opcional)</label>
          <input value={responsable} onChange={(e) => setResponsable(e.target.value)} placeholder="Agente, Supervisor, Compartido, Otro" />
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Absorbe agente (USD, informativo)</label>
          <input value={absorbeAgente} onChange={(e) => setAbsorbeAgente(e.target.value)} type="number" step="0.01" />
        </div>
        <div className="field">
          <label>Absorbe supervisor (USD, informativo)</label>
          <input value={absorbeSupervisor} onChange={(e) => setAbsorbeSupervisor(e.target.value)} type="number" step="0.01" />
        </div>
        <div className="field">
          <label>Modo de distribución</label>
          <select value={modoDistribucion} onChange={(e) => setModoDistribucion(e.target.value as any)} disabled={yaAplicado}>
            <option value="IGUAL_POR_PERIODO">Igual por período (varias cuotas)</option>
            <option value="PERSONALIZADO">Personalizado (1 sola cuota)</option>
          </select>
        </div>
      </div>
      {modoDistribucion === "IGUAL_POR_PERIODO" && (
        <div className="field">
          <label>Cantidad de períodos (cuotas)</label>
          <input value={periodosTotales} onChange={(e) => setPeriodosTotales(e.target.value)} type="number" min={1} step={1} disabled={yaAplicado} />
        </div>
      )}
      <div className="form-grid">
        <div className="field">
          <label>Afectado (tipo, opcional)</label>
          <input list="afectado-tipos" value={afectadoTipo} onChange={(e) => setAfectadoTipo(e.target.value)} />
          <datalist id="afectado-tipos">
            {AFECTADO_TIPOS.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="field">
          <label>Afectado (nombre, opcional)</label>
          <input value={afectadoNombre} onChange={(e) => setAfectadoNombre(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>Observaciones (opcional)</label>
        <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : ajuste ? "Guardar" : "Crear ajuste"}</button>
    </form>
  );
}
