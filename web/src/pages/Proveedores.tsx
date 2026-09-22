import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, pct, dateShort } from "../fmt";
import Modal from "../components/Modal";

// Sección "Proveedores" (22/09/2026, pedido de Leo) -- entidad separada de Agentes/Clubes,
// a propósito no comparte pantallas ni datos con esas ("no mezclarlo con lo que ya tenemos").
// Caso original: Manzur como "unión" en Fénix GG, que nos entrega el 75% del rake TOTAL del
// club (no un agente al 75% de sus propios jugadores -- eso sigue siendo Cierres/Liquidaciones
// normal, Manzur convive con las dos cuentas al mismo tiempo).

const GARANTIA_TIPO_LABEL: Record<string, string> = {
  ALTA: "Alta",
  AUMENTO: "Aumento",
  REDUCCION: "Reducción",
  CONSUMO: "Consumo",
  BAJA: "Baja",
};

type Tab = "saldos" | "cierres" | "pagos" | "garantias";

export default function Proveedores() {
  const [tab, setTab] = useState<Tab>("saldos");
  const [proveedores, setProveedores] = useState<any[] | null>(null);
  const [clubes, setClubes] = useState<any[]>([]);
  const [saldos, setSaldos] = useState<any[] | null>(null);
  const [cierres, setCierres] = useState<any[] | null>(null);
  const [pagos, setPagos] = useState<any[] | null>(null);
  const [garantias, setGarantias] = useState<any[] | null>(null);
  const [garantiasHistorial, setGarantiasHistorial] = useState<any[] | null>(null);
  const [error, setError] = useState("");

  const [showNuevoProveedor, setShowNuevoProveedor] = useState(false);
  const [editandoProveedor, setEditandoProveedor] = useState<any | null>(null);
  const [showCierre, setShowCierre] = useState(false);
  const [showPago, setShowPago] = useState(false);
  const [showGarantiaAjuste, setShowGarantiaAjuste] = useState<{ proveedorId?: string } | null>(null);

  function refresh() {
    setError("");
    api.proveedores().then(setProveedores).catch((e) => setError(e.message));
    api.saldosProveedores().then(setSaldos).catch(() => {});
    api.cierresProveedor().then(setCierres).catch(() => {});
    api.pagosProveedor().then(setPagos).catch(() => {});
    api.garantiasProveedores().then(setGarantias).catch(() => {});
    api.garantiasProveedoresHistorial().then(setGarantiasHistorial).catch(() => {});
  }

  useEffect(() => {
    refresh();
    api.proveedoresClubes().then(setClubes);
  }, []);

  if (error) {
    return (
      <div className="error">
        No se pudo cargar Proveedores: {error}
        <div style={{ marginTop: 10 }}>
          <button className="btn secondary small" onClick={refresh}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!proveedores) return <div className="muted">Cargando...</div>;

  const totalSaldo = (saldos ?? []).reduce((s, x) => s + Number(x.amount), 0);
  const totalGarantizado = (garantias ?? []).reduce((s, g) => s + Number(g.amount), 0);
  const totalGarantiaPendiente = (garantias ?? []).reduce((s, g) => s + (Number(g.amount) - Number(g.consumed)), 0);

  async function onRevertirCierre(id: string) {
    if (!confirm("¿Revertir este cierre? Solo funciona si no hay pagos/cierres más nuevos encima.")) return;
    try {
      await api.revertirCierreProveedor(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    }
  }

  async function onRevertirPago(id: string) {
    if (!confirm("¿Revertir este pago? Solo funciona si no hay movimientos más nuevos encima.")) return;
    try {
      await api.revertirPagoProveedor(id);
      refresh();
    } catch (err: any) {
      alert(err.message || "No se pudo revertir.");
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Proveedores</h2>
          <div className="muted">
            Cuentas separadas de Agentes -- para relaciones donde alguien nos entrega un % del rake TOTAL de un club
            (no de sus propios jugadores), ej. Manzur en Fénix GG.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn secondary" onClick={() => setShowNuevoProveedor(true)}>+ Nuevo proveedor</button>
          <button className="btn" onClick={() => setShowCierre(true)} disabled={proveedores.length === 0}>+ Cierre semanal</button>
          <button className="btn secondary" onClick={() => setShowPago(true)} disabled={proveedores.length === 0}>+ Pago / cobro</button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Proveedores activos</div>
          <div className="value">{proveedores.length}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Saldo total (a favor del proveedor)</div>
          <div className="value">{usd(totalSaldo)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Garantizado</div>
          <div className="value">{usd(totalGarantizado)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Garantía pendiente</div>
          <div className="value">{usd(totalGarantiaPendiente)}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Proveedores</h3>
        <table>
          <thead><tr><th>Nombre</th><th>Auto-cierre</th><th>Notas</th><th></th></tr></thead>
          <tbody>
            {proveedores.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {p.auto_cierre_club_id
                    ? `${clubes.find((c) => c.id === p.auto_cierre_club_id)?.name ?? "?"} · ${pct(p.auto_cierre_rakeback_pct)}`
                    : "Sin auto-cierre"}
                </td>
                <td className="muted" style={{ fontSize: 12 }} title={p.notes || undefined}>{p.notes || "—"}</td>
                <td><button className="btn secondary small" onClick={() => setEditandoProveedor(p)}>Editar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tabs" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <button className={`btn small ${tab === "saldos" ? "" : "secondary"}`} onClick={() => setTab("saldos")}>Saldos</button>
        <button className={`btn small ${tab === "cierres" ? "" : "secondary"}`} onClick={() => setTab("cierres")}>Cierres semanales</button>
        <button className={`btn small ${tab === "pagos" ? "" : "secondary"}`} onClick={() => setTab("pagos")}>Pagos / cobros</button>
        <button className={`btn small ${tab === "garantias" ? "" : "secondary"}`} onClick={() => setTab("garantias")}>Garantías</button>
      </div>

      {tab === "saldos" && (
        <div className="panel">
          <h3>Saldo operativo por proveedor+club</h3>
          {!saldos ? (
            <div className="muted">Cargando...</div>
          ) : saldos.length === 0 ? (
            <div className="muted">Todavía no hay saldos -- se generan solos con el primer cierre o pago.</div>
          ) : (
            <table>
              <thead><tr><th>Proveedor</th><th>Club</th><th>Saldo</th><th>Actualizado</th></tr></thead>
              <tbody>
                {saldos.map((s) => (
                  <tr key={s.id}>
                    <td>{s.proveedor_name}</td>
                    <td>{s.club_name}</td>
                    <td>
                      <span className={`badge ${Number(s.amount) > 0 ? "pos" : Number(s.amount) < 0 ? "neg" : "neutral"}`}>
                        {usd(s.amount)}
                      </span>
                    </td>
                    <td className="muted">{dateShort(s.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Positivo = a favor del proveedor (le debemos). Negativo = a favor nuestro (nos debe). Se actualiza solo con
            cada cierre semanal y cada pago/cobro -- nunca se edita a mano.
          </div>
        </div>
      )}

      {tab === "cierres" && (
        <div className="panel">
          <h3>Historial de cierres semanales</h3>
          {!cierres ? (
            <div className="muted">Cargando...</div>
          ) : cierres.length === 0 ? (
            <div className="muted">Todavía no hay cierres cargados.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Semana</th><th>Proveedor</th><th>Club</th><th>Resultado</th><th>Rake</th><th>%</th>
                  <th>Rakeback</th><th>Cierre</th><th>Saldo resultante</th><th></th>
                </tr>
              </thead>
              <tbody>
                {cierres.map((c) => (
                  <tr key={c.id} style={c.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                    <td>{dateShort(c.week_start)} - {dateShort(c.week_end)}</td>
                    <td>{c.proveedor_name}</td>
                    <td>{c.club_name}</td>
                    <td>{usd(c.resultado_total)}</td>
                    <td>{usd(c.rake_total)}</td>
                    <td>{pct(c.rakeback_pct)}</td>
                    <td>{usd(c.rakeback_monto)}</td>
                    <td><span className={`badge ${Number(c.cierre) > 0 ? "pos" : Number(c.cierre) < 0 ? "neg" : "neutral"}`}>{usd(c.cierre)}</span></td>
                    <td>{usd(c.saldo_nuevo)}</td>
                    <td>
                      {c.status !== "REVERTIDO" && (
                        <button className="btn secondary small" onClick={() => onRevertirCierre(c.id)}>Revertir</button>
                      )}
                      {c.status === "REVERTIDO" && <span className="badge neg">Revertido</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "pagos" && (
        <div className="panel">
          <h3>Historial de pagos / cobros</h3>
          {!pagos ? (
            <div className="muted">Cargando...</div>
          ) : pagos.length === 0 ? (
            <div className="muted">Todavía no hay pagos/cobros cargados.</div>
          ) : (
            <table>
              <thead>
                <tr><th>Fecha</th><th>Proveedor</th><th>Club</th><th>Tipo</th><th>Medio</th><th>Monto</th><th>Saldo resultante</th><th></th></tr>
              </thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id} style={p.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                    <td>{dateShort(p.occurred_at)}</td>
                    <td>{p.proveedor_name}</td>
                    <td>{p.club_name}</td>
                    <td><span className="badge neutral">{p.direction === "PAGO" ? "Pago (le dimos)" : "Cobro (nos dio)"}</span></td>
                    <td>{p.medio}</td>
                    <td>{usd(p.amount)}</td>
                    <td>{usd(p.saldo_nuevo)}</td>
                    <td>
                      {p.status !== "REVERTIDO" && (
                        <button className="btn secondary small" onClick={() => onRevertirPago(p.id)}>Revertir</button>
                      )}
                      {p.status === "REVERTIDO" && <span className="badge neg">Revertido</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "garantias" && (
        <>
          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3>Garantías activas</h3>
              <button className="btn secondary small" onClick={() => setShowGarantiaAjuste({})}>+ Ajustar garantía</button>
            </div>
            {!garantias ? (
              <div className="muted">Cargando...</div>
            ) : garantias.length === 0 ? (
              <div className="muted">Todavía no hay garantías activas.</div>
            ) : (
              <table>
                <thead><tr><th>Proveedor</th><th>Garantizado</th><th>Consumido</th><th>Pendiente</th><th>Notas</th><th></th></tr></thead>
                <tbody>
                  {garantias.map((g) => (
                    <tr key={g.id}>
                      <td>{g.proveedor_name}</td>
                      <td>{usd(g.amount)}</td>
                      <td>{usd(g.consumed)}</td>
                      <td><span className="badge neutral">{usd(Number(g.amount) - Number(g.consumed))}</span></td>
                      <td className="muted" style={{ fontSize: 12 }} title={g.notes || undefined}>{g.notes || "—"}</td>
                      <td>
                        <button className="btn secondary small" onClick={() => setShowGarantiaAjuste({ proveedorId: g.proveedor_id })}>Ajustar</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="panel">
            <h3>Historial de garantías</h3>
            {!garantiasHistorial ? (
              <div className="muted">Cargando...</div>
            ) : garantiasHistorial.length === 0 ? (
              <div className="muted">Todavía no hay movimientos.</div>
            ) : (
              <table>
                <thead><tr><th>Fecha</th><th>Proveedor</th><th>Tipo</th><th>Monto</th><th>Resultante</th><th>Consumido</th><th>Notas</th></tr></thead>
                <tbody>
                  {garantiasHistorial.map((m) => (
                    <tr key={m.id}>
                      <td>{dateShort(m.occurred_at)}</td>
                      <td>{m.proveedor_name}</td>
                      <td><span className="badge neutral">{GARANTIA_TIPO_LABEL[m.type] ?? m.type}</span></td>
                      <td>{m.type === "BAJA" ? "—" : usd(m.amount)}</td>
                      <td>{usd(m.resulting_amount)}</td>
                      <td>{usd(m.resulting_consumed)}</td>
                      <td className="muted" style={{ fontSize: 12 }} title={m.notes || undefined}>{m.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {showNuevoProveedor && (
        <Modal title="Nuevo proveedor" onClose={() => setShowNuevoProveedor(false)}>
          <NuevoProveedorForm clubes={clubes} onDone={() => { setShowNuevoProveedor(false); refresh(); }} />
        </Modal>
      )}
      {editandoProveedor && (
        <Modal title={`Editar ${editandoProveedor.name}`} onClose={() => setEditandoProveedor(null)}>
          <NuevoProveedorForm
            proveedor={editandoProveedor}
            clubes={clubes}
            onDone={() => { setEditandoProveedor(null); refresh(); }}
          />
        </Modal>
      )}
      {showCierre && (
        <Modal title="Cierre semanal de proveedor" onClose={() => setShowCierre(false)}>
          <CierreForm
            proveedores={proveedores}
            clubes={clubes}
            onDone={() => { setShowCierre(false); refresh(); }}
          />
        </Modal>
      )}
      {showPago && (
        <Modal title="Pago / cobro a proveedor" onClose={() => setShowPago(false)}>
          <PagoForm
            proveedores={proveedores}
            clubes={clubes}
            onDone={() => { setShowPago(false); refresh(); }}
          />
        </Modal>
      )}
      {showGarantiaAjuste && (
        <Modal title="Ajustar garantía de proveedor" onClose={() => setShowGarantiaAjuste(null)}>
          <GarantiaAjusteForm
            proveedores={proveedores}
            garantias={garantias ?? []}
            preselectProveedorId={showGarantiaAjuste.proveedorId}
            onDone={() => { setShowGarantiaAjuste(null); refresh(); }}
          />
        </Modal>
      )}
    </div>
  );
}

// Sirve para crear Y para editar (pasando `proveedor`) -- el auto-cierre (club + % fijo) es
// lo que permite que "Resumen por club" cierre este proveedor solo cuando se guarda esa
// pantalla (22/09/2026, pedido de Leo: "que se haga automaticamente en proveedores, asi no
// tenemos que cargar de nuevo todo"). Dejar el club en "Sin auto-cierre" es válido -- el
// proveedor sigue existiendo, solo que su cierre semanal se sigue aplicando a mano desde acá.
function NuevoProveedorForm({
  proveedor,
  clubes,
  onDone,
}: {
  proveedor?: any;
  clubes: any[];
  onDone: () => void;
}) {
  const [name, setName] = useState(proveedor?.name ?? "");
  const [notes, setNotes] = useState(proveedor?.notes ?? "");
  const [autoCierreClubId, setAutoCierreClubId] = useState(proveedor?.auto_cierre_club_id ?? "");
  const [autoCierreRakebackPct, setAutoCierreRakebackPct] = useState(
    proveedor?.auto_cierre_rakeback_pct != null ? String(Number(proveedor.auto_cierre_rakeback_pct) * 100) : "75"
  );
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!name.trim()) return setMsg({ ok: false, text: "El nombre es obligatorio." });
    if (autoCierreClubId && !(Number(autoCierreRakebackPct) > 0)) {
      return setMsg({ ok: false, text: "Si elegís un club de auto-cierre, el % de rakeback tiene que ser mayor a 0." });
    }
    setLoading(true);
    const payload = {
      name: name.trim(),
      notes: notes.trim() || undefined,
      autoCierreClubId: autoCierreClubId || null,
      autoCierreRakebackPct: autoCierreClubId ? (Number(autoCierreRakebackPct) || 0) / 100 : null,
    };
    try {
      if (proveedor) {
        await api.actualizarProveedor(proveedor.id, payload);
      } else {
        await api.crearProveedor(payload);
      }
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el proveedor." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label>Nombre</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Manzur (unión Fénix GG)" />
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Descripción de la relación, referencia, etc." />
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Club de auto-cierre (opcional)</label>
          <select value={autoCierreClubId} onChange={(e) => setAutoCierreClubId(e.target.value)}>
            <option value="">Sin auto-cierre (cerrar a mano)</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {autoCierreClubId && (
          <div className="field">
            <label>% rakeback fijo para el auto-cierre</label>
            <input value={autoCierreRakebackPct} onChange={(e) => setAutoCierreRakebackPct(e.target.value)} type="number" step="0.01" />
          </div>
        )}
      </div>
      {autoCierreClubId && (
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
          Cada vez que se guarde el resumen semanal de ese club (en "Resumen por club"), se va a aplicar solo el cierre
          de este proveedor para esa semana, sin tener que volver acá.
        </div>
      )}
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : proveedor ? "Guardar cambios" : "Crear"}</button>
    </form>
  );
}

// El resultado y el rake total NUNCA se tipean acá -- se traen del resumen semanal del club
// (mismo que ya usa la pestaña "Resumen por club"), que suma los cierres de todos los agentes
// de ese club+semana ya cargados por la vía normal ("Cierres semanales"). Pedido de Leo,
// 22/09/2026: "no podemos hacer el cierre semanal de los clubes y que se gestione lo mismo
// para esta pestaña? si no tenemos que hacer dos cierres con lo mismo". Este formulario es
// entonces un paso DESPUÉS de cerrar el club como siempre, nunca una carga en paralelo.
function CierreForm({ proveedores, clubes, onDone }: { proveedores: any[]; clubes: any[]; onDone: () => void }) {
  const [proveedorId, setProveedorId] = useState("");
  const [clubId, setClubId] = useState("");
  const [semanas, setSemanas] = useState<any[] | null>(null);
  const [weekStart, setWeekStart] = useState("");
  const [resumen, setResumen] = useState<any | null>(null);
  const [cargandoResumen, setCargandoResumen] = useState(false);
  const [rakebackPct, setRakebackPct] = useState("75");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setWeekStart("");
    setResumen(null);
    if (!clubId) {
      setSemanas(null);
      return;
    }
    api.semanasResumenClub(clubId).then(setSemanas).catch(() => setSemanas([]));
  }, [clubId]);

  useEffect(() => {
    setResumen(null);
    if (!clubId || !weekStart) return;
    setCargandoResumen(true);
    api
      .resumenClub(clubId, weekStart)
      .then(setResumen)
      .catch(() => setResumen(null))
      .finally(() => setCargandoResumen(false));
  }, [clubId, weekStart]);

  const pctNum = (Number(rakebackPct) || 0) / 100;
  const resultadoTotal = resumen ? Number(resumen.resultadoTotal) : null;
  const rakeTotal = resumen ? Number(resumen.rakeTotal) : null;
  const rakebackMonto = rakeTotal !== null ? rakeTotal * pctNum : null;
  const cierre = resultadoTotal !== null && rakebackMonto !== null ? resultadoTotal + rakebackMonto : null;
  const sinCierresDelClub = resumen && Number(resumen.agentesConCierre) === 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId || !clubId) return setMsg({ ok: false, text: "Elegí proveedor y club." });
    if (!weekStart) return setMsg({ ok: false, text: "Elegí la semana (tiene que tener cierres del club ya cargados)." });
    if (sinCierresDelClub) {
      return setMsg({ ok: false, text: 'Esta semana todavía no tiene ningún cierre cargado para este club -- cargalo primero en "Cierres semanales".' });
    }
    setLoading(true);
    try {
      await api.aplicarCierreProveedor({
        proveedorId,
        clubId,
        weekStart,
        rakebackPct: pctNum,
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el cierre." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Semana (ya cerrada en el club)</label>
          <select value={weekStart} onChange={(e) => setWeekStart(e.target.value)} disabled={!clubId}>
            <option value="">{clubId ? "Elegir..." : "Elegí un club primero"}</option>
            {(semanas ?? []).map((s) => (
              <option key={s.week_start} value={s.week_start}>
                {dateShort(s.week_start)} - {dateShort(s.week_end)}
              </option>
            ))}
          </select>
          {clubId && semanas && semanas.length === 0 && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Este club todavía no tiene ningún cierre semanal cargado.
            </div>
          )}
        </div>
        <div className="field">
          <label>% rakeback</label>
          <input value={rakebackPct} onChange={(e) => setRakebackPct(e.target.value)} type="number" step="0.01" />
        </div>
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia, etc." />
      </div>

      {cargandoResumen && <div className="muted" style={{ fontSize: 13 }}>Trayendo el resumen del club...</div>}
      {sinCierresDelClub && (
        <div className="error" style={{ fontSize: 13 }}>
          Esta semana no tiene ningún cierre cargado para este club -- cargalo primero en "Cierres semanales".
        </div>
      )}
      {resumen && !sinCierresDelClub && (
        <div className="muted" style={{ fontSize: 13, margin: "10px 0" }}>
          Resultado total del club: {usd(resultadoTotal ?? 0)} (de {resumen.agentesConCierre} agente{Number(resumen.agentesConCierre) === 1 ? "" : "s"}) ·
          Rake total: {usd(rakeTotal ?? 0)} · Rakeback: {usd(rakebackMonto ?? 0)} · Cierre = <b>{usd(cierre ?? 0)}</b>
        </div>
      )}

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading || !resumen || sinCierresDelClub}>{loading ? "Aplicando..." : "Aplicar cierre"}</button>
    </form>
  );
}

function PagoForm({ proveedores, clubes, onDone }: { proveedores: any[]; clubes: any[]; onDone: () => void }) {
  const [proveedorId, setProveedorId] = useState("");
  const [clubId, setClubId] = useState("");
  const [amount, setAmount] = useState("");
  const [medio, setMedio] = useState<"USDT" | "EFECTIVO" | "ZELLE" | "OTRO">("USDT");
  const [direction, setDirection] = useState<"PAGO" | "COBRO">("PAGO");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId || !clubId) return setMsg({ ok: false, text: "Elegí proveedor y club." });
    if (!(Number(amount) > 0)) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.registrarPagoProveedor({
        proveedorId,
        clubId,
        amount: Number(amount),
        medio,
        direction,
        notes: notes.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el pago." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Elegir...</option>
            {clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tipo</label>
          <select value={direction} onChange={(e) => setDirection(e.target.value as any)}>
            <option value="PAGO">Pago (le pagamos)</option>
            <option value="COBRO">Cobro (nos paga)</option>
          </select>
        </div>
        <div className="field">
          <label>Medio</label>
          <select value={medio} onChange={(e) => setMedio(e.target.value as any)}>
            <option value="USDT">USDT</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="ZELLE">Zelle</option>
            <option value="OTRO">Otro</option>
          </select>
        </div>
        <div className="field">
          <label>Monto (USD)</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
        </div>
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referencia, hash de la transacción, etc." />
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Registrar"}</button>
    </form>
  );
}

function GarantiaAjusteForm({
  proveedores,
  garantias,
  preselectProveedorId,
  onDone,
}: {
  proveedores: any[];
  garantias: any[];
  preselectProveedorId?: string;
  onDone: () => void;
}) {
  const [proveedorId, setProveedorId] = useState(preselectProveedorId ?? "");
  const [type, setType] = useState<"ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA">(preselectProveedorId ? "AUMENTO" : "ALTA");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const tieneGarantiaActiva = garantias.some((g) => g.proveedor_id === proveedorId);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!proveedorId) return setMsg({ ok: false, text: "Elegí un proveedor." });
    const monto = Number(amount) || 0;
    if (type !== "BAJA" && monto <= 0) return setMsg({ ok: false, text: "El monto tiene que ser mayor a 0." });
    setLoading(true);
    try {
      await api.ajustarGarantiaProveedor({ proveedorId, type, amount: monto, notes: notes.trim() || undefined });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el ajuste." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="form-grid">
        <div className="field">
          <label>Proveedor</label>
          <select
            value={proveedorId}
            onChange={(e) => {
              const nextId = e.target.value;
              setProveedorId(nextId);
              const yaTiene = garantias.some((g) => g.proveedor_id === nextId);
              setType(yaTiene ? "AUMENTO" : "ALTA");
            }}
            disabled={!!preselectProveedorId}
          >
            <option value="">Elegir...</option>
            {proveedores.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tipo de movimiento</label>
          <select value={type} onChange={(e) => setType(e.target.value as any)}>
            <option value="ALTA" disabled={tieneGarantiaActiva}>Alta (garantía nueva)</option>
            <option value="AUMENTO" disabled={!tieneGarantiaActiva}>Aumento</option>
            <option value="REDUCCION" disabled={!tieneGarantiaActiva}>Reducción</option>
            <option value="CONSUMO" disabled={!tieneGarantiaActiva}>Consumo</option>
            <option value="BAJA" disabled={!tieneGarantiaActiva}>Baja</option>
          </select>
        </div>
        {type !== "BAJA" && (
          <div className="field">
            <label>Monto (USD)</label>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01" min="0" />
          </div>
        )}
      </div>
      <div className="field">
        <label>Notas (opcional)</label>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Motivo del ajuste, referencia, etc." />
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={loading}>{loading ? "Guardando..." : "Aplicar"}</button>
    </form>
  );
}
