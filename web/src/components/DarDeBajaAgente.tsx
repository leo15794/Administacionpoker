import { useEffect, useState } from "react";
import { api } from "../api";
import Modal from "./Modal";
import Loading from "./Loading";

// Dar de baja un agente que ya no trabaja (19/11/2026, pedido de Leo, mockup 99). Se usa en Agentes, Supervisores
// (cuenta y agentes a cargo) y Administración. Solo se puede con todo en 0: si tiene saldo, ofrece saldarlo primero.
const fmt = (n: number) => `${n < -0.004 ? "−" : ""}US$ ${Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function DarDeBajaAgente({
  agentId,
  name,
  onClose,
  onDone,
  onSaldar,
}: {
  agentId: string;
  name: string;
  onClose: () => void;
  onDone: () => void;
  /** Si se pasa, cuando tiene saldo aparece el botón para registrar el pago o cobro (recibe el saldo de la cuenta corriente). */
  onSaldar?: (cuentaCorriente: number) => void;
}) {
  const [ch, setCh] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.chequeoBajaAgente(agentId).then(setCh).catch((e) => setError(e.message || "No se pudo revisar el saldo."));
  }, [agentId]);

  const conPlata: { donde: string; monto: number }[] = (ch?.saldos ?? []).filter((s: any) => Math.abs(s.monto) >= 0.01);
  const cc = conPlata.find((s) => s.donde === "Cuenta corriente")?.monto ?? 0;

  async function confirmar() {
    setGuardando(true);
    setError(null);
    try {
      await api.editarAgente(agentId, { active: false });
      onDone();
    } catch (e: any) {
      setError(e.message || "No se pudo dar de baja.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal title={`¿Dar de baja a ${name}?`} onClose={onClose}>
      <div className="bj-sub">Para agentes que ya no trabajan más con nosotros. Se puede reactivar cuando quieras desde "Dados de baja".</div>
      {!ch && !error ? (
        <Loading />
      ) : (
        <>
          {ch && (
            <>
              <div className="bj-two">
                <div className="bj-box">
                  <h4>DEJA DE APARECER EN</h4>
                  <div><span className="x">✕</span>Agentes, Supervisores y Administración</div>
                  <div><span className="x">✕</span>Resumen, Saldos y Liquidaciones</div>
                  <div><span className="x">✕</span>Listas para cargar movimientos y cierres</div>
                  <div><span className="x">✕</span>"Para hacer" y avisos</div>
                  <div><span className="x">✕</span>Su acceso al portal (no puede entrar)</div>
                </div>
                <div className="bj-box">
                  <h4>SE CONSERVA</h4>
                  <div><span className="k">✓</span>Movimientos y cierres ya cargados</div>
                  <div><span className="k">✓</span>Semanas pasadas en reportes y PDFs</div>
                  <div><span className="k">✓</span>Los números de su supervisor y proveedor</div>
                  <div><span className="k">✓</span>Si aparece en un reporte nuevo, avisa</div>
                </div>
              </div>
              {ch.bloqueos.map((b: string) => (
                <div key={b} className="em-note w"><i>!</i><div>{b}</div></div>
              ))}
              {conPlata.length > 0 ? (
                <div className="em-note w">
                  <i>!</i>
                  <div>
                    Todavía tiene saldo:{" "}
                    {conPlata.map((s, i) => (
                      <span key={s.donde}>{i > 0 ? " · " : ""}<b>{s.donde}: {fmt(s.monto)}</b>{s.donde === "Cuenta corriente" ? (s.monto > 0 ? " (le debemos)" : " (nos debe)") : ""}</span>
                    ))}
                    . Dejalo en 0 con un pago o cobro y después lo das de baja.
                  </div>
                </div>
              ) : (
                ch.puede && <div className="em-note ok"><i>✓</i><div>Saldo en <b>US$ 0</b> en todas sus cuentas: se puede dar de baja.</div></div>
              )}
            </>
          )}
          {error && <div className="error">{error}</div>}
          <div className="em-bs">
            <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
            {ch?.puede ? (
              <button type="button" className="btn bj-danger" disabled={guardando} onClick={confirmar}>{guardando ? "Dando de baja..." : "Dar de baja"}</button>
            ) : (
              onSaldar && conPlata.length > 0 && Math.abs(cc) >= 0.01 && (
                <button type="button" className="btn" onClick={() => onSaldar(cc)}>{cc > 0 ? "Registrar pago" : "Registrar cobro"}</button>
              )
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
