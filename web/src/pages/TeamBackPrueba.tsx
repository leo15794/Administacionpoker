import { useEffect, useState } from "react";
import { api } from "../api";
import { usdCents as usd, dateShort } from "../fmt";
import Loading from "../components/Loading";
import { Aviso } from "../components/Ayuda";

// Cuenta de prueba de TeamBack Afiliados (23/10/2026, pedido de Leo): jugadores de prueba con su login, a los que se les cargan cierres a
// mano para mostrar cómo funciona el portal del jugador. Quedan fuera de totales, ganancias, historial de pagos y avisos reales, y pagar
// una liquidación de prueba nunca mueve la Wallet. Ver src/repo/tbPrueba.ts.

// Lunes de la semana en curso (formato YYYY-MM-DD, hora local) como valor por defecto del cierre.
function lunesActual(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TeamBackPruebaTab() {
  const [data, setData] = useState<{ jugadores: any[]; semanas: any[] } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Alta de jugador de prueba
  const [nombre, setNombre] = useState("");
  const [usuario, setUsuario] = useState("");
  const [clave, setClave] = useState("");
  const [referidoPor, setReferidoPor] = useState("");

  // Carga de cierre
  const [jugadorId, setJugadorId] = useState("");
  const [semana, setSemana] = useState(lunesActual());
  const [rake, setRake] = useState("");

  async function cargar() {
    setData(await api.teamback.prueba.listar());
  }
  useEffect(() => {
    cargar().catch((e) => setMsg({ ok: false, text: e.message || "No se pudo cargar la cuenta de prueba." }));
  }, []);

  async function accion(fn: () => Promise<any>, okText: string) {
    setMsg(null);
    setOcupado(true);
    try {
      await fn();
      await cargar();
      setMsg({ ok: true, text: okText });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || "No se pudo completar la acción." });
    } finally {
      setOcupado(false);
    }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    await accion(async () => {
      await api.teamback.prueba.crearJugador({
        name: nombre,
        username: usuario.trim() || null,
        password: clave || null,
        referidoPorId: referidoPor || null,
      });
      setNombre("");
      setUsuario("");
      setClave("");
      setReferidoPor("");
    }, "Jugador de prueba creado.");
  }

  async function cargarCierre(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(String(rake).replace(",", "."));
    if (!jugadorId) return setMsg({ ok: false, text: "Elegí el jugador." });
    if (!Number.isFinite(n) || n < 0 || rake.trim() === "") return setMsg({ ok: false, text: "Poné el rake de la semana (número mayor o igual a 0)." });
    await accion(async () => {
      await api.teamback.prueba.cargarRake({ playerId: jugadorId, weekStart: semana, rake: n });
      setRake("");
    }, "Cierre cargado y liquidación calculada.");
  }

  if (!data) return <div className="panel"><Loading /></div>;

  const titulares = data.jugadores.filter((j) => !j.referido_por_id);
  const nombreDe = (id: string) => data.jugadores.find((j) => j.id === id)?.name ?? id;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <Aviso tipo="info">
          Jugadores de prueba para mostrar cómo funciona el portal: cargás el rake de cada semana a mano y se liquida igual que a un jugador real. No suman en totales, ganancias, historial de pagos ni avisos, y pagar acá no mueve la Wallet.
        </Aviso>
      </div>

      {msg && <div className={msg.ok ? "success" : "error"} style={{ marginBottom: 12 }}>{msg.text}</div>}

      <div className="panel" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Jugadores de prueba</h3>
        {data.jugadores.length === 0 ? (
          <div className="muted" style={{ marginBottom: 12 }}>Todavía no hay ninguno. Creá uno con usuario y contraseña para poder entrar al portal como jugador.</div>
        ) : (
          <div className="tablewrap" style={{ marginBottom: 14 }}>
            <table>
              <thead>
                <tr><th>Jugador</th><th>Usuario</th><th>Referido de</th><th></th></tr>
              </thead>
              <tbody>
                {data.jugadores.map((j) => (
                  <tr key={j.id}>
                    <td><b>{j.name}</b></td>
                    <td>{j.username ?? <span className="muted">sin login</span>}</td>
                    <td>{j.referido_por_id ? nombreDe(j.referido_por_id) : <span className="muted">—</span>}</td>
                    <td style={{ textAlign: "right" }}>
                      {!j.referido_por_id && (
                        <button
                          className="btn secondary small"
                          disabled={ocupado}
                          onClick={() => {
                            if (confirm(`¿Borrar la cuenta de prueba de ${j.name} y todo lo que cuelga de ella (referidos de prueba, cierres, usuario)?`)) {
                              accion(() => api.teamback.prueba.borrarJugador(j.id), "Cuenta de prueba borrada.");
                            }
                          }}
                        >
                          Borrar cuenta
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={crear} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, alignItems: "end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Nombre</label>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Jugador Demo" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Usuario (para entrar)</label>
            <input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Opcional en referidos" autoComplete="off" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Contraseña</label>
            <input value={clave} onChange={(e) => setClave(e.target.value)} placeholder="Mínimo 6" autoComplete="new-password" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Referido de</label>
            <select value={referidoPor} onChange={(e) => setReferidoPor(e.target.value)}>
              <option value="">— Ninguno (titular) —</option>
              {titulares.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          </div>
          <button className="btn" disabled={ocupado || !nombre.trim()}>+ Crear jugador de prueba</button>
        </form>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h3 style={{ marginTop: 0 }}>Cargar un cierre a mano</h3>
        {data.jugadores.length === 0 ? (
          <div className="muted">Primero creá un jugador de prueba.</div>
        ) : (
          <form onSubmit={cargarCierre} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, alignItems: "end" }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Jugador</label>
              <select value={jugadorId} onChange={(e) => setJugadorId(e.target.value)}>
                <option value="">Elegir...</option>
                {data.jugadores.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Semana (lunes)</label>
              <input type="date" value={semana} onChange={(e) => setSemana(e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Rake de la semana (USD)</label>
              <input value={rake} onChange={(e) => setRake(e.target.value)} inputMode="decimal" placeholder="0,00" />
            </div>
            <button className="btn" disabled={ocupado}>Cargar y calcular</button>
          </form>
        )}
        <div className="saldo-sub" style={{ marginTop: 10 }}>
          Cargá el rake del titular y de sus referidos de la misma semana para ver también la comisión por referidos. Si cargás de nuevo el mismo jugador y semana, se corrige.
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Cierres cargados</h3>
        {data.semanas.length === 0 ? (
          <div className="muted">Todavía no hay cierres de prueba.</div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Jugador</th><th>Semana</th><th className="num">Rake</th><th className="num">Rakeback</th><th className="num">Comisión</th><th className="num">Total</th><th>Estado</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.semanas.map((s) => (
                  <tr key={`${s.player_id}-${s.week_start}`}>
                    <td><b>{nombreDe(s.player_id)}</b></td>
                    <td>{dateShort(s.week_start)}</td>
                    <td className="num">{usd(Number(s.rake_bruto))}</td>
                    <td className="num">{s.liquidacion_id ? usd(Number(s.rakeback_generado)) : "—"}</td>
                    <td className="num">{s.liquidacion_id ? usd(Number(s.comision_3pct_acreditada)) : "—"}</td>
                    <td className="num"><b>{s.liquidacion_id ? usd(Number(s.total_acreditado)) : "—"}</b></td>
                    <td>{!s.liquidacion_id ? <span className="muted">sin liquidar</span> : s.pagado ? <span className="pill">Pagada · {s.medio_pago === "USDT" ? "USDT" : "Fichas"}</span> : <span className="muted">Pendiente</span>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {s.liquidacion_id && !s.pagado && (
                        <>
                          <button className="btn secondary small" disabled={ocupado} onClick={() => accion(() => api.teamback.marcarLiquidacionPagada(s.liquidacion_id, "USDT"), "Marcada como pagada en USDT (no mueve la Wallet).")}>Pagar USDT</button>{" "}
                          <button className="btn secondary small" disabled={ocupado} onClick={() => accion(() => api.teamback.marcarLiquidacionPagada(s.liquidacion_id, "FICHAS"), "Marcada como pagada en fichas.")}>Pagar fichas</button>{" "}
                        </>
                      )}
                      {s.liquidacion_id && s.pagado && (
                        <><button className="btn secondary small" disabled={ocupado} onClick={() => accion(() => api.teamback.marcarLiquidacionNoPagada(s.liquidacion_id), "Pago deshecho.")}>Deshacer pago</button>{" "}</>
                      )}
                      <button className="btn secondary small" disabled={ocupado} onClick={() => accion(() => api.teamback.prueba.borrarSemana(s.player_id, String(s.week_start).slice(0, 10)), "Cierre borrado.")}>Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <Aviso tipo="info">
          Para ver el portal como lo ve el jugador, abrí <b>/teamback</b> en otra ventana (o en modo incógnito) e ingresá con el usuario y la contraseña de prueba. Los avisos masivos y los pagos reales ignoran estas cuentas.
        </Aviso>
      </div>
    </div>
  );
}
