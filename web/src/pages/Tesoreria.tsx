import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";

const LEDGER_LABEL: Record<string, string> = {
  WALLET_MANOS: "Wallet USDT",
  CAJA_EFECTIVO: "Caja efectivo",
};

export default function Tesoreria() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.tesoreria().then(setData);
  }, []);

  if (!data) return <div className="muted">Cargando...</div>;

  const wallet = data.porLedger.find((l: any) => l.ledger === "WALLET_MANOS");
  const caja = data.porLedger.find((l: any) => l.ledger === "CAJA_EFECTIVO");

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Tesorería</h2>
          <div className="muted">Se arma sola a partir de los movimientos cargados con medio de pago USDT o Efectivo — nada se carga acá directamente.</div>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="label">Wallet USDT (neto)</div>
          <div className={`value ${!wallet || Number(wallet.neto) >= 0 ? "pos" : "neg"}`}>{usd(wallet?.neto ?? 0)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Caja efectivo (neto)</div>
          <div className={`value ${!caja || Number(caja.neto) >= 0 ? "pos" : "neg"}`}>{usd(caja?.neto ?? 0)}</div>
        </div>
      </div>

      <div className="panel">
        <h3>Efectivo por custodio</h3>
        {data.porCustodio.length === 0 ? (
          <div className="muted">Todavía no hay movimientos en efectivo cargados.</div>
        ) : (
          <table>
            <thead><tr><th>Custodio</th><th>Neto en su poder</th><th>Movimientos</th></tr></thead>
            <tbody>
              {data.porCustodio.map((c: any) => (
                <tr key={c.custodio}>
                  <td>{c.custodio}</td>
                  <td><span className={`badge ${Number(c.neto) >= 0 ? "pos" : "neg"}`}>{usd(c.neto)}</span></td>
                  <td className="muted">{c.movimientos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <div className="topbar" style={{ marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Últimos movimientos de tesorería</h3>
          <button
            className="btn secondary small"
            onClick={() =>
              exportCsv(
                "tesoreria.csv",
                data.ultimosMovimientos.map((m: any) => ({
                  fecha: m.occurred_at,
                  ledger: LEDGER_LABEL[m.ledger] ?? m.ledger,
                  direccion: m.direction,
                  monto: m.amount,
                  custodio: m.custodian ?? "",
                  agente: m.agent_name,
                  observacion: m.observation ?? "",
                }))
              )
            }
          >
            Exportar CSV
          </button>
        </div>
        {data.ultimosMovimientos.length === 0 ? (
          <div className="muted">Sin movimientos todavía.</div>
        ) : (
          <table>
            <thead><tr><th>Fecha</th><th>Tesorería</th><th>Dirección</th><th>Monto</th><th>Custodio</th><th>Agente</th></tr></thead>
            <tbody>
              {data.ultimosMovimientos.map((m: any) => (
                <tr key={m.id}>
                  <td>{dateShort(m.occurred_at)}</td>
                  <td><span className="badge neutral">{LEDGER_LABEL[m.ledger] ?? m.ledger}</span></td>
                  <td className="muted">{m.direction === "INGRESO" ? "Ingreso" : "Egreso"}</td>
                  <td><span className={`badge ${m.direction === "INGRESO" ? "pos" : "neg"}`}>{usd(m.amount)}</span></td>
                  <td>{m.custodian || "—"}</td>
                  <td>{m.agent_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
