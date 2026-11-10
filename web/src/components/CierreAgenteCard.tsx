import { useState } from "react";
import { usdCents, dateShort } from "../fmt";

// Cierre del agente de un supervisor (10/11/2026, mockup 86) y del subagente (mockup 87): se toca y muestra el desglose y sus jugadores.
const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const conSigno = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Number(n) > 0 ? "+" : Number(n) < 0 ? "−" : ""}${num(Math.abs(Number(n)))}`);
const claseSigno = (n: number | null | undefined) => (n === null || n === undefined || Number(n) === 0 ? "" : Number(n) < 0 ? "neg" : "pos");

export default function CierreAgenteCard({ c, abiertoInicial }: { c: any; abiertoInicial: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const jug: any[] = c.jugadores_detalle ?? [];
  const sinMonto = c.final_closing === null || c.final_closing === undefined;
  const pct = c.rakeback_pct === null || c.rakeback_pct === undefined ? "" : ` ${(Math.round(Number(c.rakeback_pct) * 10000) / 100).toLocaleString("es-AR")}%`;
  const sistema = c.system === "PREPAGO" ? "Prepago" : c.system === "WIN_LOSE" ? "Win/Lose" : null;
  const suma = (k: string) => jug.reduce((t, j) => t + Number(j[k] ?? 0), 0);
  return (
    <div className={`ca-card${abierto ? " open" : ""}`}>
      <button type="button" className="ca-h" onClick={() => setAbierto(!abierto)}>
        <span className="ca-car">{abierto ? "▾" : "▸"}</span>
        <span className="ca-t">
          <b>{dateShort(c.week_start).slice(0, 5)} al {dateShort(c.week_end).slice(0, 5)}</b>
          <small>{c.club_name}{sistema ? ` · ${sistema}` : ""}</small>
        </span>
        {jug.length > 0 && <span className="ca-pill">{jug.length} {jug.length === 1 ? "jugador" : "jugadores"}</span>}
        <span className={`ca-m ${sinMonto ? "" : claseSigno(c.final_closing)}`}>{sinMonto ? "Sin acuerdo" : usdCents(c.final_closing)}</span>
      </button>
      {abierto && (
        <div className="ca-body">
          {c.sin_acuerdo ? (
            <div className="ca-aviso">Este cierre todavía no tiene monto: faltan cargar tus % en este club.</div>
          ) : (
            <>
              <div className="ca-lbl">Desglose del cierre</div>
              <div className="ca-des">
                <div><small>Resultado</small><b className={claseSigno(c.result)}>{conSigno(c.result)}</b></div>
                <div><small>Rake</small><b>{num(c.rake_total)}</b></div>
                <div><small>Rakeback{pct}</small><b className={claseSigno(c.rakeback)}>{conSigno(c.rakeback)}</b></div>
                <div><small>Rebate</small><b className={claseSigno(c.rebate)}>{conSigno(c.rebate)}</b></div>
                <div className="tot"><small>Cierre</small><b className={claseSigno(c.final_closing)}>{conSigno(c.final_closing)}</b></div>
              </div>
            </>
          )}
          {jug.length === 0 ? (
            <div className="ca-aviso">Este club no informa el detalle por jugador: solo se ve el total del cierre.</div>
          ) : (
            <>
              <div className="ca-lbl">Mis jugadores</div>
              <table className="ca-tabla">
                <thead>
                  <tr><th>Jugador</th><th>Resultado</th><th>Rake</th><th>Rakeback</th><th>Rebate</th><th>Cierre</th></tr>
                </thead>
                <tbody>
                  {jug.map((j) => (
                    <tr key={j.id}>
                      <td><b>{j.nombre}</b><span className="id">{j.id}</span></td>
                      <td className={claseSigno(j.resultado)}>{conSigno(j.resultado)}</td>
                      <td>{num(j.rake)}</td>
                      <td className={claseSigno(j.rakeback)}>{conSigno(j.rakeback)}</td>
                      <td className={claseSigno(j.rebate)}>{conSigno(j.rebate)}</td>
                      <td className={claseSigno(j.cierre)}><b>{conSigno(j.cierre)}</b></td>
                    </tr>
                  ))}
                </tbody>
                {jug.length > 1 && (
                  <tfoot>
                    <tr>
                      <td>Total · {jug.length} jugadores</td>
                      <td className={claseSigno(suma("resultado"))}>{conSigno(suma("resultado"))}</td>
                      <td>{num(suma("rake"))}</td>
                      <td>{c.sin_acuerdo ? "—" : conSigno(suma("rakeback"))}</td>
                      <td>{c.sin_acuerdo ? "—" : conSigno(suma("rebate"))}</td>
                      <td className={c.sin_acuerdo ? "" : claseSigno(suma("cierre"))}>{c.sin_acuerdo ? "—" : conSigno(suma("cierre"))}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
              <div className="ca-movil">
                {jug.map((j) => (
                  <div key={j.id} className="ca-j">
                    <div className="r1"><span>{j.nombre}</span><span className={claseSigno(j.cierre)}>{conSigno(j.cierre)}</span></div>
                    <div className="r2">
                      <span>Res {conSigno(j.resultado)} · Rake {num(j.rake)}</span>
                      <span>RB {conSigno(j.rakeback)}{j.rebate ? ` · Reb ${conSigno(j.rebate)}` : ""}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
