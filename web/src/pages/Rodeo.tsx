import { useEffect, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";

// "Resumen de Rodeo" (23/09/2026, pedido de Leo): una fila por agente+club con la memoria
// vigente y el acumulado histórico de rodeo pagado -- para poder ver de un vistazo si la
// memoria se está comportando bien, mismo criterio que el panel de resumen de Jugadores
// Bancados (JugadoresBancados.tsx). La memoria en sí (rodeo_agent_memory) y toda la lógica de
// cálculo están en engine/rodeo.ts y repo/rodeo.ts -- acá solo se lee y se muestra, no se
// edita nada (no hay, por ahora, una forma de corregir la memoria a mano como sí existe para
// el capital/makeup de bancados).
export default function Rodeo() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.resumenRodeo().then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Resumen de Rodeo</h2>
          <div className="muted">
            Memoria vigente y acumulado de Rodeo por agente y club (solo SupremaPoker: Fénix, TeamBack) — para chequear
            que la memoria se esté comportando como corresponde. Cuando el agente viene ganando en mesas, esa pérdida
            se acumula acá como memoria pendiente y se descuenta de lo que genere en semanas futuras antes de repartir
            nada.
          </div>
        </div>
      </div>

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

      <div className="panel" style={{ marginTop: 16 }}>
        {!rows ? (
          <div className="muted">Cargando...</div>
        ) : rows.length === 0 ? (
          <div className="muted">Todavía no hay ningún agente con Rodeo cargado.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>Club</th>
                  <th>Semanas con Rodeo</th>
                  <th>Última semana</th>
                  <th>Rodeo pagado a agente (acum.)</th>
                  <th title="Informativo, nunca se acredita a nadie">Rodeo club (acum., info.)</th>
                  <th>Memoria actual</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.agentId}_${r.clubId}`}>
                    <td>{r.agentName}</td>
                    <td>{r.clubName}</td>
                    <td>{r.semanasConRodeo}</td>
                    <td className="muted">{r.ultimaSemana ? dateShort(r.ultimaSemana) : "-"}</td>
                    <td><span className={`badge ${Number(r.rodeoPagadoAgenteTotal) >= 0 ? "pos" : "neg"}`}>{usd(r.rodeoPagadoAgenteTotal)}</span></td>
                    <td className="muted">{usd(r.rodeoClubTotal)}</td>
                    <td>
                      <strong className={Number(r.memoriaActual) > 0 ? "neg" : "pos"}>{usd(r.memoriaActual)}</strong>
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
