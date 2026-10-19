import { useEffect, useState } from "react";
import { api } from "../api";
import { usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";
import Modal from "../components/Modal";
import { PortalTop, PortalHero, PortalMini, PortalTabs, PortalCols, PortalPane, PortalCard, BarraDivergente, MovRow, SolicitudesRetiro, colorSigno, montoSigno } from "../components/PortalUI";

const MEDIO_LABEL: Record<string, string> = {
  SIN_TESORERIA: "Sin tesorería",
  USDT: "USDT",
  EFECTIVO: "Efectivo",
  ZELLE: "Zelle",
  OTRO: "Otro",
};

type Tab = "saldos" | "cierres" | "pagos" | "solicitudes";

// Portal del rol PROVEEDOR (16/10/2026, pedido de Leo: "agregarlos como usuarios y darles los
// permisos como hacemos con los supervisores") -- mismo dato que el admin ve en Administración ->
// Proveedores, filtrado a sí mismo (ver routes/portal.ts GET /mi-proveedor). Sin acciones de carga: ni
// cierres ni pagos se cargan desde acá, eso es exclusivo del admin. Sí puede pedir retiros/pagos.
//
// (19/10/2026, pedido de Leo, mockups aprobados) Rediseño: tarjeta principal con el saldo total y el
// botón de retiro adentro, saldo por club con barra divergente, cierres y pagos como tarjetas/filas
// (eran 4 tablas), pestañas en celular y todo a la vista en dos columnas en escritorio.
export default function MiProveedor() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("saldos");
  const [cierresAbiertos, setCierresAbiertos] = useState<Set<string>>(new Set());
  const [lineasPorCierre, setLineasPorCierre] = useState<Record<string, any[]>>({});

  // Solicitudes de retiro/pago del propio proveedor (16/10/2026, pedido de Leo: "necesito todo
  // esto mismo para la sección de proveedores") -- ver routes/portal.ts POST/GET
  // /mi-proveedor/solicitudes-retiro. El admin resuelve desde Administración -> Proveedores,
  // eligiendo el club (el saldo del proveedor SÍ está separado por club).
  const [misSolicitudes, setMisSolicitudes] = useState<any[] | null>(null);
  const [showSolicitar, setShowSolicitar] = useState(false);

  function refrescarMisSolicitudes() {
    api.misSolicitudesRetiroProveedor().then(setMisSolicitudes);
  }

  useEffect(() => {
    api.miProveedor().then(setData).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    refrescarMisSolicitudes();
  }, []);

  if (error) return <div className="error">No se pudo cargar: {error}</div>;
  if (!data) return <Loading />;

  const saldos: any[] = data.saldos ?? [];
  const cierres: any[] = data.cierres ?? [];
  const pagos: any[] = data.pagos ?? [];
  const saldoTotal = saldos.reduce((s, x) => s + Number(x.amount), 0);
  const maxAbs = Math.max(...saldos.map((s) => Math.abs(Number(s.amount))), 1);
  const ultimoCierre = cierres.find((c) => c.status !== "REVERTIDO");
  const ultimoPago = pagos.find((p) => p.status !== "REVERTIDO");

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "saldos", label: "Saldo por club", count: saldos.length },
    { key: "cierres", label: "Cierres", count: cierres.length },
    { key: "pagos", label: "Pagos y cobros", count: pagos.length },
    { key: "solicitudes", label: "Solicitudes", count: misSolicitudes?.length ?? 0 },
  ];

  const minis = [
    ...(ultimoCierre
      ? [
          <PortalMini
            key="c"
            label="Último cierre"
            value={montoSigno(Number(ultimoCierre.cierre))}
            sub={`${dateShort(ultimoCierre.week_start).slice(0, 5)} al ${dateShort(ultimoCierre.week_end).slice(0, 5)}`}
            color={colorSigno(Number(ultimoCierre.cierre))}
          />,
        ]
      : []),
    ...(ultimoPago
      ? [<PortalMini key="p" label="Último movimiento" value={usdCents(Number(ultimoPago.amount))} sub={`${ultimoPago.direction === "PAGO" ? "Pago" : "Cobro"} · ${dateShort(ultimoPago.occurred_at).slice(0, 5)}`} />]
      : []),
  ];

  const saldosPane = (
    <PortalPane activa={tab === "saldos"} titulo="Saldo por club">
      {saldos.length === 0 ? (
        <div className="muted">Todavía no tenés saldo cargado en ningún club.</div>
      ) : (
        saldos.map((s: any) => <PortalCard key={s.id} titulo={s.club_name} monto={Number(s.amount)} barra={<BarraDivergente monto={Number(s.amount)} max={maxAbs} />} />)
      )}
    </PortalPane>
  );

  // Cada cierre semanal se despliega con un toque y muestra sus líneas (club y/o agente) con el desglose que ya
  // ve el admin (19/10/2026, pedido de Leo -- igual que el cierre del supervisor). Solo lectura: las líneas
  // se piden al servidor recién al abrir, y el servidor solo las entrega si el cierre es del propio proveedor.
  function toggleCierre(id: string) {
    const abrir = !cierresAbiertos.has(id);
    setCierresAbiertos((prev) => {
      const next = new Set(prev);
      if (abrir) next.add(id);
      else next.delete(id);
      return next;
    });
    if (abrir && !lineasPorCierre[id]) {
      api
        .miProveedorLineasCierre(id)
        .then((l: any[]) => setLineasPorCierre((prev) => ({ ...prev, [id]: l })))
        .catch(() => setLineasPorCierre((prev) => ({ ...prev, [id]: [] })));
    }
  }
  const cierresPane = (
    <PortalPane activa={tab === "cierres"} titulo="Cierres semanales">
      {cierres.length === 0 ? (
        <div className="muted">Todavía no hay ningún cierre cargado.</div>
      ) : (
        <div style={{ maxHeight: 640, overflowY: "auto" }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Tocá una semana para ver de dónde sale ese cierre.</div>
          {cierres.map((c: any) => {
            const abierto = cierresAbiertos.has(c.id);
            const monto = Number(c.cierre);
            const lineas: any[] | undefined = lineasPorCierre[c.id];
            return (
              <div key={c.id} className={`pt-card${monto < 0 ? " ng" : ""}${c.status === "REVERTIDO" ? " rev" : ""}`} style={{ cursor: "pointer" }} onClick={() => toggleCierre(c.id)}>
                <div className="b">
                  <div className="t1">
                    <span className="n"><span style={{ color: "var(--text-faint)", marginRight: 6 }}>{abierto ? "▾" : "▸"}</span>{dateShort(c.week_start).slice(0, 5)} al {dateShort(c.week_end).slice(0, 5)}</span>
                    <span className="amt" style={{ color: colorSigno(monto) }}>{montoSigno(monto)}</span>
                  </div>
                  <div className="t2">
                    <span>{c.status === "REVERTIDO" ? "Revertido" : ""}</span>
                    <span>{c.status === "REVERTIDO" ? undefined : <span className="pill g">Aplicado</span>}</span>
                  </div>
                  {abierto && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
                      {!lineas ? (
                        <div className="saldo-sub">Cargando detalle…</div>
                      ) : lineas.length === 0 ? (
                        <div className="saldo-sub">Este cierre no tiene detalle cargado (formato anterior).</div>
                      ) : (
                        lineas.map((l: any, i: number) => {
                          const esAgente = l.tipo === "AGENTE";
                          const resultado = esAgente ? l.wc_result : l.resultado_total;
                          const rake = esAgente ? l.wc_rake_total : l.rake_total;
                          const pctRb = esAgente ? l.wc_rakeback_pct : l.rakeback_pct;
                          const rodeo = esAgente ? l.wc_rodeo : l.impacto_rodeo;
                          const dato = (x: any) => (x !== null && x !== undefined);
                          return (
                            <div key={l.id ?? i} style={{ marginTop: i ? 12 : 0, paddingTop: i ? 12 : 0, borderTop: i ? "1px dashed var(--border)" : undefined }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                <div style={{ fontWeight: 650 }}>{l.club_name}{esAgente && l.agent_name ? ` · ${l.agent_name}` : ""}</div>
                                <span className="pill">{esAgente ? "Agente" : "Club total"}</span>
                              </div>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px", fontSize: 12.5, marginTop: 8 }}>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>Resultado</div><b>{dato(resultado) ? usdCents(Number(resultado)) : "—"}</b></div>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>Rake</div><b>{dato(rake) ? usdCents(Number(rake)) : "—"}</b></div>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>% rakeback</div><b>{dato(pctRb) ? `${Math.round(Number(pctRb) * 10000) / 100}%` : "—"}</b></div>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>Rebate del club</div><b>{dato(l.club_rebate) ? usdCents(Number(l.club_rebate)) : "—"}</b></div>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>Rodeo</div><b>{dato(rodeo) ? usdCents(Number(rodeo)) : "—"}</b></div>
                                <div><div className="saldo-sub" style={{ margin: 0 }}>Monto bruto</div><b>{usdCents(Number(l.monto_crudo))}</b></div>
                              </div>
                              <div className="saldo-sub" style={{ marginTop: 8 }}>Aplicado a tu saldo: <b style={{ color: colorSigno(Number(l.monto_aplicado)) }}>{montoSigno(Number(l.monto_aplicado))}</b></div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PortalPane>
  );

  const pagosPane = (
    <PortalPane activa={tab === "pagos"} titulo="Pagos y cobros">
      {pagos.length === 0 ? (
        <div className="muted">Todavía no hay ningún pago o cobro registrado.</div>
      ) : (
        <div className="mov-list" style={{ maxHeight: 560, overflowY: "auto" }}>
          {pagos.map((p: any) => (
            <MovRow
              key={p.id}
              type={p.direction === "PAGO" ? "PAGO" : "COBRO"}
              titulo={p.direction === "PAGO" ? "Pago" : "Cobro"}
              detalle={`${p.club_name} · ${MEDIO_LABEL[p.medio] ?? p.medio} · ${dateShort(p.occurred_at)}`}
              monto={Math.abs(Number(p.amount))}
              atenuada={p.status === "REVERTIDO"}
              extra={p.status === "REVERTIDO" ? <span className="pill">Revertido</span> : undefined}
            />
          ))}
        </div>
      )}
    </PortalPane>
  );

  const solicitudesPane = (
    <PortalPane activa={tab === "solicitudes"} titulo="Tus solicitudes de retiro">
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
          <h2>Hola, {data.proveedor.name}</h2>
          <div className="muted">Tu saldo, cierres semanales y pagos.</div>
        </div>
      </div>

      <PortalTop
        hero={
          <PortalHero
            label="Saldo total"
            amount={montoSigno(saldoTotal)}
            color={colorSigno(saldoTotal)}
            foot={
              <>
                <span>{saldos.length} club{saldos.length === 1 ? "" : "es"} con saldo</span>
                <span>{data.proveedor.name}</span>
              </>
            }
            cta={{ label: "+ Solicitar retiro / pago", onClick: () => setShowSolicitar(true) }}
          />
        }
        minis={minis}
      />

      <PortalTabs tabs={tabs} value={tab} onChange={setTab} />

      <PortalCols
        left={
          <>
            {saldosPane}
            {cierresPane}
          </>
        }
        right={
          <>
            {pagosPane}
            {solicitudesPane}
          </>
        }
      />

      {showSolicitar && (
        <Modal title="Solicitar retiro / pago" onClose={() => setShowSolicitar(false)}>
          <SolicitarRetiroProveedorForm
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

function SolicitarRetiroProveedorForm({ onDone }: { onDone: () => void }) {
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
      await api.solicitarRetiroProveedor({ amount: amountNum, nota: nota.trim() || null });
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
