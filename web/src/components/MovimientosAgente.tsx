import { useState } from "react";
import { usdCents, dateShort } from "../fmt";

// Movimientos de la cuenta del agente de un supervisor (11/11/2026, pedido de Leo, mockup 90): cargas y descargas de fichas, pagos, pagos
// de rakeback y ajustes, agrupados por semana; arriba lo del mes y los adelantos de rakeback vigentes. Sin saldo (ver portal.ts,
// movimientosCuentaAgente).
const TIPOS: Record<string, { txt: string; ic: string; cls: string; grupo: string }> = {
  CARGA: { txt: "Carga de fichas", ic: "↑", cls: "c", grupo: "cargas" },
  DESCARGA: { txt: "Descarga de fichas", ic: "↓", cls: "d", grupo: "descargas" },
  PAGO: { txt: "Pago", ic: "$", cls: "p", grupo: "pagos" },
  PAGO_RAKEBACK: { txt: "Pago de rakeback", ic: "%", cls: "r", grupo: "pagos" },
  AJUSTE: { txt: "Ajuste", ic: "±", cls: "a", grupo: "otros" },
};
const tipo = (t: string) => TIPOS[t] ?? { txt: t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " "), ic: "•", cls: "a", grupo: "otros" };
const num = (n: number) => Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Lunes de la semana de una fecha (las semanas del club van de lunes a domingo).
function lunes(fecha: string) {
  const d = new Date(String(fecha).slice(0, 10) + "T12:00:00Z");
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}
function finSemana(lun: string) {
  const d = new Date(lun + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

type Filtro = "todos" | "cargas" | "descargas" | "pagos" | "adelantos";

export default function MovimientosAgente({ movimientos, adelantos }: { movimientos: any[]; adelantos: any[] }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const mes = new Date().toISOString().slice(0, 7);
  const delMes = movimientos.filter((m) => String(m.fecha).slice(0, 7) === mes);
  const suma = (g: string) => delMes.filter((m) => tipo(m.tipo).grupo === g).reduce((t, m) => t + Math.abs(Number(m.monto)), 0);
  const cuenta = (g: string) => delMes.filter((m) => tipo(m.tipo).grupo === g).length;
  const totalAdelantos = adelantos.reduce((t, a) => t + Number(a.amount), 0);
  const nombreMes = new Date().toLocaleString("es-AR", { month: "long" });

  const visibles = filtro === "todos" || filtro === "adelantos" ? movimientos : movimientos.filter((m) => tipo(m.tipo).grupo === filtro);
  const semanas: { lun: string; items: any[] }[] = [];
  for (const m of visibles) {
    const l = lunes(m.fecha);
    const s = semanas[semanas.length - 1];
    if (s && s.lun === l) s.items.push(m);
    else semanas.push({ lun: l, items: [m] });
  }
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

  return (
    <div className="mva-mov">
      <div className="mva-kpis">
        <div><small>Cargas de fichas</small><b className="pos">{usdCents(suma("cargas"))}</b><span>en {nombreMes} · {plural(cuenta("cargas"), "carga", "cargas")}</span></div>
        <div><small>Descargas de fichas</small><b className="neg">{usdCents(suma("descargas"))}</b><span>en {nombreMes} · {plural(cuenta("descargas"), "descarga", "descargas")}</span></div>
        <div><small>Pagos recibidos</small><b>{usdCents(suma("pagos"))}</b><span>en {nombreMes} · {plural(cuenta("pagos"), "pago", "pagos")}</span></div>
        <div><small>Adelantos de rakeback</small><b className="amb">{usdCents(totalAdelantos)}</b><span>{adelantos.length ? plural(adelantos.length, "adelanto vigente", "adelantos vigentes") : "sin adelantos vigentes"}</span></div>
      </div>

      <div className="mva-filtros">
        {(["todos", "cargas", "descargas", "pagos", "adelantos"] as Filtro[]).map((f) => (
          <button key={f} type="button" className={filtro === f ? "on" : ""} onClick={() => setFiltro(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtro === "adelantos" ? (
        <div className="mva-lista">
          {adelantos.length === 0 ? (
            <div className="mva-vacio">No tenés adelantos de rakeback vigentes.</div>
          ) : (
            adelantos.map((a) => (
              <div key={a.id} className="mva-mv">
                <span className="mva-ic a">A</span>
                <span className="mva-t"><b>Adelanto de rakeback</b><small>{dateShort(a.created_at)}</small></span>
                <span className="mva-m amb">{num(Number(a.amount))}</span>
              </div>
            ))
          )}
        </div>
      ) : semanas.length === 0 ? (
        <div className="mva-lista"><div className="mva-vacio">Todavía no hay movimientos.</div></div>
      ) : (
        <div className="mva-lista">
          {semanas.map((s) => (
            <div key={s.lun}>
              <div className="mva-sem">Semana del {dateShort(s.lun).slice(0, 5)} al {dateShort(finSemana(s.lun)).slice(0, 5)}</div>
              {s.items.map((m) => {
                const t = tipo(m.tipo);
                const signo = m.tipo === "CARGA" ? "pos" : m.tipo === "DESCARGA" ? "neg" : "";
                return (
                  <div key={m.id} className="mva-mv">
                    <span className={`mva-ic ${t.cls}`}>{t.ic}</span>
                    <span className="mva-t">
                      <b>{t.txt}</b>
                      <small>
                        {dateShort(m.fecha).slice(0, 5)}
                        {m.club ? ` · ${m.club}` : ""}
                        {m.nota ? ` · “${m.nota}”` : ""}
                      </small>
                    </span>
                    <span className={`mva-m ${signo}`}>
                      {m.tipo === "CARGA" ? "+" : m.tipo === "DESCARGA" ? "−" : Number(m.monto) < 0 ? "−" : ""}
                      {num(Number(m.monto))}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
