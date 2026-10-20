import { useEffect, useState } from "react";
import { api } from "../api";
import { usdCents, dateShort } from "../fmt";
import Loading from "../components/Loading";
import MiCuentaAgente from "./MiCuentaAgente";
import { PortalTop, PortalHero, PortalMini, PortalTabs, PortalCols, PortalPane, PortalCard, BarraDivergente, MovRow, colorSigno, montoSigno } from "../components/PortalUI";

// Saldo neto por club (01/10/2026): para PREPAGO, balances.amount solo no alcanza -- hay que
// sumarle el resultado acumulado de mesas (ver fichasTotal() en Resumen.tsx, misma fórmula).
function saldoNeto(b: any): number {
  if (b.system === "PREPAGO") return Number(b.amount) + Number(b.total_fichas_ganadas_mesas || 0);
  return Number(b.amount);
}

type Tab = "saldos" | "cierres" | "movimientos";

// (19/10/2026, pedido de Leo, mockups aprobados) Portal del agente rediseñado: tarjeta principal con
// el saldo, cierres y movimientos como tarjetas/filas (en celular la tabla de movimientos cortaba la
// columna Monto y mostraba los tipos con el nombre interno), pestañas en celular y todo a la vista
// en escritorio. Mismos datos y endpoints de siempre.
export default function MiCuenta() {
  const [misAgentes, setMisAgentes] = useState<any[]>([]);
  const [agentId, setAgentId] = useState<string>("");
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("cierres");

  // La mayoría de los logins tienen una sola cuenta — el selector solo aparece si de verdad hay
  // más de una asociada (ver Usuarios y permisos → "Agentes/clubes que puede ver").
  useEffect(() => {
    api.misAgentes().then(setMisAgentes).catch(() => {});
  }, []);

  useEffect(() => {
    api.miCuenta(agentId || undefined).then(setData);
  }, [agentId]);

  if (!data) return <Loading />;
  // Agente con cuenta propia en la sección Agentes: "Mi cuenta" muestra esa cuenta (20/10/2026).
  if (data.cuenta) return <MiCuentaAgente data={data} misAgentes={misAgentes} agentId={agentId} setAgentId={setAgentId} />;

  const totalNeto = data.saldos.reduce((s: number, b: any) => s + saldoNeto(b), 0);
  const variosClubes = data.saldos.length > 1;
  const cierres: any[] = data.cierres ?? [];
  const ultimos = cierres.slice(0, 4);
  const sumaUltimos = ultimos.reduce((s, c) => s + Number(c.final_closing), 0);
  const maxAbs = Math.max(...data.saldos.map((b: any) => Math.abs(saldoNeto(b))), 1);
  const sistema = data.agente.default_system === "PREPAGO" ? "Prepago" : "Win/Lose";

  // "Saldo por club" solo suma algo cuando hay más de un club -- con uno solo es el mismo número
  // de la tarjeta principal.
  const tabActual: Tab = !variosClubes && tab === "saldos" ? "cierres" : tab;
  const tabs = [
    ...(variosClubes ? [{ key: "saldos" as Tab, label: "Saldo por club", count: data.saldos.length }] : []),
    { key: "cierres" as Tab, label: "Cierres", count: cierres.length },
    { key: "movimientos" as Tab, label: "Movimientos", count: data.movimientos.length },
  ];

  const minis = [
    ...(ultimos[0]
      ? [
          <PortalMini key="u" label="Último cierre" value={usdCents(ultimos[0].final_closing)} sub={`${dateShort(ultimos[0].week_start).slice(0, 5)} al ${dateShort(ultimos[0].week_end).slice(0, 5)}`} color={colorSigno(Number(ultimos[0].final_closing))} />,
        ]
      : []),
    ...(ultimos.length > 1 ? [<PortalMini key="s" label={`Últimos ${ultimos.length} cierres`} value={montoSigno(sumaUltimos)} sub={`suma de las ${ultimos.length} semanas`} />] : []),
    ...(data.garantia ? [<PortalMini key="g" label="Garantía vigente" value={usdCents(data.garantia.amount)} />] : []),
  ];

  const saldosPane = (
    <PortalPane activa={tabActual === "saldos"} titulo="Mi saldo por club">
      {data.saldos.map((b: any) => (
        <PortalCard key={b.id} titulo={b.club_name} monto={saldoNeto(b)} izq={b.system === "PREPAGO" ? "Prepago" : "Win/Lose"} barra={<BarraDivergente monto={saldoNeto(b)} max={maxAbs} />} />
      ))}
    </PortalPane>
  );

  const cierresPane = (
    <PortalPane activa={tabActual === "cierres"} titulo="Mis últimos cierres semanales">
      {cierres.length === 0 ? (
        <div className="muted">Todavía no hay cierres semanales cargados.</div>
      ) : (
        cierres.map((c: any) => (
          <PortalCard key={c.id} titulo={`${dateShort(c.week_start).slice(0, 5)} al ${dateShort(c.week_end).slice(0, 5)}`} monto={Number(c.final_closing)} izq={c.club_name} der="Cierre final" />
        ))
      )}
    </PortalPane>
  );

  const movimientosPane = (
    <PortalPane activa={tabActual === "movimientos"} titulo="Mis movimientos recientes">
      {data.movimientos.length === 0 ? (
        <div className="muted">Todavía no hay movimientos registrados en el sistema nuevo.</div>
      ) : (
        <div className="mov-list">
          {data.movimientos.map((m: any) => (
            <MovRow key={m.id} type={m.type} detalle={`${m.club_name} · ${dateShort(m.occurred_at)}`} monto={Number(m.amount)} />
          ))}
        </div>
      )}
    </PortalPane>
  );

  return (
    <div>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <h2>Hola, {data.agente.name}</h2>
          <div className="muted">Sistema: {sistema}{data.agente.supervisor ? ` · Supervisor: ${data.agente.supervisor}` : ""}</div>
        </div>
        {misAgentes.length > 1 && (
          <div className="field" style={{ margin: 0 }}>
            <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Ver cuenta de</label>
            <select value={agentId || data.agente.id} onChange={(e) => setAgentId(e.target.value)}>
              {misAgentes.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <PortalTop
        hero={
          <PortalHero
            label="Tu saldo neto"
            amount={montoSigno(totalNeto)}
            color={colorSigno(totalNeto)}
            foot={
              <>
                <span>{variosClubes ? `${data.saldos.length} clubes` : data.saldos[0]?.club_name ?? "Sin clubes todavía"}</span>
                <span>{sistema}</span>
              </>
            }
          />
        }
        minis={minis}
      />

      <PortalTabs tabs={tabs} value={tabActual} onChange={setTab} />

      <PortalCols
        left={
          <>
            {variosClubes && saldosPane}
            {cierresPane}
          </>
        }
        right={movimientosPane}
      />
    </div>
  );
}
