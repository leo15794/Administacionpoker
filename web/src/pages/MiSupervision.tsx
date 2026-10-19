import { useEffect, useState } from "react";
import { api } from "../api";
import { usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";
import Modal from "../components/Modal";
import { PortalTop, PortalHero, PortalMini, PortalTabs, PortalCols, PortalPane, PortalCard, PortalEmpty, MovRow, SolicitudesRetiro, colorSigno, montoSigno, tipoVisual } from "../components/PortalUI";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  PREPAGO: "Prepago",
  WIN_LOSE: "Win/Lose",
  BANCADO: "Bancado",
  INTERNO: "Interno",
  SUPERVISOR: "Supervisor",
  UNION: "Unión",
};

type Tab = "agentes" | "cierre" | "movimientos" | "referidos" | "solicitudes";

// Vista del rol Supervisor — mismo dato que la pestaña "Supervisores" que ya ve el admin en
// Administración, pero filtrado a un solo supervisor (el del login). Solo muestra, salvo pedir
// retiros/pagos.
//
// (19/10/2026, pedido de Leo, mockups aprobados) Rediseño: una tarjeta principal con el saldo (la de la
// cuenta consolidada cuando está activa -- antes arriba decía "Saldo propio US$ 0" y recién 1.200 px más
// abajo aparecía el saldo total), el botón de solicitar retiro pegado a ese saldo, pestañas en celular
// (antes eran 8 paneles apilados) y todo a la vista en dos columnas en escritorio. Mismos datos.
export default function MiSupervision() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("agentes");

  // Cuenta consolidada -- cierre semanal de agentes a cargo, en solo lectura (14/10/2026,
  // pedido de Leo: "deberia el poder entrar y ver el desglose que esta cargado en
  // supervisores"). Sin ningún botón de aplicar -- eso sigue siendo acción exclusiva del admin.
  const [semanasCierre, setSemanasCierre] = useState<any[] | null>(null);
  const [weekCierre, setWeekCierre] = useState("");
  const [cierreSemana, setCierreSemana] = useState<any | null>(null);
  const [cargandoCierre, setCargandoCierre] = useState(false);
  const [agentesAbiertos, setAgentesAbiertos] = useState<Set<string>>(new Set());

  // Solicitudes de retiro/pago del propio supervisor (16/10/2026, pedido de Leo) -- ver
  // routes/portal.ts POST/GET /mi-supervision/solicitudes-retiro. El admin resuelve desde
  // Administración -> Supervisores; acá solo se crea y se ve el estado propio.
  const [misSolicitudes, setMisSolicitudes] = useState<any[] | null>(null);
  const [showSolicitar, setShowSolicitar] = useState(false);

  function refrescarMisSolicitudes() {
    api.misSolicitudesRetiro().then(setMisSolicitudes);
  }

  useEffect(() => {
    api.miSupervision().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    refrescarMisSolicitudes();
  }, []);

  useEffect(() => {
    if (!data?.supervisor?.usa_cuenta_consolidada) return;
    api.miSupervisionSemanasCierre().then((semanas: any[]) => {
      setSemanasCierre(semanas);
      if (semanas.length > 0) {
        const ws = String(semanas[0].week_start).slice(0, 10);
        setWeekCierre(ws);
        cargarCierreSemana(ws);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.supervisor?.usa_cuenta_consolidada]);

  async function cargarCierreSemana(ws: string) {
    setCargandoCierre(true);
    try {
      setCierreSemana(await api.miSupervisionCierreSemanal(ws));
    } finally {
      setCargandoCierre(false);
    }
  }

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <Loading />;

  const sup = data.supervisor;
  const consolidada = !!sup.usa_cuenta_consolidada;
  const fichasReales = Number(sup.fichas_reales);
  const cuentaCorriente = Number(sup.cuenta_corriente);
  const saldoPrincipal = consolidada ? fichasReales + cuentaCorriente : Number(sup.saldo_total);
  const totalGrupo = data.agentes.reduce((s: number, a: any) => s + Number(a.saldo_total), 0);
  const hayReferidos = (data.referidos?.length ?? 0) > 0 || (data.movimientos_referidos?.length ?? 0) > 0;
  const movimientos: any[] = data.movimientos_agentes ?? [];
  const pendientes = (misSolicitudes ?? []).filter((s: any) => s.estado === "PENDIENTE").length;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "agentes", label: "Agentes", count: data.agentes.length },
    ...(consolidada ? [{ key: "cierre" as Tab, label: "Cierre semanal" }] : []),
    { key: "movimientos", label: "Movimientos", count: movimientos.length },
    ...(hayReferidos ? [{ key: "referidos" as Tab, label: "Referidos" }] : []),
    { key: "solicitudes", label: "Solicitudes", count: misSolicitudes?.length ?? 0 },
  ];
  const tabActual: Tab = tabs.some((t) => t.key === tab) ? tab : "agentes";

  const minis = [
    <PortalMini key="a" label="Agentes a cargo" value={String(data.agentes.length)} sub={`saldo del grupo ${montoSigno(totalGrupo)}`} />,
    <PortalMini key="r" label="Rakeback centralizado" value={usdCents(data.rakeback_centralizado_acreditado)} sub="acreditado" />,
    ...(hayReferidos ? [<PortalMini key="c" label="Comisión por referido" value={usdCents(data.saldo_referidos_total ?? 0)} sub="acumulada" />] : []),
  ];

  const agentesPane = (
    <PortalPane activa={tabActual === "agentes"} titulo="Agentes a cargo">
      {data.agentes.length === 0 ? (
        <div className="muted">Todavía no tenés agentes a cargo.</div>
      ) : (
        data.agentes.map((a: any) => (
          <PortalCard key={a.id} titulo={a.name} monto={Number(a.saldo_total)} izq={<span className="pill">{ACCOUNT_TYPE_LABELS[a.account_type] ?? a.account_type}</span>} der="saldo total" />
        ))
      )}
    </PortalPane>
  );

  // Cada agente del cierre se despliega con un toque y muestra, por club, de dónde sale su número (19/10/2026,
  // pedido de Leo, mockup aprobado). Solo lectura: el servidor manda el detalle ya calculado en cada línea.
  const lineasCierre: any[] = cierreSemana?.lineas ?? [];
  const todosAbiertos = lineasCierre.length > 0 && lineasCierre.every((l) => agentesAbiertos.has(l.agent_id));
  function toggleAgenteCierre(id: string) {
    setAgentesAbiertos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const cierrePane = consolidada && (
    <PortalPane activa={tabActual === "cierre"} titulo="Cierre semanal de agentes a cargo">
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Cada semana, las fichas ganadas en mesas de tus agentes a cargo se suman a Fichas reales, y el rakeback que generan se suma a
        Cuenta corriente -- el saldo propio de cada agente sigue acumulando igual que siempre, esto es solo el espejo de tu cuenta.
        Tocá un agente para ver el desglose por club.
      </div>
      {!semanasCierre ? (
        <Loading />
      ) : semanasCierre.length === 0 ? (
        <PortalEmpty>Todavía no hay ningún cierre semanal cargado para tus agentes a cargo.</PortalEmpty>
      ) : (
        <>
          <div className="tb-week-chips" style={{ justifyContent: "flex-start", marginBottom: 10, alignItems: "center" }}>
            {semanasCierre.slice(0, 3).map((s) => {
              const ws = String(s.week_start).slice(0, 10);
              return (
                <button
                  key={ws}
                  className={`chip${weekCierre === ws ? " chip-active" : ""}`}
                  onClick={() => {
                    setWeekCierre(ws);
                    setAgentesAbiertos(new Set());
                    cargarCierreSemana(ws);
                  }}
                >
                  {ws.slice(8, 10)}/{ws.slice(5, 7)} – {String(s.week_end).slice(8, 10)}/{String(s.week_end).slice(5, 7)}
                </button>
              );
            })}
            {semanasCierre.length > 3 && (
              <select
                value={semanasCierre.slice(3).some((s) => String(s.week_start).slice(0, 10) === weekCierre) ? weekCierre : ""}
                onChange={(e) => {
                  if (!e.target.value) return;
                  setWeekCierre(e.target.value);
                  setAgentesAbiertos(new Set());
                  cargarCierreSemana(e.target.value);
                }}
                style={{ width: "auto" }}
              >
                <option value="">Anteriores…</option>
                {semanasCierre.slice(3).map((s) => {
                  const ws = String(s.week_start).slice(0, 10);
                  return (
                    <option key={ws} value={ws}>
                      {dateShort(s.week_start)} al {dateShort(s.week_end)}
                    </option>
                  );
                })}
              </select>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            {cierreSemana?.aplicado ? (
              <span className="pill g">Aplicada el {dateShort(cierreSemana.aplicado.created_at)}</span>
            ) : (
              <span className="pill">Todavía no aplicada</span>
            )}
            <span style={{ flex: 1 }} />
            {lineasCierre.length > 0 && (
              <a
                style={{ fontSize: 12.5, color: "var(--accent)", cursor: "pointer" }}
                onClick={() => setAgentesAbiertos(todosAbiertos ? new Set() : new Set(lineasCierre.map((l) => l.agent_id)))}
              >
                {todosAbiertos ? "Contraer todo" : "Expandir todo"}
              </a>
            )}
          </div>
          {cargandoCierre || !cierreSemana ? (
            <Loading />
          ) : (
            <>
              {lineasCierre.map((l: any) => {
                const abierto = agentesAbiertos.has(l.agent_id);
                const resultado = Number(l.result);
                const detalle: any[] = l.detalle ?? [];
                return (
                  <div key={l.agent_id} className={`pt-card${resultado < 0 ? " ng" : ""}`} style={{ cursor: "pointer" }} onClick={() => toggleAgenteCierre(l.agent_id)}>
                    <div className="b">
                      <div className="t1">
                        <span className="n"><span style={{ color: "var(--text-faint)", marginRight: 6 }}>{abierto ? "▾" : "▸"}</span>{l.agent_name}</span>
                        <span className="amt" style={{ color: colorSigno(resultado) }}>{montoSigno(resultado)}</span>
                      </div>
                      <div className="t2">
                        <span>Fichas ganadas en la semana</span>
                        <span>Rakeback {usdCents(Number(l.rakeback))}</span>
                      </div>
                      {abierto &&
                        (detalle.length === 0 ? (
                          <div className="saldo-sub" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                            Sin cierres cargados para este agente en esta semana.
                          </div>
                        ) : (
                          detalle.map((d: any) => (
                            <div key={d.club_name} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div style={{ fontWeight: 650 }}>{d.club_name}</div>
                                <span className="pill">{ACCOUNT_TYPE_LABELS[d.system] ?? d.system}</span>
                              </div>
                              <div className="saldo-sub" style={{ margin: "2px 0 8px" }}>{d.jugadores ?? "-"} jugadores</div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", fontSize: 12.5 }}>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>Resultado de mesas</div><b style={{ color: colorSigno(Number(d.result)) }}>{montoSigno(Number(d.result))}</b></div>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>Rake generado</div><b>{usdCents(Number(d.rake_total))}</b></div>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>% de rakeback</div><b>{Math.round(Number(d.rakeback_pct) * 10000) / 100}%</b></div>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>Rakeback</div><b>{usdCents(Number(d.rakeback))}</b></div>
                              </div>
                              <div className="saldo-sub" style={{ marginTop: 8 }}>
                                Se suma a tu cuenta: fichas reales <b>{montoSigno(Number(d.result))}</b> · cuenta corriente <b>{usdCents(Number(d.rakeback))}</b>
                              </div>
                            </div>
                          ))
                        ))}
                    </div>
                  </div>
                );
              })}
              <div className="sumrow" style={{ fontWeight: 700 }}>
                <span>Total de la semana</span>
                <b>{montoSigno(Number(cierreSemana.resultadoTotal))} · rakeback {usdCents(Number(cierreSemana.rakebackTotal))}</b>
              </div>
            </>
          )}
        </>
      )}
    </PortalPane>
  );

  const movimientosPane = (
    <PortalPane activa={tabActual === "movimientos"} titulo="Pagos y movimientos del grupo">
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Todo lo que pasó con las cuentas de tu grupo: pagos que les enviamos, cargas y descargas de fichas, transferencias entre clubes y
        ajustes -- para que puedan ver de un vistazo cuándo les mandamos plata o hicimos algún cambio.
      </div>
      {movimientos.length === 0 ? (
        <div className="muted">Todavía no hay movimientos.</div>
      ) : (
        <div className="mov-list" style={{ maxHeight: 560, overflowY: "auto" }}>
          {movimientos.map((m: any) => (
            <MovRow key={m.id} type={m.type} titulo={`${tipoVisual(m.type).label} · ${m.agent_name}`} detalle={`${m.club_name} · ${dateShort(m.occurred_at)}`} monto={Number(m.amount)} obs={m.observation} />
          ))}
        </div>
      )}
    </PortalPane>
  );

  const referidosPane = hayReferidos && (
    <PortalPane activa={tabActual === "referidos"} titulo="Comisiones por referido">
      <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        % fijo sobre el rake semanal de cada agente, acreditado automáticamente en cada cierre suyo — saldo separado de su propia liquidación.
      </div>
      {(data.referidos ?? []).map((r: any) => (
        <PortalCard key={r.id} titulo={r.agente_referido_name} monto={Number(r.saldo)} izq={`${r.porcentaje}% del rake`} der="saldo acumulado" />
      ))}
      {(data.movimientos_referidos ?? []).length > 0 && (
        <>
          <div className="pt-sec">Historial de comisiones</div>
          <div className="mov-list" style={{ maxHeight: 320, overflowY: "auto" }}>
            {data.movimientos_referidos.map((m: any) => (
              <MovRow
                key={m.id}
                type={m.type === "COMISION" ? "CARGA" : m.type === "PAGO" ? "PAGO" : "AJUSTE"}
                titulo={`${m.type === "COMISION" ? "Comisión" : m.type === "PAGO" ? "Pago" : "Corrección"} · ${m.agente_referido_name}`}
                detalle={`${m.week_start ? `Semana ${m.week_start} al ${m.week_end} · ` : ""}${new Date(m.occurred_at).toLocaleDateString("es-AR")} · saldo ${usdCents(m.resulting_saldo)}`}
                monto={Number(m.amount)}
              />
            ))}
          </div>
        </>
      )}
    </PortalPane>
  );

  const solicitudesPane = (
    <PortalPane activa={tabActual === "solicitudes"} titulo="Tus solicitudes de retiro">
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        Lo que vas pidiendo con "+ Solicitar retiro / pago". Queda "Pendiente de envío" hasta que te mandemos los USDT -- en ese momento
        pasa a "Enviado" con el link de pago para que puedas ver el trackeo de la transacción.
      </div>
      <SolicitudesRetiro items={misSolicitudes} />
    </PortalPane>
  );

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <h2>Hola, {sup.name}</h2>
          <div className="muted">Resumen de tu grupo de agentes a cargo.{pendientes > 0 ? ` Tenés ${pendientes} solicitud${pendientes === 1 ? "" : "es"} pendiente${pendientes === 1 ? "" : "s"} de envío.` : ""}</div>
        </div>
      </div>

      <PortalTop
        hero={
          <PortalHero
            label={consolidada ? "Saldo de tu cuenta consolidada" : "Saldo propio"}
            amount={montoSigno(saldoPrincipal)}
            color={colorSigno(saldoPrincipal)}
            foot={
              consolidada ? (
                <>
                  <span>Fichas reales {montoSigno(fichasReales)}</span>
                  <span>Cuenta corriente {montoSigno(cuentaCorriente)}</span>
                </>
              ) : undefined
            }
            cta={{ label: "+ Solicitar retiro / pago", onClick: () => setShowSolicitar(true) }}
          />
        }
        minis={minis}
      />

      <PortalTabs tabs={tabs} value={tabActual} onChange={setTab} />

      <PortalCols
        left={
          <>
            {agentesPane}
            {cierrePane}
            {solicitudesPane}
          </>
        }
        right={
          <>
            {movimientosPane}
            {referidosPane}
          </>
        }
      />

      {showSolicitar && (
        <Modal title="Solicitar retiro / pago" onClose={() => setShowSolicitar(false)}>
          <SolicitarRetiroForm
            onDone={() => {
              setShowSolicitar(false);
              refrescarMisSolicitudes();
              setTab("solicitudes");
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function SolicitarRetiroForm({ onDone }: { onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const amountNum = Number(amount.replace(",", "."));
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return setMsg({ ok: false, text: "El monto debe ser mayor a 0." });
    }
    setLoading(true);
    try {
      await api.solicitarRetiro({ amount: amountNum, nota: nota.trim() || null });
      onDone();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo enviar la solicitud." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label>Monto a retirar (USD)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Ej: 500" />
      </div>
      <div className="field">
        <label>Nota para el admin (opcional)</label>
        <textarea rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
      </div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
        Le llega la notificación al admin apenas enviás esto. Vas a ver en esta pantalla cuándo lo
        revisan y, cuando te manden los USDT, el link de pago para trackearlo.
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" style={{ width: "100%" }} disabled={loading}>
        {loading ? "Enviando..." : "Enviar solicitud"}
      </button>
    </form>
  );
}
