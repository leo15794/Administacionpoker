import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// "Bancado — Contratos" (pedido Leo 02/10/2026): sistema nuevo e independiente, con la regla de
// cálculo elegida 100% explícita por contrato, nunca un default (ver repo/bancadoContratos.ts).
// No tiene relación con "Jugadores bancados" (api.bancados) ni con agentes account_type=BANCADO
// -- esos quedan intactos, este módulo es aparte.
export default function BancadoContratos() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [contratos, setContratos] = useState<any[] | null>(null);
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  function refresh() {
    setError("");
    api.bancadoContratos.listar().then(setContratos).catch((e) => setError(e.message));
  }
  useEffect(() => { refresh(); }, []);

  const contrato = contratos?.find((c) => c.id === seleccionado) ?? null;
  const [editando, setEditando] = useState(false);
  useEffect(() => { setEditando(false); }, [seleccionado]);

  async function eliminar(c: any, e: React.MouseEvent) {
    e.stopPropagation();
    if (!(await confirmDialog(`¿Borrar el contrato de ${c.nombre}? Esto borra TODO su historial (períodos, parciales, liquidaciones, cierres RMF, ajustes, costos fijos) para siempre -- no se puede deshacer. No afecta ningún movimiento de Wallet/Tesorería (este módulo no genera ninguno).`))) return;
    try {
      await api.bancadoContratos.eliminar(c.id);
      if (seleccionado === c.id) setSeleccionado(null);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo borrar el contrato.");
    }
  }

  async function toggleActivo(c: any, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.bancadoContratos.editar(c.id, { activo: !c.activo });
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo cambiar el estado.");
    }
  }

  return (
    <div>
      <div className="topbar">
        <div className="muted">
          Cada contrato elige, de la lista de jugadores/agentes que ya existen en el sistema, su regla de cálculo de
          forma explícita (RMF o REGLA_BANCADO_V1) -- no hay una regla por default.
        </div>
        <button className="btn secondary small" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cerrar" : "+ Nuevo contrato"}</button>
      </div>

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}

      {showForm && (
        <div className="panel" style={{ marginTop: 16, maxWidth: 560 }}>
          <NuevoContratoForm
            onCreated={() => { setShowForm(false); refresh(); }}
          />
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        {!contratos ? (
          <div className="muted">Cargando...</div>
        ) : contratos.length === 0 ? (
          <div className="muted">Todavía no hay ningún contrato de bancado creado.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Regla</th>
                <th>Club</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contratos.map((c) => (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setSeleccionado(c.id)}>
                  <td><strong>{c.nombre}</strong></td>
                  <td className="muted">{c.tipo_vinculo === "AGENT" ? "Agente" : "Jugador"}</td>
                  <td><span className="badge neutral">{c.regla_key}</span></td>
                  <td className="muted">{c.club_id ?? "—"}</td>
                  <td className="muted">{c.activo ? "Activo" : "Inactivo"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); setSeleccionado(c.id); }}>
                      Abrir
                    </button>
                    <button className="btn secondary small" onClick={(e) => toggleActivo(c, e)}>
                      {c.activo ? "Desactivar" : "Activar"}
                    </button>
                    <button className="btn secondary small" onClick={(e) => eliminar(c, e)}>
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {contrato && (
        <div style={{ marginTop: 20 }}>
          <div className="topbar">
            <h3 style={{ margin: 0 }}>{contrato.nombre} <span className="badge neutral">{contrato.regla_key}</span></h3>
            <button className="btn secondary small" onClick={() => setEditando((v) => !v)}>{editando ? "Cerrar" : "Editar"}</button>
          </div>
          {contrato.updated_by && (
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Última edición: {contrato.updated_by} ({dateShort(contrato.updated_at)})
            </div>
          )}
          {editando && (
            <EditarContratoForm
              contrato={contrato}
              onSaved={() => { setEditando(false); refresh(); }}
              onCancel={() => setEditando(false)}
            />
          )}
          {contrato.regla_key === "RMF" ? (
            <ContratoRmf contrato={contrato} onChanged={refresh} />
          ) : (
            <ContratoV1 contrato={contrato} />
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Alta de contrato
// ------------------------------------------------------------------------------------------
// Etiqueta única de cada candidato en el picker -- incluye el club para desambiguar jugadores
// con el mismo nombre en clubes distintos (bug reportado por Leo 02/10/2026).
function labelCandidato(c: any) {
  return `[${c.tipo === "AGENT" ? "Agente" : "Jugador"}] ${c.nombre}${c.club_name ? ` -- ${c.club_name}` : ""}`;
}

// Buscador para tipear en vez de scrollear un <select> con cientos de jugadores (pedido Leo
// 05/10/2026, "se hace mucho quilombo") -- input + <datalist> nativo: el usuario tipea
// cualquier parte del nombre, el navegador filtra solo, y acá solo hace falta mapear el texto
// elegido de vuelta a "TIPO:id" buscando el candidato cuya etiqueta coincide exacto.
function CandidatoPicker({ candidatos, value, onChange }: { candidatos: any[] | null; value: string; onChange: (v: string) => void }) {
  const seleccionado = useMemo(() => candidatos?.find((c) => `${c.tipo}:${c.id}` === value) ?? null, [candidatos, value]);
  const [texto, setTexto] = useState("");
  useEffect(() => { setTexto(seleccionado ? labelCandidato(seleccionado) : ""); }, [seleccionado]);

  return (
    <div>
      <input
        list="candidatos-bancado-contrato"
        value={texto}
        placeholder="Escribí el nombre para buscar..."
        onChange={(e) => {
          const t = e.target.value;
          setTexto(t);
          const match = candidatos?.find((c) => labelCandidato(c) === t);
          onChange(match ? `${match.tipo}:${match.id}` : "");
        }}
      />
      <datalist id="candidatos-bancado-contrato">
        {candidatos === null && <option>Cargando...</option>}
        {candidatos?.map((c) => <option key={`${c.tipo}:${c.id}`} value={labelCandidato(c)} />)}
      </datalist>
      {texto && !seleccionado && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Elegí una opción de la lista (no quedó ninguna seleccionada todavía).</div>}
    </div>
  );
}

function NuevoContratoForm({ onCreated }: { onCreated: () => void }) {
  const [candidatos, setCandidatos] = useState<any[] | null>(null);
  const [clubes, setClubes] = useState<{ id: string; name: string }[] | null>(null);
  const [clubId, setClubId] = useState("");
  const [seleccion, setSeleccion] = useState(""); // "PLAYER:<id>" o "AGENT:<id>"
  const [reglaKey, setReglaKey] = useState<"RMF" | "REGLA_BANCADO_V1" | "">("");
  useEffect(() => { api.bancadoContratos.candidatos().then(setCandidatos).catch(() => setCandidatos([])); }, []);
  useEffect(() => { api.clubes().then(setClubes).catch(() => setClubes([])); }, []);
  const [rmfPctJugador, setRmfPctJugador] = useState("50");
  const [rmfPctBanca, setRmfPctBanca] = useState("50");
  const [rmfRakebackPct, setRmfRakebackPct] = useState("0");
  const [rmfRakebackBancaPct, setRmfRakebackBancaPct] = useState("0");
  const [rmfUnionSharePct, setRmfUnionSharePct] = useState("80");
  const [rmfCapitalInicial, setRmfCapitalInicial] = useState("0");
  const [rmfMakeupInicial, setRmfMakeupInicial] = useState("0");
  const [v1RakeDealPct, setV1RakeDealPct] = useState("60");
  const [v1RakeTeambackDirectoPct, setV1RakeTeambackDirectoPct] = useState("20");
  const [v1SplitJugadorPct, setV1SplitJugadorPct] = useState("50");
  const [v1SplitTeambackPct, setV1SplitTeambackPct] = useState("50");
  const [v1ModoMemoriaDefault, setV1ModoMemoriaDefault] = useState<"AUTOMATICO" | "PARCIAL_MANUAL">("AUTOMATICO");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    if (!seleccion) return setMsg({ ok: false, text: "Elegí a qué jugador o agente de la lista corresponde este contrato." });
    if (!reglaKey) return setMsg({ ok: false, text: "Elegí explícitamente la regla -- no hay una por default." });
    const [tipo, id] = seleccion.split(":");
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.crear({
        playerId: tipo === "PLAYER" ? id : undefined,
        agentId: tipo === "AGENT" ? id : undefined,
        clubId: clubId || undefined,
        reglaKey,
        observaciones: observaciones.trim() || undefined,
        rmfPctJugador: reglaKey === "RMF" ? Number(rmfPctJugador) / 100 : undefined,
        rmfPctBanca: reglaKey === "RMF" ? Number(rmfPctBanca) / 100 : undefined,
        rmfRakebackPct: reglaKey === "RMF" ? Number(rmfRakebackPct) / 100 : undefined,
        rmfRakebackBancaPct: reglaKey === "RMF" ? Number(rmfRakebackBancaPct) / 100 : undefined,
        rmfUnionSharePct: reglaKey === "RMF" ? Number(rmfUnionSharePct) / 100 : undefined,
        rmfCapitalInicial: reglaKey === "RMF" ? Number(rmfCapitalInicial) : undefined,
        rmfMakeupInicial: reglaKey === "RMF" ? Number(rmfMakeupInicial) : undefined,
        v1RakeDealPct: reglaKey === "REGLA_BANCADO_V1" ? Number(v1RakeDealPct) / 100 : undefined,
        v1RakeTeambackDirectoPct: reglaKey === "REGLA_BANCADO_V1" ? Number(v1RakeTeambackDirectoPct) / 100 : undefined,
        v1SplitJugadorPct: reglaKey === "REGLA_BANCADO_V1" ? Number(v1SplitJugadorPct) / 100 : undefined,
        v1SplitTeambackPct: reglaKey === "REGLA_BANCADO_V1" ? Number(v1SplitTeambackPct) / 100 : undefined,
        v1ModoMemoriaDefault: reglaKey === "REGLA_BANCADO_V1" ? v1ModoMemoriaDefault : undefined,
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo crear el contrato." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="field">
        <label>Jugador o agente (de los que ya existen en el sistema)</label>
        <CandidatoPicker candidatos={candidatos} value={seleccion} onChange={setSeleccion} />
      </div>
      <div className="field">
        <label title="Opcional, pero mejora el matcheo automático del buscador por archivo cuando hay nombres repetidos entre clubes.">Club (opcional)</label>
        <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
          <option value="">Sin club asignado</option>
          {clubes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Regla (obligatorio elegir una)</label>
        <select value={reglaKey} onChange={(e) => setReglaKey(e.target.value as any)}>
          <option value="">-- elegir --</option>
          <option value="RMF">RMF (la fórmula vieja: reparto 50/50 de mesa + rakeback + memoria)</option>
          <option value="REGLA_BANCADO_V1">REGLA_BANCADO_V1 (parciales semanales + cierre mensual + memoria con dos modos)</option>
        </select>
      </div>

      {reglaKey === "RMF" && (
        <>
          <div className="form-grid">
            <div className="field">
              <label>% Jugador</label>
              <input type="number" step="0.01" value={rmfPctJugador} onChange={(e) => setRmfPctJugador(e.target.value)} />
            </div>
            <div className="field">
              <label>% Banca</label>
              <input type="number" step="0.01" value={rmfPctBanca} onChange={(e) => setRmfPctBanca(e.target.value)} />
            </div>
            <div className="field">
              <label>Rakeback Jugador (%)</label>
              <input type="number" step="0.01" value={rmfRakebackPct} onChange={(e) => setRmfRakebackPct(e.target.value)} />
            </div>
            <div className="field">
              <label title="% independiente sobre el rake total que vuelve a la banca en vez de al jugador -- no tiene que sumar 100% con el rakeback del jugador.">Rakeback Banca (%)</label>
              <input type="number" step="0.01" value={rmfRakebackBancaPct} onChange={(e) => setRmfRakebackBancaPct(e.target.value)} />
            </div>
            <div className="field">
              <label title="% que la Unión (o quien corresponda) le reconoce a la banca sobre el rake total -- solo informativo, no genera ningún movimiento de Wallet/Tesorería.">% Unión sobre rake total (informativo)</label>
              <input type="number" step="0.01" value={rmfUnionSharePct} onChange={(e) => setRmfUnionSharePct(e.target.value)} />
            </div>
            <div className="field">
              <label>Capital inicial (USD)</label>
              <input type="number" step="0.01" value={rmfCapitalInicial} onChange={(e) => setRmfCapitalInicial(e.target.value)} />
            </div>
            <div className="field">
              <label>Makeup inicial (USD)</label>
              <input type="number" step="0.01" value={rmfMakeupInicial} onChange={(e) => setRmfMakeupInicial(e.target.value)} />
            </div>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            Mismo motor de cálculo (capital/makeup) que "Jugadores bancados" clásico -- es la misma fórmula, aplicada a este contrato.
          </div>
        </>
      )}

      {reglaKey === "REGLA_BANCADO_V1" && (
        <>
          <div className="form-grid">
            <div className="field">
              <label>% rake para el deal</label>
              <input type="number" value={v1RakeDealPct} onChange={(e) => setV1RakeDealPct(e.target.value)} />
            </div>
            <div className="field">
              <label>% rake directo TeamBack</label>
              <input type="number" value={v1RakeTeambackDirectoPct} onChange={(e) => setV1RakeTeambackDirectoPct(e.target.value)} />
            </div>
            <div className="field">
              <label>% split jugador</label>
              <input type="number" value={v1SplitJugadorPct} onChange={(e) => setV1SplitJugadorPct(e.target.value)} />
            </div>
            <div className="field">
              <label>% split TeamBack</label>
              <input type="number" value={v1SplitTeambackPct} onChange={(e) => setV1SplitTeambackPct(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Modo de recuperación de memoria (default)</label>
            <select value={v1ModoMemoriaDefault} onChange={(e) => setV1ModoMemoriaDefault(e.target.value as any)}>
              <option value="AUTOMATICO">Automático (recupera el máximo posible siempre)</option>
              <option value="PARCIAL_MANUAL">Parcial manual (TeamBack decide cuánto aplicar)</option>
            </select>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
            La memoria inicial del primer período (ej. los USD 344,75 de Matías migrados del acuerdo anterior) se carga
            al abrir el primer período del contrato, no acá.
          </div>
        </>
      )}

      <div className="field">
        <label>Observaciones (opcional)</label>
        <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Crear contrato"}</button>
    </div>
  );
}

// Carga por archivo (pedido Leo 05/10/2026, "como en la otra sección") -- reusa tal cual los
// mismos endpoints de importación que "Jugadores bancados" clásico (previsualizarImportacion*),
// sin ningún endpoint nuevo: esas previas YA traen, por club, tanto los jugadores marcados
// "bancado" (array `bancados`) como el detalle de CADA jugador dentro del agregado de su agente
// (`agentes[].jugadoresDetalle`) y el agregado del agente en sí (`agentes[].resultado/rakeTotal`)
// -- entre esos tres lugares está el resultado/rake de cualquier jugador o agente del sistema,
// tenga o no tenga marcado el flag clásico de bancado. Si el contrato tiene club_id cargado se
// filtra a ese club; si no, se suma lo que aparezca en todos los clubes del archivo (caso de un
// agente que opera en más de un club).
function ImportarResultadoContrato({ contrato, onEncontrado }: { contrato: any; onEncontrado: (resultado: number, rake: number, detalle: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [plataforma, setPlataforma] = useState<"suprema" | "teamback-gg" | "tiny-gg">("suprema");
  const [weekEnd, setWeekEnd] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<{ resultado: number; rake: number; detalle: string } | null>(null);

  async function subirArchivo(): Promise<any> {
    if (plataforma === "suprema") {
      if (!archivo) throw new Error("Subí el archivo (.xlsx).");
      return api.previsualizarImportacion(archivo, weekEnd);
    }
    if (plataforma === "teamback-gg") {
      if (!archivo) throw new Error("Subí el archivo (.xlsx).");
      return api.previsualizarImportacionTeamBackGG(archivo, weekEnd);
    }
    if (archivos.length === 0) throw new Error("Subí los archivos (uno por super agente).");
    return api.previsualizarImportacionTinyGG(archivos, weekEnd);
  }

  async function buscar() {
    setError("");
    setResultado(null);
    if (!weekEnd) return setError("Indicá la fecha (semana hasta) antes de analizar el archivo.");
    setBuscando(true);
    try {
      const result = await subirArchivo();
      let totalResultado = 0;
      let totalRake = 0;
      const partes: string[] = [];
      for (const c of result.clubes ?? []) {
        if (contrato.club_id && c.clubId !== contrato.club_id) continue;
        if (contrato.tipo_vinculo === "AGENT") {
          const ag = (c.agentes ?? []).find((a: any) => a.agentId === contrato.agent_id);
          if (ag) {
            totalResultado += Number(ag.resultado) || 0;
            totalRake += Number(ag.rakeTotal) || 0;
            partes.push(`${c.clubName}: ${usd(Number(ag.resultado) || 0)}`);
          }
          // FIX 07/10/2026 (Leo: "No se encontró a MatiasFx en el archivo para esa semana"):
          // un jugador marcado como "bancado" (ver Jugadores bancados) queda afuera a proposito
          // del agregado normal del agente durante la importacion (repo/imports.ts lo separa a
          // c.bancados, nunca entra a c.agentes) -- sin esto, un contrato tipo AGENT nunca
          // encontraba nada en un club donde ese agente es ademas un jugador bancado (caso real:
          // MatiasFx es su propio agente Y esta marcado bancado en TeamBack Suprema). Se suman
          // aparte porque no son mutuamente excluyentes: el mismo agente puede tener jugadores
          // normales Y jugadores bancados en el mismo club a la vez.
          const bancadosDelAgente = (c.bancados ?? []).filter((b: any) => b.agentId === contrato.agent_id);
          for (const b of bancadosDelAgente) {
            totalResultado += Number(b.resultado) || 0;
            totalRake += Number(b.rake) || 0;
            partes.push(`${c.clubName} (bancado ${b.playerName}): ${usd(Number(b.resultado) || 0)}`);
          }
        } else {
          const b = (c.bancados ?? []).find((x: any) => x.playerId === contrato.player_id);
          if (b) {
            totalResultado += Number(b.resultado) || 0;
            totalRake += Number(b.rake) || 0;
            partes.push(`${c.clubName}: ${usd(Number(b.resultado) || 0)}`);
            continue;
          }
          for (const ag of c.agentes ?? []) {
            const det = (ag.jugadoresDetalle ?? []).find((j: any) => j.playerId === contrato.player_id);
            if (det) {
              totalResultado += Number(det.resultado) || 0;
              totalRake += Number(det.rake) || 0;
              partes.push(`${c.clubName}: ${usd(Number(det.resultado) || 0)}`);
            }
          }
        }
      }
      if (partes.length === 0) {
        setError(`No se encontró a ${contrato.nombre} en el archivo para esa semana -- revisá la plataforma, el archivo, o cargá los valores a mano.`);
        return;
      }
      setResultado({
        resultado: Math.round(totalResultado * 100) / 100,
        rake: Math.round(totalRake * 100) / 100,
        detalle: partes.join(" + "),
      });
    } catch (err: any) {
      setError(err.message || "No se pudo leer el archivo.");
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div className="topbar">
        <strong style={{ fontSize: 13 }}>Cargar desde archivo semanal (opcional)</strong>
        <button type="button" className="btn secondary small" onClick={() => setAbierto((v) => !v)}>{abierto ? "Cerrar" : "Usar archivo"}</button>
      </div>
      {abierto && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
            Subí el mismo archivo semanal que usás en Cierres -- se busca automáticamente el resultado y el rake de{" "}
            <strong>{contrato.nombre}</strong> en ese archivo, para esta semana.
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Plataforma</label>
              <select value={plataforma} onChange={(e) => { setPlataforma(e.target.value as any); setArchivo(null); setArchivos([]); setResultado(null); }}>
                <option value="suprema">SupremaPoker (Fénix/TeamBack Suprema)</option>
                <option value="teamback-gg">GG Poker / TeamBack GG</option>
                <option value="tiny-gg">Tiny GG</option>
              </select>
            </div>
            <div className="field">
              <label>Semana hasta</label>
              <input type="date" value={weekEnd} onChange={(e) => { setWeekEnd(e.target.value); setResultado(null); }} />
            </div>
          </div>
          <div className="field">
            <label>{plataforma === "tiny-gg" ? "Archivos (uno por super agente)" : "Archivo"}</label>
            {plataforma === "tiny-gg" ? (
              <input type="file" multiple accept=".xlsx,.xls" onChange={(e) => { setArchivos(Array.from(e.target.files ?? [])); setResultado(null); }} />
            ) : (
              <input type="file" accept=".xlsx,.xls" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setResultado(null); }} />
            )}
          </div>
          {error && <div className="error">{error}</div>}
          <button type="button" className="btn secondary small" disabled={buscando} onClick={buscar}>{buscando ? "Buscando..." : "Buscar en el archivo"}</button>
          {resultado && (
            <div style={{ marginTop: 10 }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Encontrado ({resultado.detalle}) -- resultado total {usd(resultado.resultado)}, rake total {usd(resultado.rake)}.
              </div>
              <button
                type="button"
                className="btn small"
                style={{ marginTop: 6 }}
                onClick={() => onEncontrado(resultado.resultado, resultado.rake, resultado.detalle)}
              >
                Usar estos valores
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Edición de un contrato ya creado (pedido Leo 05/10/2026, "falta un botón para Editar").
// No deja tocar la regla ni el jugador/agente vinculado (eso se resuelve creando un contrato
// nuevo, ver comentario en repo/editarContrato) -- solo club, observaciones, activo, los
// parámetros de la regla elegida, y -- solo para RMF y solo si el contrato todavía no tiene
// ningún cierre RMF aplicado -- el capital/makeup inicial (el backend rechaza el cambio si ya
// hubo un cierre, con un mensaje claro).
function EditarContratoForm({ contrato, onSaved, onCancel }: { contrato: any; onSaved: () => void; onCancel: () => void }) {
  const [clubes, setClubes] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => { api.clubes().then(setClubes).catch(() => setClubes([])); }, []);

  const [clubId, setClubId] = useState(contrato.club_id ?? "");
  const [observaciones, setObservaciones] = useState(contrato.observaciones ?? "");
  const [activo, setActivo] = useState(!!contrato.activo);
  const [rmfPctJugador, setRmfPctJugador] = useState(String(Number(contrato.rmf_pct_jugador ?? 0) * 100));
  const [rmfPctBanca, setRmfPctBanca] = useState(String(Number(contrato.rmf_pct_banca ?? 0) * 100));
  const [rmfRakebackPct, setRmfRakebackPct] = useState(String(Number(contrato.rmf_rakeback_pct ?? 0) * 100));
  const [rmfRakebackBancaPct, setRmfRakebackBancaPct] = useState(String(Number(contrato.rmf_rakeback_banca_pct ?? 0) * 100));
  const [rmfUnionSharePct, setRmfUnionSharePct] = useState(String(Number(contrato.rmf_union_share_pct ?? 0) * 100));
  const [rmfCapitalInicial, setRmfCapitalInicial] = useState(String(Number(contrato.rmf_capital_inicial ?? 0)));
  const [rmfMakeupInicial, setRmfMakeupInicial] = useState(String(Number(contrato.rmf_makeup_inicial ?? 0)));
  const [v1RakeDealPct, setV1RakeDealPct] = useState(String(Number(contrato.v1_rake_deal_pct ?? 0) * 100));
  const [v1RakeTeambackDirectoPct, setV1RakeTeambackDirectoPct] = useState(String(Number(contrato.v1_rake_teamback_directo_pct ?? 0) * 100));
  const [v1SplitJugadorPct, setV1SplitJugadorPct] = useState(String(Number(contrato.v1_split_jugador_pct ?? 0) * 100));
  const [v1SplitTeambackPct, setV1SplitTeambackPct] = useState(String(Number(contrato.v1_split_teamback_pct ?? 0) * 100));
  const [v1ModoMemoriaDefault, setV1ModoMemoriaDefault] = useState<"AUTOMATICO" | "PARCIAL_MANUAL">(contrato.v1_modo_memoria_default ?? "AUTOMATICO");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.editar(contrato.id, {
        clubId: clubId || null,
        observaciones: observaciones.trim() || null,
        activo,
        rmfPctJugador: contrato.regla_key === "RMF" ? Number(rmfPctJugador) / 100 : undefined,
        rmfPctBanca: contrato.regla_key === "RMF" ? Number(rmfPctBanca) / 100 : undefined,
        rmfRakebackPct: contrato.regla_key === "RMF" ? Number(rmfRakebackPct) / 100 : undefined,
        rmfRakebackBancaPct: contrato.regla_key === "RMF" ? Number(rmfRakebackBancaPct) / 100 : undefined,
        rmfUnionSharePct: contrato.regla_key === "RMF" ? Number(rmfUnionSharePct) / 100 : undefined,
        rmfCapitalInicial: contrato.regla_key === "RMF" ? Number(rmfCapitalInicial) : undefined,
        rmfMakeupInicial: contrato.regla_key === "RMF" ? Number(rmfMakeupInicial) : undefined,
        v1RakeDealPct: contrato.regla_key === "REGLA_BANCADO_V1" ? Number(v1RakeDealPct) / 100 : undefined,
        v1RakeTeambackDirectoPct: contrato.regla_key === "REGLA_BANCADO_V1" ? Number(v1RakeTeambackDirectoPct) / 100 : undefined,
        v1SplitJugadorPct: contrato.regla_key === "REGLA_BANCADO_V1" ? Number(v1SplitJugadorPct) / 100 : undefined,
        v1SplitTeambackPct: contrato.regla_key === "REGLA_BANCADO_V1" ? Number(v1SplitTeambackPct) / 100 : undefined,
        v1ModoMemoriaDefault: contrato.regla_key === "REGLA_BANCADO_V1" ? v1ModoMemoriaDefault : undefined,
      });
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 12, maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>Editar contrato de {contrato.nombre}</h3>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        No se puede cambiar la regla ni el jugador/agente vinculado -- si eso cambió de verdad, hay que crear un contrato nuevo.
      </div>
      <div className="form-grid">
        <div className="field">
          <label>Club</label>
          <select value={clubId} onChange={(e) => setClubId(e.target.value)}>
            <option value="">Sin club asignado</option>
            {clubes?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Estado</label>
          <select value={activo ? "1" : "0"} onChange={(e) => setActivo(e.target.value === "1")}>
            <option value="1">Activo</option>
            <option value="0">Inactivo</option>
          </select>
        </div>
      </div>

      {contrato.regla_key === "RMF" ? (
        <div className="form-grid">
          <div className="field"><label>% Jugador</label><input type="number" step="0.01" value={rmfPctJugador} onChange={(e) => setRmfPctJugador(e.target.value)} /></div>
          <div className="field"><label>% Banca</label><input type="number" step="0.01" value={rmfPctBanca} onChange={(e) => setRmfPctBanca(e.target.value)} /></div>
          <div className="field"><label>Rakeback Jugador (%)</label><input type="number" step="0.01" value={rmfRakebackPct} onChange={(e) => setRmfRakebackPct(e.target.value)} /></div>
          <div className="field"><label>Rakeback Banca (%)</label><input type="number" step="0.01" value={rmfRakebackBancaPct} onChange={(e) => setRmfRakebackBancaPct(e.target.value)} /></div>
          <div className="field"><label>% Unión sobre rake total</label><input type="number" step="0.01" value={rmfUnionSharePct} onChange={(e) => setRmfUnionSharePct(e.target.value)} /></div>
          <div className="field">
            <label title="Solo se puede cambiar si este contrato todavía no tiene ningún cierre RMF aplicado.">Capital inicial (USD)</label>
            <input type="number" step="0.01" value={rmfCapitalInicial} onChange={(e) => setRmfCapitalInicial(e.target.value)} />
          </div>
          <div className="field">
            <label title="Solo se puede cambiar si este contrato todavía no tiene ningún cierre RMF aplicado.">Makeup inicial (USD)</label>
            <input type="number" step="0.01" value={rmfMakeupInicial} onChange={(e) => setRmfMakeupInicial(e.target.value)} />
          </div>
        </div>
      ) : (
        <div className="form-grid">
          <div className="field"><label>% rake para el deal</label><input type="number" value={v1RakeDealPct} onChange={(e) => setV1RakeDealPct(e.target.value)} /></div>
          <div className="field"><label>% rake directo TeamBack</label><input type="number" value={v1RakeTeambackDirectoPct} onChange={(e) => setV1RakeTeambackDirectoPct(e.target.value)} /></div>
          <div className="field"><label>% split jugador</label><input type="number" value={v1SplitJugadorPct} onChange={(e) => setV1SplitJugadorPct(e.target.value)} /></div>
          <div className="field"><label>% split TeamBack</label><input type="number" value={v1SplitTeambackPct} onChange={(e) => setV1SplitTeambackPct(e.target.value)} /></div>
          <div className="field">
            <label>Modo de recuperación de memoria (default)</label>
            <select value={v1ModoMemoriaDefault} onChange={(e) => setV1ModoMemoriaDefault(e.target.value as any)}>
              <option value="AUTOMATICO">Automático</option>
              <option value="PARCIAL_MANUAL">Parcial manual</option>
            </select>
          </div>
        </div>
      )}

      <div className="field">
        <label>Observaciones</label>
        <input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
      </div>

      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Guardar cambios"}</button>
        <button className="btn secondary" disabled={guardando} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Regla RMF -- mismo motor de capital/makeup que "Jugadores bancados" clásico
// (engine/bancados.ts), aplicado a este contrato. Nunca se guarda un capital/makeup "actual"
// mutable -- se deriva siempre del último cierre APLICADO (repo/bancadoContratos.ts).
// ------------------------------------------------------------------------------------------
function ContratoRmf({ contrato, onChanged }: { contrato: any; onChanged: () => void }) {
  const { promptDialog, alertDialog } = useConfirmDialog();
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [resultadoMesas, setResultadoMesas] = useState("0");
  const [rakeBruto, setRakeBruto] = useState("0");
  const [ticketPromocional, setTicketPromocional] = useState("0");
  const [ticketPromocionalNota, setTicketPromocionalNota] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [ajustes, setAjustes] = useState<any[] | null>(null);
  const [showAjuste, setShowAjuste] = useState(false);

  function refresh() {
    api.bancadoContratos.historialRmf(contrato.id).then(setHistorial).catch(() => {});
    api.bancadoContratos.ajustes(contrato.id).then(setAjustes).catch(() => {});
  }
  useEffect(() => { refresh(); }, [contrato.id]);

  const ultimoAplicado = historial?.find((h) => h.status !== "REVERTIDO") ?? null;
  const capitalActual = ultimoAplicado ? Number(ultimoAplicado.capital_despues) : Number(contrato.rmf_capital_inicial ?? 0);
  const makeupActual = ultimoAplicado ? Number(ultimoAplicado.makeup_nuevo) : Number(contrato.rmf_makeup_inicial ?? 0);

  async function cerrarSemana() {
    if (!desde || !hasta) return setMsg({ ok: false, text: "Faltan las fechas." });
    if (hasta < desde) return setMsg({ ok: false, text: "La fecha \"hasta\" no puede ser anterior a \"desde\"." });
    if ((Number(ticketPromocional) || 0) !== 0 && !ticketPromocionalNota.trim()) {
      return setMsg({ ok: false, text: "Si hay ticket promocional hay que anotar por qué." });
    }
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.cierreRmf(contrato.id, {
        desde,
        hasta,
        resultadoMesas: Number(resultadoMesas) || 0,
        rakeBruto: Number(rakeBruto) || 0,
        ticketPromocional: Number(ticketPromocional) || undefined,
        ticketPromocionalNota: ticketPromocionalNota.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
      });
      setDesde(""); setHasta(""); setResultadoMesas("0"); setRakeBruto("0"); setTicketPromocional("0"); setTicketPromocionalNota(""); setObservaciones("");
      refresh();
      onChanged();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cerrar la semana." });
    } finally {
      setGuardando(false);
    }
  }

  async function revertir(h: any) {
    const motivo = await promptDialog("¿Por qué se revierte este cierre RMF? (queda en el historial, no se borra nada)");
    if (motivo === null) return;
    try {
      await api.bancadoContratos.revertirCierreRmf(h.id, motivo || undefined);
      refresh();
      onChanged();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo revertir.");
    }
  }

  return (
    <div>
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="muted">Capital actual</div>
          <div className="value">{usd(capitalActual)}</div>
        </div>
        <div className="kpi-card">
          <div className="muted">Makeup actual</div>
          <div className="value">{usd(makeupActual)}</div>
        </div>
        <div className="kpi-card">
          <div className="muted">% Jugador / % Banca</div>
          <div className="value">{(Number(contrato.rmf_pct_jugador) * 100).toFixed(0)}% / {(Number(contrato.rmf_pct_banca) * 100).toFixed(0)}%</div>
        </div>
        <div className="kpi-card">
          <div className="muted">Rakeback jugador / banca</div>
          <div className="value">{(Number(contrato.rmf_rakeback_pct) * 100).toFixed(0)}% / {(Number(contrato.rmf_rakeback_banca_pct ?? 0) * 100).toFixed(0)}%</div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16, maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>Cerrar semana (RMF)</h3>
        <ImportarResultadoContrato
          contrato={contrato}
          onEncontrado={(r, rk) => { setResultadoMesas(String(r)); setRakeBruto(String(rk)); }}
        />
        <div className="form-grid">
          <div className="field"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
          <div className="field"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
        </div>
        <div className="form-grid">
          <div className="field"><label>Resultado de mesas</label><input type="number" step="0.01" value={resultadoMesas} onChange={(e) => setResultadoMesas(e.target.value)} /></div>
          <div className="field"><label>Rake total</label><input type="number" step="0.01" value={rakeBruto} onChange={(e) => setRakeBruto(e.target.value)} /></div>
        </div>
        <div className="field"><label>Ticket promocional (a nuestro cargo)</label><input type="number" step="0.01" value={ticketPromocional} onChange={(e) => setTicketPromocional(e.target.value)} /></div>
        {(Number(ticketPromocional) || 0) !== 0 && (
          <div className="field"><label>Motivo del ticket promocional</label><input value={ticketPromocionalNota} onChange={(e) => setTicketPromocionalNota(e.target.value)} placeholder="Ej: ticket promocional torneo X" /></div>
        )}
        <div className="field"><label>Observaciones</label><input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
        {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
        <button className="btn" disabled={guardando} onClick={cerrarSemana}>{guardando ? "Cerrando..." : "Cerrar semana"}</button>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Historial</h3>
        {!historial ? <div className="muted">Cargando...</div> : historial.length === 0 ? <div className="muted">Todavía no hay cierres.</div> : (
          <table>
            <thead>
              <tr>
                <th>Semana</th>
                <th className="num">Mesa</th>
                <th className="num">Rake</th>
                <th className="num">Rakeback</th>
                <th className="num">Pago jugador</th>
                <th className="num">Ganancia banca</th>
                <th className="num">Makeup antes</th>
                <th className="num">Makeup después</th>
                <th className="num">Capital antes</th>
                <th className="num">Capital después</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id} style={h.status === "REVERTIDO" ? { opacity: 0.5 } : undefined}>
                  <td className="muted">{dateShort(h.desde)} - {dateShort(h.hasta)}</td>
                  <td className="num">{usd(h.resultado_mesas)}</td>
                  <td className="num">{usd(h.rake_total)}</td>
                  <td className="num muted">{usd(h.rakeback_total)}</td>
                  <td className="num money">{usd(h.pago_jugador_total)}</td>
                  <td className="num money">{usd(h.ganancia_banca_mesas)}</td>
                  <td className="num muted">{usd(h.makeup_anterior)}</td>
                  <td className="num muted">{usd(h.makeup_nuevo)}</td>
                  <td className="num muted">{usd(h.capital_anterior)}</td>
                  <td className="num muted">{usd(h.capital_despues)}</td>
                  <td className="muted">{h.status === "REVERTIDO" ? "Revertido" : "Aplicado"}</td>
                  <td>
                    {h.status !== "REVERTIDO" && (
                      <button className="btn secondary small" onClick={() => revertir(h)}>Revertir</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="topbar">
          <h3 style={{ margin: 0 }}>Ajustes y créditos pendientes</h3>
          <button className="btn secondary small" onClick={() => setShowAjuste((v) => !v)}>{showAjuste ? "Cerrar" : "+ Ajuste manual"}</button>
        </div>
        {showAjuste && (
          <AjusteManualForm contrato={contrato} onCreated={() => { setShowAjuste(false); refresh(); }} />
        )}
        {!ajustes ? <div className="muted">Cargando...</div> : ajustes.length === 0 ? <div className="muted">Sin ajustes.</div> : (
          <table>
            <thead><tr><th>Tipo</th><th className="num">Importe</th><th>Estado</th><th>Motivo</th><th></th></tr></thead>
            <tbody>
              {ajustes.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{a.tipo}</td>
                  <td className="num"><strong className={a.signo === "POSITIVO" ? "pos" : "neg"}>{usd(a.importe)}</strong></td>
                  <td><span className={`badge ${a.estado === "PENDIENTE" ? "neutral" : a.estado === "APLICADO" ? "pos" : "neg"}`}>{a.estado}</span></td>
                  <td className="muted">{a.motivo}</td>
                  <td>
                    {a.estado === "PENDIENTE" && (
                      <button className="btn secondary small" onClick={async () => {
                        await api.bancadoContratos.resolverAjuste(a.id, "APLICADO");
                        refresh();
                      }}>Marcar pagado</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CostosFijosPanel contrato={contrato} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Regla REGLA_BANCADO_V1 -- períodos mensuales
// ------------------------------------------------------------------------------------------
function ContratoV1({ contrato }: { contrato: any }) {
  const [periodos, setPeriodos] = useState<any[] | null>(null);
  const [periodoId, setPeriodoId] = useState<string | null>(null);
  const [showAbrir, setShowAbrir] = useState(false);

  function refresh() {
    api.bancadoContratos.periodos(contrato.id).then((rows) => {
      setPeriodos(rows);
      if (!periodoId && rows.length > 0) setPeriodoId(rows[0].id);
    }).catch(() => {});
  }
  useEffect(() => { setPeriodoId(null); refresh(); }, [contrato.id]);

  return (
    <div>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Períodos de {contrato.nombre}</h3>
        <button className="btn secondary small" onClick={() => setShowAbrir((v) => !v)}>{showAbrir ? "Cerrar" : "+ Abrir período"}</button>
      </div>

      {showAbrir && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 480 }}>
          <AbrirPeriodoForm
            contrato={contrato}
            hayPeriodosPrevios={(periodos?.length ?? 0) > 0}
            onCreated={() => { setShowAbrir(false); refresh(); }}
          />
        </div>
      )}

      <div className="panel" style={{ marginTop: 12 }}>
        {!periodos ? <div className="muted">Cargando...</div> : periodos.length === 0 ? (
          <div className="muted">Todavía no hay ningún período abierto para este contrato.</div>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {periodos.map((p) => (
              <button
                key={p.id}
                className={`btn secondary small ${p.id === periodoId ? "active" : ""}`}
                style={p.id === periodoId ? { filter: "brightness(1.15)" } : undefined}
                onClick={() => setPeriodoId(p.id)}
              >
                {MESES[p.mes - 1]} {p.anio} {p.estado === "CERRADO" ? "(cerrado)" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {periodoId && <PeriodoPanel contrato={contrato} periodoId={periodoId} onPeriodoCambiado={refresh} />}
    </div>
  );
}

function AbrirPeriodoForm({ contrato, hayPeriodosPrevios, onCreated }: { contrato: any; hayPeriodosPrevios: boolean; onCreated: () => void }) {
  const hoy = new Date();
  const [anio, setAnio] = useState(String(hoy.getFullYear()));
  const [mes, setMes] = useState(String(hoy.getMonth() + 1));
  const [memoriaInicial, setMemoriaInicial] = useState("");
  const [modoMemoria, setModoMemoria] = useState<"AUTOMATICO" | "PARCIAL_MANUAL">(contrato.v1_modo_memoria_default ?? "AUTOMATICO");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    if (!hayPeriodosPrevios && !memoriaInicial.trim()) {
      return setMsg({ ok: false, text: "Es el primer período de este contrato -- hay que indicar la memoria inicial a mano (ej. la migrada del acuerdo anterior)." });
    }
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.abrirPeriodo(contrato.id, {
        anio: Number(anio),
        mes: Number(mes),
        memoriaInicial: memoriaInicial.trim() ? Number(memoriaInicial) : undefined,
        modoMemoria,
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo abrir el período." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="form-grid">
        <div className="field"><label>Año</label><input type="number" value={anio} onChange={(e) => setAnio(e.target.value)} /></div>
        <div className="field">
          <label>Mes</label>
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Memoria inicial (USD) {hayPeriodosPrevios && <span className="muted">-- opcional, si no se indica hereda la memoria final del período anterior cerrado</span>}</label>
        <input type="number" value={memoriaInicial} onChange={(e) => setMemoriaInicial(e.target.value)} placeholder={hayPeriodosPrevios ? "heredar del período anterior" : "obligatorio: primer período"} />
      </div>
      <div className="field">
        <label>Modo de recuperación de memoria de este período</label>
        <select value={modoMemoria} onChange={(e) => setModoMemoria(e.target.value as any)}>
          <option value="AUTOMATICO">Automático</option>
          <option value="PARCIAL_MANUAL">Parcial manual</option>
        </select>
      </div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Abriendo..." : "Abrir período"}</button>
    </div>
  );
}

function PeriodoPanel({ contrato, periodoId, onPeriodoCambiado }: { contrato: any; periodoId: string; onPeriodoCambiado: () => void }) {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [estado, setEstado] = useState<any | null>(null);
  const [parciales, setParciales] = useState<any[] | null>(null);
  const [liquidaciones, setLiquidaciones] = useState<any[] | null>(null);
  const [ajustes, setAjustes] = useState<any[] | null>(null);
  const [showParcial, setShowParcial] = useState(false);
  const [showExtra, setShowExtra] = useState(false);
  const [showCerrar, setShowCerrar] = useState(false);
  const [showAjuste, setShowAjuste] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);

  function refresh() {
    api.bancadoContratos.estadoPeriodo(periodoId).then(setEstado).catch(() => {});
    api.bancadoContratos.parciales(periodoId).then(setParciales).catch(() => {});
    api.bancadoContratos.liquidaciones(contrato.id, periodoId).then(setLiquidaciones).catch(() => {});
    api.bancadoContratos.ajustes(contrato.id).then(setAjustes).catch(() => {});
  }
  useEffect(() => { refresh(); }, [periodoId]);

  async function reabrir() {
    const motivo = window.prompt("Motivo de la reapertura (queda auditado):");
    if (!motivo) return;
    setReabriendo(true);
    try {
      await api.bancadoContratos.reabrirPeriodo(periodoId, motivo);
      refresh();
      onPeriodoCambiado();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo reabrir.");
    } finally {
      setReabriendo(false);
    }
  }

  if (!estado) return <div className="panel" style={{ marginTop: 16 }}><div className="muted">Cargando...</div></div>;
  const { periodo } = estado;
  const cerrado = periodo.estado === "CERRADO";

  return (
    <div style={{ marginTop: 16 }}>
      <div className="kpi-grid">
        <div className="kpi-card"><div className="muted">Memoria inicial</div><div className="value">{usd(periodo.memoria_inicial)}</div></div>
        <div className="kpi-card"><div className="muted">{cerrado ? "Memoria final" : "Memoria proyectada"}</div><div className="value">{usd(cerrado ? periodo.memoria_final : estado.memoriaProyectada)}</div></div>
        <div className="kpi-card"><div className="muted">Resultado deal acumulado</div><div className="value">{usd(estado.acumulados.resultadoDealAcumulado)}</div></div>
        <div className="kpi-card"><div className="muted">{cerrado ? "Split jugador" : "Split jugador proyectado"}</div><div className="value">{usd(estado.splitJugadorProyectado)}</div></div>
        <div className="kpi-card"><div className="muted">Ganancia TeamBack (rake directo acum.)</div><div className="value">{usd(estado.gananciaTeambackAcumuladaRake)}</div></div>
        <div className="kpi-card"><div className="muted">Ganancia TeamBack proyectada total</div><div className="value">{usd(estado.gananciaTeambackProyectada)}</div></div>
      </div>

      {cerrado ? (
        <div className="muted" style={{ marginTop: 10 }}>
          Período CERRADO el {dateShort(periodo.cerrado_en)} por {periodo.cerrado_por}.
          {" "}
          <button className="btn secondary small" disabled={reabriendo} onClick={reabrir}>{reabriendo ? "..." : "Reabrir (auditado)"}</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="btn secondary small" onClick={() => setShowParcial((v) => !v)}>{showParcial ? "Cerrar" : "+ Cargar parcial semanal"}</button>
          <button className="btn secondary small" onClick={() => setShowExtra((v) => !v)}>{showExtra ? "Cerrar" : "Split extraordinario"}</button>
          <button className="btn small" onClick={() => setShowCerrar((v) => !v)}>{showCerrar ? "Cerrar" : "Cerrar mes"}</button>
        </div>
      )}

      {showParcial && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 480 }}>
          <ParcialForm contrato={contrato} periodoId={periodoId} onCreated={() => { setShowParcial(false); refresh(); }} />
        </div>
      )}
      {showExtra && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 480 }}>
          <ExtraordinarioForm
            periodoId={periodoId}
            pendienteSugerido={Math.max(0, estado.pendiente)}
            memoriaActual={Number(periodo.memoria_actual)}
            onCreated={() => { setShowExtra(false); refresh(); onPeriodoCambiado(); }}
          />
        </div>
      )}
      {showCerrar && (
        <div className="panel" style={{ marginTop: 12, maxWidth: 520 }}>
          <CerrarMesForm
            periodoId={periodoId}
            modoMemoriaPeriodo={periodo.modo_memoria}
            proyeccion={estado}
            confirmDialog={confirmDialog}
            onCerrado={() => { setShowCerrar(false); refresh(); onPeriodoCambiado(); }}
          />
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Parciales semanales</h3>
        {!parciales ? <div className="muted">Cargando...</div> : parciales.length === 0 ? <div className="muted">Sin parciales todavía.</div> : (
          <table>
            <thead><tr><th>Semana</th><th className="num">Mesa</th><th className="num">Rake</th><th className="num">Deal</th><th className="num">TeamBack</th><th></th></tr></thead>
            <tbody>
              {parciales.map((p) => (
                <tr key={p.id}>
                  <td className="muted">{dateShort(p.desde)} - {dateShort(p.hasta)}</td>
                  <td className="num">{usd(p.resultado_mesas)}</td>
                  <td className="num">{usd(p.rake_bruto)}</td>
                  <td className="num"><strong className={Number(p.resultado_deal_semana) >= 0 ? "pos" : "neg"}>{usd(p.resultado_deal_semana)}</strong></td>
                  <td className="num muted">{usd(p.rake_teamback_semana)}</td>
                  <td>
                    {!cerrado && (
                      <button
                        className="btn secondary small"
                        onClick={async () => {
                          if (!(await confirmDialog(`¿Borrar el parcial de la semana ${dateShort(p.desde)} - ${dateShort(p.hasta)}? No se puede deshacer.`))) return;
                          try {
                            await api.bancadoContratos.eliminarParcial(p.id);
                            refresh();
                          } catch (err: any) {
                            await alertDialog(err.message || "No se pudo borrar el parcial.");
                          }
                        }}
                      >
                        Borrar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Liquidaciones de este período</h3>
        {!liquidaciones ? <div className="muted">Cargando...</div> : liquidaciones.length === 0 ? <div className="muted">Ninguna todavía.</div> : (
          <table>
            <thead><tr><th>Tipo</th><th>Semana</th><th className="num">Memoria antes</th><th className="num">Aplicada</th><th className="num">Memoria después</th><th className="num">Split jugador</th><th className="num">Split TeamBack</th><th>Fecha</th><th>Estado</th></tr></thead>
            <tbody>
              {liquidaciones.map((l) => (
                <tr key={l.id} style={l.status === "REVERTIDO" ? { opacity: 0.5 } : undefined}>
                  <td><span className="badge neutral">{l.tipo}</span></td>
                  <td className="muted">{l.desde ? `${dateShort(l.desde)} - ${dateShort(l.hasta)}` : "—"}</td>
                  <td className="num muted">{usd(l.memoria_anterior)}</td>
                  <td className="num muted">{usd(l.memoria_aplicada)}</td>
                  <td className="num muted">{usd(l.memoria_final)}</td>
                  <td className="num money">{usd(l.split_jugador)}</td>
                  <td className="num">{usd(l.split_teamback)}</td>
                  <td className="muted">{dateShort(l.created_at)}</td>
                  <td className="muted">{l.status === "REVERTIDO" ? "Revertido (reabierto)" : "Aplicado"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="topbar">
          <h3 style={{ margin: 0 }}>Ajustes y créditos pendientes</h3>
          <button className="btn secondary small" onClick={() => setShowAjuste((v) => !v)}>{showAjuste ? "Cerrar" : "+ Ajuste manual"}</button>
        </div>
        {showAjuste && (
          <AjusteManualForm
            contrato={contrato}
            periodoId={periodoId}
            onCreated={() => { setShowAjuste(false); refresh(); }}
          />
        )}
        {!ajustes ? <div className="muted">Cargando...</div> : ajustes.length === 0 ? <div className="muted">Sin ajustes.</div> : (
          <table>
            <thead><tr><th>Tipo</th><th className="num">Importe</th><th>Estado</th><th>Motivo</th><th></th></tr></thead>
            <tbody>
              {ajustes.map((a) => (
                <tr key={a.id}>
                  <td className="muted">{a.tipo}</td>
                  <td className="num"><strong className={a.signo === "POSITIVO" ? "pos" : "neg"}>{usd(a.importe)}</strong></td>
                  <td><span className={`badge ${a.estado === "PENDIENTE" ? "neutral" : a.estado === "APLICADO" ? "pos" : "neg"}`}>{a.estado}</span></td>
                  <td className="muted">{a.motivo}</td>
                  <td>
                    {a.estado === "PENDIENTE" && (
                      <button className="btn secondary small" onClick={async () => {
                        await api.bancadoContratos.resolverAjuste(a.id, "APLICADO");
                        refresh();
                      }}>Marcar pagado</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CostosFijosPanel contrato={contrato} />
    </div>
  );
}

// Ajuste manual (pedido Leo 05/10/2026): el backend (crearAjuste) ya existía pero no tenía
// ninguna pantalla -- solo se veían los que el sistema generaba solo (PAGO_PENDIENTE de un
// cierre/split). Esto es para cargar un crédito/débito/corrección a mano, con motivo
// obligatorio (sección 23: "nunca modifica memoria/pagos en silencio, siempre queda una fila").
// Importante: este ajuste queda solo como registro/nota -- no mueve memoria ni genera ningún
// pago por sí mismo, eso sigue siendo manual (ver "Marcar pagado").
const TIPOS_AJUSTE = [
  { value: "CREDITO_JUGADOR", label: "Crédito a favor del jugador" },
  { value: "DEBITO_JUGADOR", label: "Débito contra el jugador" },
  { value: "AJUSTE_MEMORIA", label: "Ajuste de memoria (informativo)" },
  { value: "CORRECCION_CIERRE", label: "Corrección de un cierre" },
  { value: "PAGO_PENDIENTE", label: "Pago pendiente" },
  { value: "COMPENSACION", label: "Compensación" },
  { value: "ADMINISTRATIVO", label: "Administrativo" },
];
function AjusteManualForm({ contrato, periodoId, onCreated }: { contrato: any; periodoId?: string | null; onCreated: () => void }) {
  const [tipo, setTipo] = useState("CREDITO_JUGADOR");
  const [importe, setImporte] = useState("");
  const [signo, setSigno] = useState<"POSITIVO" | "NEGATIVO">("POSITIVO");
  const [motivo, setMotivo] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    if (!motivo.trim()) return setMsg({ ok: false, text: "El motivo es obligatorio -- nunca se carga un ajuste sin dejar por qué." });
    if (!importe.trim() || Number(importe) <= 0) return setMsg({ ok: false, text: "El importe tiene que ser mayor a 0 (el signo ya lo indica aparte)." });
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.crearAjuste(contrato.id, {
        periodoId: periodoId ?? undefined,
        tipo,
        importe: Number(importe),
        signo,
        motivo: motivo.trim(),
        observaciones: observaciones.trim() || undefined,
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cargar el ajuste." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 10, marginBottom: 14, maxWidth: 480 }}>
      <div className="form-grid">
        <div className="field">
          <label>Tipo</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS_AJUSTE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Signo</label>
          <select value={signo} onChange={(e) => setSigno(e.target.value as any)}>
            <option value="POSITIVO">A favor (positivo)</option>
            <option value="NEGATIVO">En contra (negativo)</option>
          </select>
        </div>
      </div>
      <div className="field"><label>Importe (USD)</label><input type="number" step="0.01" value={importe} onChange={(e) => setImporte(e.target.value)} /></div>
      <div className="field"><label>Motivo (obligatorio)</label><input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
      <div className="field"><label>Observaciones</label><input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Cargar ajuste"}</button>
    </div>
  );
}

// Costos fijos (sección 29, pedido Leo 05/10/2026): "completamente aparte del deal" -- nunca
// toca resultado deal, memoria, rake, split ni ganancia TeamBack. Es por contrato (no por
// período), un valor por mes -- registrarCostoFijo hace upsert por (contrato_id, anio, mes), así
// que volver a cargar el mismo mes directamente lo corrige.
function CostosFijosPanel({ contrato }: { contrato: any }) {
  const [costos, setCostos] = useState<any[] | null>(null);
  const [mostrar, setMostrar] = useState(false);
  const hoy = new Date();
  const [anio, setAnio] = useState(String(hoy.getFullYear()));
  const [mes, setMes] = useState(String(hoy.getMonth() + 1));
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState(contrato.moneda || "USD");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function refresh() {
    api.bancadoContratos.costosFijos(contrato.id).then(setCostos).catch(() => {});
  }
  useEffect(() => { refresh(); }, [contrato.id]);

  async function guardar() {
    if (!monto.trim()) return setMsg({ ok: false, text: "Falta el monto." });
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.registrarCostoFijo(contrato.id, {
        anio: Number(anio),
        mes: Number(mes),
        monto: Number(monto),
        moneda,
        observaciones: observaciones.trim() || undefined,
      });
      setMonto("");
      setObservaciones("");
      refresh();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo guardar el costo fijo." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Costos fijos (aparte del deal)</h3>
        <button className="btn secondary small" onClick={() => setMostrar((v) => !v)}>{mostrar ? "Cerrar" : "+ Cargar costo fijo"}</button>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
        Nunca afecta el resultado del deal, la memoria, el rake ni el split -- es un gasto aparte, por mes. Cargar el mismo
        mes de nuevo corrige el monto anterior (no duplica).
      </div>
      {mostrar && (
        <div style={{ marginTop: 10, maxWidth: 480 }}>
          <div className="form-grid">
            <div className="field"><label>Año</label><input type="number" value={anio} onChange={(e) => setAnio(e.target.value)} /></div>
            <div className="field">
              <label>Mes</label>
              <select value={mes} onChange={(e) => setMes(e.target.value)}>
                {MESES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="form-grid">
            <div className="field"><label>Monto</label><input type="number" step="0.01" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
            <div className="field"><label>Moneda</label><input value={moneda} onChange={(e) => setMoneda(e.target.value)} /></div>
          </div>
          <div className="field"><label>Observaciones</label><input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
          {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
          <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Guardar"}</button>
        </div>
      )}
      {!costos ? <div className="muted" style={{ marginTop: 10 }}>Cargando...</div> : costos.length === 0 ? <div className="muted" style={{ marginTop: 10 }}>Sin costos fijos cargados.</div> : (
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>Mes</th><th className="num">Monto</th><th>Observaciones</th></tr></thead>
          <tbody>
            {costos.map((c) => (
              <tr key={c.id}>
                <td className="muted">{MESES[c.mes - 1]} {c.anio}</td>
                <td className="num">{usd(c.monto)} {c.moneda !== "USD" ? c.moneda : ""}</td>
                <td className="muted">{c.observaciones ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ParcialForm({ contrato, periodoId, onCreated }: { contrato: any; periodoId: string; onCreated: () => void }) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [resultadoMesas, setResultadoMesas] = useState("");
  const [rakeBruto, setRakeBruto] = useState("");
  const [ajuste, setAjuste] = useState("0");
  const [ajusteNota, setAjusteNota] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    if (!desde || !hasta) return setMsg({ ok: false, text: "Faltan las fechas." });
    if (hasta < desde) return setMsg({ ok: false, text: "La fecha \"hasta\" no puede ser anterior a \"desde\"." });
    if (Number(ajuste) !== 0 && !ajusteNota.trim()) return setMsg({ ok: false, text: "Un ajuste distinto de 0 necesita una nota." });
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.registrarParcial(periodoId, {
        desde,
        hasta,
        resultadoMesas: Number(resultadoMesas),
        rakeBruto: Number(rakeBruto),
        ajuste: Number(ajuste) || 0,
        ajusteNota: ajusteNota.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo registrar el parcial." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <ImportarResultadoContrato
        contrato={contrato}
        onEncontrado={(r, rk) => { setResultadoMesas(String(r)); setRakeBruto(String(rk)); }}
      />
      <div className="form-grid">
        <div className="field"><label>Desde</label><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></div>
        <div className="field"><label>Hasta</label><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></div>
      </div>
      <div className="form-grid">
        <div className="field"><label>Resultado de mesas</label><input type="number" value={resultadoMesas} onChange={(e) => setResultadoMesas(e.target.value)} /></div>
        <div className="field"><label>Rake bruto</label><input type="number" value={rakeBruto} onChange={(e) => setRakeBruto(e.target.value)} /></div>
      </div>
      <div className="field"><label>Ajuste (opcional, se suma al resultado deal)</label><input type="number" value={ajuste} onChange={(e) => setAjuste(e.target.value)} /></div>
      {Number(ajuste) !== 0 && (
        <div className="field"><label>Nota del ajuste (obligatoria)</label><input value={ajusteNota} onChange={(e) => setAjusteNota(e.target.value)} /></div>
      )}
      <div className="field"><label>Observaciones</label><input value={observaciones} onChange={(e) => setObservaciones(e.target.value)} /></div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Guardando..." : "Cargar parcial"}</button>
    </div>
  );
}

function ExtraordinarioForm({
  periodoId, pendienteSugerido, memoriaActual, onCreated,
}: { periodoId: string; pendienteSugerido: number; memoriaActual: number; onCreated: () => void }) {
  const [gananciaDisponible, setGananciaDisponible] = useState(String(pendienteSugerido.toFixed(2)));
  const [memoriaAplicada, setMemoriaAplicada] = useState("0");
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guardar() {
    if (!motivo.trim()) return setMsg({ ok: false, text: "El split extraordinario necesita un motivo (autorización explícita, sección 17)." });
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.splitExtraordinario(periodoId, {
        gananciaDisponible: Number(gananciaDisponible),
        memoriaAplicada: Number(memoriaAplicada),
        motivo: motivo.trim(),
      });
      onCreated();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo autorizar el split extraordinario." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="muted" style={{ marginBottom: 10, fontSize: 12 }}>
        Memoria actual: {usd(memoriaActual)}. Sugerido como ganancia disponible (según los parciales cargados hasta
        ahora): {usd(pendienteSugerido)} -- se puede ajustar.
      </div>
      <div className="field"><label>Ganancia disponible a repartir</label><input type="number" value={gananciaDisponible} onChange={(e) => setGananciaDisponible(e.target.value)} /></div>
      <div className="field"><label>Cuánto de eso va a memoria</label><input type="number" value={memoriaAplicada} onChange={(e) => setMemoriaAplicada(e.target.value)} /></div>
      <div className="field"><label>Motivo / autorización</label><input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={guardar}>{guardando ? "Autorizando..." : "Autorizar split extraordinario"}</button>
    </div>
  );
}

function CerrarMesForm({
  periodoId, modoMemoriaPeriodo, proyeccion, confirmDialog, onCerrado,
}: { periodoId: string; modoMemoriaPeriodo: "AUTOMATICO" | "PARCIAL_MANUAL"; proyeccion: any; confirmDialog: any; onCerrado: () => void }) {
  const [modoMemoria, setModoMemoria] = useState<"AUTOMATICO" | "PARCIAL_MANUAL">(modoMemoriaPeriodo);
  const [memoriaAplicadaManual, setMemoriaAplicadaManual] = useState("");
  const [pagoReal, setPagoReal] = useState(String(proyeccion.splitJugadorProyectado));
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function cerrar() {
    if (!(await confirmDialog(
      `Vas a cerrar el mes. Resultado deal acumulado: ${usd(proyeccion.acumulados.resultadoDealAcumulado)}, memoria final estimada ${usd(proyeccion.memoriaProyectada)}, split jugador estimado ${usd(proyeccion.splitJugadorProyectado)}. Esto consolida todos los parciales y NO se puede deshacer salvo una reapertura auditada. ¿Confirmás?`
    ))) return;
    setGuardando(true);
    setMsg(null);
    try {
      await api.bancadoContratos.cerrarMes(periodoId, {
        modoMemoria,
        memoriaAplicadaManual: modoMemoria === "PARCIAL_MANUAL" ? Number(memoriaAplicadaManual) : undefined,
        pagoReal: pagoReal.trim() ? Number(pagoReal) : undefined,
      });
      onCerrado();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo cerrar el mes." });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Cierre mensual -- pantalla de confirmación</h3>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
        Resultado mesas total: <strong>{usd(proyeccion.acumulados.resultadoMesasAcumulado)}</strong><br />
        Rake bruto total: <strong>{usd(proyeccion.acumulados.rakeBrutoAcumulado)}</strong><br />
        Resultado deal total: <strong>{usd(proyeccion.acumulados.resultadoDealAcumulado)}</strong><br />
        Rake directo TeamBack (nunca se reparte): <strong>{usd(proyeccion.acumulados.rakeTeambackAcumulado)}</strong><br />
        Split jugador estimado: <strong>{usd(proyeccion.splitJugadorProyectado)}</strong> -- Split TeamBack estimado: <strong>{usd(proyeccion.splitTeambackProyectado)}</strong><br />
        Memoria final estimada: <strong>{usd(proyeccion.memoriaProyectada)}</strong>
      </div>
      <div className="field">
        <label>Modo de recuperación de memoria para este cierre</label>
        <select value={modoMemoria} onChange={(e) => setModoMemoria(e.target.value as any)}>
          <option value="AUTOMATICO">Automático</option>
          <option value="PARCIAL_MANUAL">Parcial manual</option>
        </select>
      </div>
      {modoMemoria === "PARCIAL_MANUAL" && (
        <div className="field"><label>Memoria a aplicar</label><input type="number" value={memoriaAplicadaManual} onChange={(e) => setMemoriaAplicadaManual(e.target.value)} /></div>
      )}
      <div className="field"><label>Pago real al jugador (si difiere del teórico)</label><input type="number" value={pagoReal} onChange={(e) => setPagoReal(e.target.value)} /></div>
      {msg && <div className={msg.ok ? "success" : "error"}>{msg.text}</div>}
      <button className="btn" disabled={guardando} onClick={cerrar}>{guardando ? "Cerrando..." : "Confirmar cierre mensual"}</button>
    </div>
  );
}
