import { useEffect, useState, useRef, Fragment } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { exportCsv } from "../csv";
import { useConfirmDialog } from "../components/ConfirmProvider";
import ActionsMenu from "../components/ActionsMenu";
import Modal from "../components/Modal";
import Ayuda from "../components/Ayuda";
import { usePaginado, WmPaginacion, WmTabs, WmSaldoCard, WmConteos, type WmTab } from "../components/ListaWm";
import { Contexto, IconoSemana } from "../components/Identidad";

// Monto en USD con color segun signo (verde positivo, rojo negativo) y sin salto de linea
// entre el "-" y el numero (Intl mete un espacio despues del simbolo de moneda que, en una
// columna angosta, el navegador puede usar como punto de corte).
function Monto({ value }: { value: number | string | null | undefined }) {
  if (value == null) return <span className="muted">-</span>;
  const n = Number(value);
  return <span className={`money ${n >= 0 ? "pos" : "neg"}`}>{usd(n)}</span>;
}

// Fracción del deal (0.6) → texto del formulario en % ("60"), sin decimales flotantes (0.6 * 100 = 60.00000000000001).
function pctTexto(fraccion: number | string | null | undefined): string {
  return String(Math.round(Number(fraccion ?? 0) * 10000) / 100);
}

export default function Cierres() {
  const { alertDialog, promptDialog } = useConfirmDialog();
  // Deep-link desde otras pantallas (ej. Resumen financiero → "ver en Cierres" de una fila de
  // Ganancia cierres semanales): ?week=YYYY-MM-DD&club=<clubId> — expande esa semana aunque no
  // sea la más reciente, resalta sus filas (todas si no vino club, o solo las de ese club) y
  // hace scroll hasta ahí apenas cargan los cierres.
  const [searchParams] = useSearchParams();
  const weekObjetivo = searchParams.get("week");
  const clubObjetivo = searchParams.get("club");
  const [cierres, setCierres] = useState<any[]>([]);
  const [agentes, setAgentes] = useState<any[]>([]);
  const [clubes, setClubes] = useState<any[]>([]);
  const [bancados, setBancados] = useState<any[]>([]);
  const [adelantos, setAdelantos] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [borrando, setBorrando] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());

  function toggleExpandido(id: string) {
    setExpandido((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Historial por semana (19/10/2026, mockup aprobado): una semana a la vez (chips), con sus cifras
  // arriba, filtro por club y los cierres en US$ 0 ocultos. Las cargas manuales y los cierres con
  // fechas raras (semana de 1 día o que termina antes de empezar) van aparte, en su propio chip,
  // para que no ensucien el total de la semana a la que dicen pertenecer.
  const RAROS = "__raros";
  const [semanaSel, setSemanaSel] = useState<string | null>(null);
  const [clubFiltro, setClubFiltro] = useState<string>(clubObjetivo ?? "");
  const [mostrarCero, setMostrarCero] = useState(false);
  const [borrandoSemana, setBorrandoSemana] = useState(false);
  // Historial con el estilo de la Wallet (23/10/2026, pedido de Leo, mockup aprobado): buscador, filtro de sistema y paginación.
  const [busca, setBusca] = useState("");
  const [sistemaFiltro, setSistemaFiltro] = useState("");

  const esRaro = (c: any) => !!c.is_manual || String(c.week_end).slice(0, 10) <= String(c.week_start).slice(0, 10);
  const filasRaras = cierres.filter(esRaro);
  // Cierres ya vienen ordenados por semana desc + nombre desde el backend — solo hace falta
  // agrupar filas consecutivas de la misma semana, no reordenar nada.
  const gruposPorSemana: { weekStart: string; weekEnd: string; filas: any[] }[] = [];
  for (const c of cierres) {
    if (esRaro(c)) continue;
    const g = gruposPorSemana.find((x) => x.weekStart === c.week_start);
    if (g) g.filas.push(c);
    else gruposPorSemana.push({ weekStart: c.week_start, weekEnd: c.week_end, filas: [c] });
  }
  const defectoSemana =
    (weekObjetivo && gruposPorSemana.some((g) => g.weekStart === weekObjetivo) ? weekObjetivo : null) ??
    gruposPorSemana[0]?.weekStart ??
    (filasRaras.length > 0 ? RAROS : null);
  const semanaActiva =
    semanaSel && (semanaSel === RAROS ? filasRaras.length > 0 : gruposPorSemana.some((g) => g.weekStart === semanaSel))
      ? semanaSel
      : defectoSemana;
  const grupoActivo = semanaActiva === RAROS ? null : gruposPorSemana.find((g) => g.weekStart === semanaActiva) ?? null;
  const filasSemana: any[] = semanaActiva === RAROS ? filasRaras : grupoActivo?.filas ?? [];
  const enCero = (c: any) => c.status !== "REVERTIDO" && Math.abs(Number(c.final_closing)) < 0.005;
  const clubesDeLaSemana = Array.from(new Set(filasSemana.map((c) => c.club_name)));
  const filasDelClub = filasSemana.filter((c) => !clubFiltro || c.club_id === clubFiltro);
  const cantEnCero = filasDelClub.filter(enCero).length;
  const qb = busca.trim().toLowerCase();
  const filasVisibles = filasDelClub
    .filter((c) => mostrarCero || !enCero(c))
    .filter((c) => (sistemaFiltro === "" || c.system === sistemaFiltro) && (qb === "" || `${c.agent_name} ${c.club_name}`.toLowerCase().includes(qb)))
    .sort((a, b) => Math.abs(Number(b.final_closing)) - Math.abs(Number(a.final_closing)));
  const pgCierres = usePaginado(filasVisibles, "dp_cierres_tamano", [semanaActiva, clubFiltro, mostrarCero, busca, sistemaFiltro]);
  const iniciales = (n: string) => {
    const p = String(n ?? "").trim().split(/\s+/).filter(Boolean);
    return p.length === 0 ? "?" : ((p[0][0] ?? "") + (p.length > 1 ? p[1][0] ?? "" : p[0][1] ?? "")).toUpperCase();
  };
  // Las cifras de arriba no cuentan los cierres revertidos (ya no valen).
  const vigentes = filasDelClub.filter((c) => c.status !== "REVERTIDO");
  const sumar = (k: string) => vigentes.reduce((s, c) => s + Number(c[k] ?? 0), 0);
  const totFinal = sumar("final_closing");
  const totRake = sumar("rake_total");
  const totResultado = sumar("result");
  const totRakeback = sumar("rakeback");
  const SEMANAS_EN_CHIPS = 8;
  const semanasChips = gruposPorSemana.slice(0, SEMANAS_EN_CHIPS);
  const semanasAnteriores = gruposPorSemana.slice(SEMANAS_EN_CHIPS);
  const dm = (s: string) => {
    const [, m, d] = String(s).slice(0, 10).split("-");
    return `${d}/${m}`;
  };

  // Scroll hasta la semana del deep-link (una sola vez, apenas hay cierres cargados).
  const yaHizoScroll = useRef(false);
  useEffect(() => {
    if (!weekObjetivo || yaHizoScroll.current || cierres.length === 0) return;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById("cierres-semana");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        yaHizoScroll.current = true;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [cierres, weekObjetivo]);

  async function borrarSemanaCompleta(weekStart: string, clubId?: string) {
    const club = clubId ? clubes.find((c) => c.id === clubId) : null;
    const cantidad = cierres.filter((c) => c.week_start === weekStart && (!clubId || c.club_id === clubId)).length;
    if (cantidad === 0) {
      await alertDialog("No hay cierres cargados con ese filtro.");
      return;
    }
    const confirmacion = await promptDialog(
      `Esto BORRA DEL TODO ${cantidad} cierre(s) de la semana ${dateShort(weekStart)}${club ? ` en ${club.name}` : " (todos los clubes)"} — no queda en ningún historial, a diferencia de "Revertir".\n\nUsalo SOLO para limpiar datos de prueba, nunca sobre plata real ya operada.\n\nEscribí BORRAR para confirmar:`
    );
    if (confirmacion !== "BORRAR") return;
    setBorrandoSemana(true);
    try {
      const r = await api.eliminarCierresSemanaDefinitivo(weekStart, clubId || undefined);
      if (r.errores?.length > 0) {
        await alertDialog(`Se borraron ${r.borrados} de ${r.total} cierre(s). ${r.errores.length} no se pudieron borrar automáticamente (revisalos a mano):\n\n${r.errores.map((e: any) => e.message).join("\n")}`);
      }
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo borrar la semana.");
    } finally {
      setBorrandoSemana(false);
    }
  }

  const filaCsv = (c: any) => ({
    semana_desde: c.week_start,
    semana_hasta: c.week_end,
    agente: c.agent_name,
    club: c.club_name,
    sistema: c.system,
    jugadores: c.jugadores ?? "",
    resultado: c.result,
    rake: c.rake_total,
    ring_game: c.ring_game ?? "",
    mtt: c.mtt ?? "",
    sng: c.sng ?? "",
    spin: c.spin ?? "",
    rakeback: c.rakeback,
    rodeo: c.rodeo,
    cierre_final: c.final_closing,
    regla: c.rule_applied ?? "",
  });

  // Texto con signo y sin decimales para las columnas (el signo "−" pegado al número).
  const montoTxt = (n: number | string | null | undefined) => {
    const v = Number(n ?? 0);
    return `${v < 0 ? "−" : ""}${usd(Math.abs(v))}`;
  };


  function refresh() {
    api.cierres().then(setCierres);
    api.bancados().then(setBancados);
  }

  async function revertirCierre(c: any) {
    const motivo = await promptDialog(`Revertir cierre de ${c.agent_name} en ${c.club_name} (semana ${dateShort(c.week_start)} - ${dateShort(c.week_end)}).\n\n¿Por qué lo revertís? (queda en el historial, no se borra nada)`);
    if (motivo === null) return;
    setBorrando(c.id);
    try {
      await api.revertirCierre(c.id, motivo || undefined);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo revertir el cierre.");
    } finally {
      setBorrando(null);
    }
  }

  // BORRADO REAL — solo para limpiar datos de PRUEBA. Sobre plata real siempre "Revertir"
  // (arriba), nunca esto. Pide escribir "BORRAR" literal para no tocarlo por error de un clic.
  async function borrarDefinitivo(c: any) {
    const confirmacion = await promptDialog(
      `Esto BORRA DEL TODO el cierre de ${c.agent_name} en ${c.club_name} (semana ${dateShort(c.week_start)} - ${dateShort(c.week_end)}) — no queda en ningún historial, a diferencia de "Revertir".\n\nUsalo SOLO para limpiar datos de prueba, nunca sobre plata real ya operada.\n\nEscribí BORRAR para confirmar:`
    );
    if (confirmacion !== "BORRAR") return;
    setBorrando(c.id);
    try {
      await api.eliminarCierreDefinitivo(c.id);
      refresh();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo borrar el cierre.");
    } finally {
      setBorrando(null);
    }
  }

  useEffect(() => {
    refresh();
    api.agentes().then(setAgentes);
    api.clubes().then(setClubes);
    api.adelantos().then(setAdelantos).catch(() => {});
  }, []);

  // Desglose Ring Game/MTT/SNG/Spin: solo existe en cierres de formato Suprema cargados después de
  // ese cambio — el resto queda en NULL. La cantidad de jugadores va en la fila, no acá.
  const tieneDesglose = (c: any) => c.ring_game != null || c.mtt != null || c.sng != null || c.spin != null;
  const desgloseCierre = (c: any) => (
    <div style={{ display: "flex", gap: 24, padding: "4px 0", flexWrap: "wrap" }}>
      <span>Jugadores: <strong>{c.jugadores ?? "-"}</strong></span>
      <span>Ring Game: <strong>{c.ring_game != null ? usd(c.ring_game) : "-"}</strong></span>
      <span>MTT: <strong>{c.mtt != null ? usd(c.mtt) : "-"}</strong></span>
      <span>SNG: <strong>{c.sng != null ? usd(c.sng) : "-"}</strong></span>
      <span>Spin: <strong>{c.spin != null ? usd(c.spin) : "-"}</strong></span>
    </div>
  );
  // "Extra" junta revertido, manual, regla, rodeo y jugadores en una sola celda (en blanco si no hay nada).
  const extraCierre = (c: any) => (
    <>
      {c.status === "REVERTIDO" && <span className="badge neg" style={{ marginRight: 6 }}>Revertido</span>}
      {c.is_manual && (
        <span className="badge neutral" style={{ marginRight: 6 }} title="Carga manual de rakeback pendiente histórico -- no es un cierre real, no mueve stock ni ledger (ver Rakeback pendiente).">
          Manual
        </span>
      )}
      {c.rule_applied && <span className="badge neutral" style={{ marginRight: 6 }}>{c.rule_applied}</span>}
      {c.rodeo != null && Number(c.rodeo) !== 0 && <span className="muted" style={{ marginRight: 6 }}>Rodeo {usd(c.rodeo)}</span>}
      {c.jugadores != null && <span className="muted">{c.jugadores} jugador{Number(c.jugadores) === 1 ? "" : "es"}</span>}
      {c.rule_applied === "BANCADO" && (
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          Ganancia DigiPlayers: {usd(c.bancado_digiplayers_share)}
          {Number(c.bancado_debt_after) > 0 && <> · Memoria: {usd(c.bancado_debt_before)} → {usd(c.bancado_debt_after)}</>}
        </div>
      )}
    </>
  );
  const itemsCierre = (c: any) => [
    ...(c.status !== "REVERTIDO"
      ? [{ label: borrando === c.id ? "Revirtiendo..." : "Revertir cierre", onClick: () => revertirCierre(c), disabled: borrando === c.id }]
      : []),
    ...(tieneDesglose(c)
      ? [{ label: expandido.has(c.id) ? "Ocultar desglose" : "Ver desglose", onClick: () => toggleExpandido(c.id) }]
      : []),
    {
      label: borrando === c.id ? "Borrando..." : "Borrar (borrado real, sin rastro)",
      onClick: () => borrarDefinitivo(c),
      danger: true,
      disabled: borrando === c.id,
    },
  ];

  return (
    <div>
      <div className="topbar">
        <div>
          <h2>Cierres semanales <Ayuda>Clave idempotente (agente + club + semana) — un cierre nunca se aplica dos veces (BIT-001).</Ayuda></h2>
          <Contexto
            chips={[
              grupoActivo && { texto: `Semana ${dateShort(grupoActivo.weekStart)} – ${dateShort(grupoActivo.weekEnd)}`, tono: "fuerte", icono: IconoSemana },
              filasSemana.length > 0 && { texto: `${filasSemana.length} cierres · ${clubesDeLaSemana.length} club${clubesDeLaSemana.length === 1 ? "" : "es"}` },
              gruposPorSemana.length > 0 && { texto: `${gruposPorSemana.length} semanas cargadas` },
              filasRaras.length > 0 && { texto: `${filasRaras.length} con fechas raras`, tono: "alerta", onClick: () => setSemanaSel(RAROS) },
            ]}
          />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn secondary" onClick={() => setShowImport((v) => !v)}>{showImport ? "Cerrar importador" : "Importar archivo"}</button>
          <button className="btn" onClick={() => setShowForm((v) => !v)}>{showForm ? "Cerrar formulario" : "+ Aplicar cierre"}</button>
        </div>
      </div>

      {showImport && (
        <ImportarCierre
          agentes={agentes}
          onDone={() => {
            refresh();
          }}
        />
      )}

      {showForm && (
        <NuevoCierre
          agentes={agentes}
          clubes={clubes}
          adelantos={adelantos}
          onApplied={() => {
            refresh();
            api.adelantos().then(setAdelantos).catch(() => {});
          }}
        />
      )}

      <div id="cierres-semana" className="wm">
        {cierres.length > 0 && (
          <WmSaldoCard
            etiqueta={`CIERRE FINAL${semanaActiva === RAROS ? "" : " DE LA SEMANA"}${grupoActivo ? ` · ${dm(grupoActivo.weekStart)} AL ${dm(grupoActivo.weekEnd)}` : " · CARGAS APARTE"}`}
            monto={montoTxt(totFinal)}
            signo={totFinal >= 0 ? "pos" : "neg"}
            sub={`${vigentes.length} cierre${vigentes.length === 1 ? "" : "s"} · ${new Set(vigentes.map((c) => c.club_id)).size} club${new Set(vigentes.map((c) => c.club_id)).size === 1 ? "" : "es"}${filasDelClub.length > vigentes.length ? ` · ${filasDelClub.length - vigentes.length} revertido${filasDelClub.length - vigentes.length === 1 ? "" : "s"}` : ""}`}
          >
            <WmConteos
              items={[
                { etiqueta: "RAKE", valor: <>{usd(totRake)}<span className="muted" style={{ display: "block", fontSize: 12, fontWeight: 400 }}>rakeback {usd(totRakeback)}</span></> },
                { etiqueta: "RESULTADO DE MESAS", valor: <>{montoTxt(totResultado)}<span className="muted" style={{ display: "block", fontSize: 12, fontWeight: 400 }}>suma de los agentes</span></> },
              ]}
            />
          </WmSaldoCard>
        )}

        <div className="wm-card">
        <div className="wm-cab">
          <div className="wm-h">Historial de cierres <span className="wm-n">{filasDelClub.length}</span></div>
          <div className="wm-fil">
            <input className="wm-in" placeholder="Buscar agente o club..." value={busca} onChange={(e) => setBusca(e.target.value)} />
            <select className="wm-in" value={sistemaFiltro} onChange={(e) => setSistemaFiltro(e.target.value)} aria-label="Sistema">
              <option value="">Sistema: todos</option>
              <option value="PREPAGO">Prepago</option>
              <option value="WIN_LOSE">Win/Lose</option>
            </select>
            {cantEnCero > 0 && (
              <button type="button" className={`wm-in wm-btn ${mostrarCero ? "on" : ""}`} onClick={() => setMostrarCero((v) => !v)}>Mostrar los {cantEnCero} en US$ 0</button>
            )}
            <button
              type="button"
              className="wm-in wm-btn"
              disabled={filasVisibles.length === 0}
              onClick={() => exportCsv("cierres_semanales.csv", filasDelClub.map(filaCsv))}
            >
              Exportar CSV
            </button>
            <ActionsMenu
              title="Más acciones"
              items={[
                { label: "Exportar todo el historial (CSV)", onClick: () => exportCsv("cierres_semanales_historial.csv", cierres.map(filaCsv)) },
                ...(grupoActivo
                  ? [
                      ...(clubFiltro
                        ? [{
                            label: `Borrar semana en ${clubes.find((c) => c.id === clubFiltro)?.name ?? "este club"}…`,
                            onClick: () => borrarSemanaCompleta(grupoActivo.weekStart, clubFiltro),
                            danger: true,
                            disabled: borrandoSemana,
                          }]
                        : []),
                      {
                        label: borrandoSemana ? "Borrando..." : "Borrar semana completa…",
                        onClick: () => borrarSemanaCompleta(grupoActivo.weekStart),
                        danger: true,
                        disabled: borrandoSemana,
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>

        {cierres.length === 0 ? (
          <div className="muted">Todavía no hay cierres cargados.</div>
        ) : (
          <>
            <div className="tb-week-chips" style={{ justifyContent: "flex-start", marginBottom: 14, alignItems: "center" }}>
              {semanasChips.map((g) => (
                <button
                  key={g.weekStart}
                  className={`chip${semanaActiva === g.weekStart ? " chip-active" : ""}`}
                  onClick={() => { setSemanaSel(g.weekStart); setClubFiltro(""); }}
                >
                  {dm(g.weekStart)} – {dm(g.weekEnd)}
                </button>
              ))}
              {semanasAnteriores.length > 0 && (
                <select
                  value={semanasAnteriores.some((g) => g.weekStart === semanaActiva) ? semanaActiva ?? "" : ""}
                  onChange={(e) => { if (e.target.value) { setSemanaSel(e.target.value); setClubFiltro(""); } }}
                  style={{ width: "auto" }}
                >
                  <option value="">Anteriores…</option>
                  {semanasAnteriores.map((g) => (
                    <option key={g.weekStart} value={g.weekStart}>{dm(g.weekStart)} – {dm(g.weekEnd)}</option>
                  ))}
                </select>
              )}
              {filasRaras.length > 0 && (
                <button
                  className={`chip${semanaActiva === RAROS ? " chip-active" : ""}`}
                  onClick={() => { setSemanaSel(RAROS); setClubFiltro(""); }}
                  title="Cargas manuales y cierres con fechas raras (semana de un día o que termina antes de empezar)"
                >
                  Manuales / fechas raras {filasRaras.length}
                </button>
              )}
            </div>

            <WmTabs
              actual={clubFiltro}
              onChange={setClubFiltro}
              tabs={
                [
                  { k: "", t: "Todos", n: filasSemana.length },
                  ...clubesDeLaSemana.map((nombre) => {
                    const id = filasSemana.find((c) => c.club_name === nombre)?.club_id;
                    return { k: id, t: nombre, n: filasSemana.filter((c) => c.club_id === id).length };
                  }),
                ] as WmTab<string>[]
              }
            />

            <div className="ag-table-wrap">
              <div className="cz-th">
                <span>AGENTE · CLUB</span><span>SISTEMA</span><span>RESULTADO</span><span>RAKE</span><span>RAKEBACK</span><span>CIERRE FINAL</span><span>EXTRA</span><span />
              </div>
              {pgCierres.recorte.map((c) => {
                const final = Number(c.final_closing);
                const abierto = expandido.has(c.id);
                const resaltada = c.week_start === weekObjetivo && (!clubObjetivo || c.club_id === clubObjetivo);
                return (
                  <Fragment key={c.id}>
                    <div className={`cz-fila${resaltada ? " fila-destacada" : ""}`} style={c.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}>
                      <div className="wm-who">
                        <span className={`wm-av ${final < -0.004 ? "n" : ""}`}>{iniciales(c.agent_name)}</span>
                        <div>
                          <div className="saldo-name">{c.agent_name}</div>
                          <div className="saldo-sub">{c.club_name}</div>
                        </div>
                      </div>
                      <span><span className={`wm-pill ${c.system === "PREPAGO" ? "neutro" : "gris"}`}>{c.system === "PREPAGO" ? "Prepago" : "Win/Lose"}</span></span>
                      <span className={`n ${Number(c.result) < -0.004 ? "r" : ""}`}>{montoTxt(c.result)}</span>
                      <span className="n">{usd(c.rake_total)}</span>
                      <span className="n">{usd(c.rakeback)}</span>
                      <span className={`t ${final > 0.004 ? "p" : final < -0.004 ? "r" : ""}`}>{montoTxt(final)}</span>
                      <span className="ex">{extraCierre(c)}</span>
                      <div style={{ textAlign: "right" }}><ActionsMenu items={itemsCierre(c)} /></div>
                    </div>
                    {abierto && tieneDesglose(c) && <div className="cz-desglose muted">{desgloseCierre(c)}</div>}
                  </Fragment>
                );
              })}
              {filasVisibles.length === 0 && <div className="muted" style={{ padding: "16px 8px" }}>No hay cierres para mostrar con estos filtros.</div>}
            </div>

            <div className="ag-cards">
              {pgCierres.recorte.map((c) => {
                const final = Number(c.final_closing);
                const abierto = expandido.has(c.id);
                const resaltada = c.week_start === weekObjetivo && (!clubObjetivo || c.club_id === clubObjetivo);
                return (
                  <div
                    key={c.id}
                    className={`saldo-card ${final > 0 ? "is-pos" : final < 0 ? "is-neg" : ""}${resaltada ? " fila-destacada" : ""}`}
                    style={c.status === "REVERTIDO" ? { opacity: 0.55 } : undefined}
                  >
                    <div className="saldo-card-body">
                      <div className="saldo-card-top">
                        <div className="saldo-name">{c.agent_name}</div>
                        <div className={`saldo-big ${final > 0 ? "pos" : final < 0 ? "neg" : "neutral"}`}>{montoTxt(final)}</div>
                      </div>
                      <div className="saldo-card-mid">
                        <div className="saldo-sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          {c.club_name} · {c.system === "PREPAGO" ? "Prepago" : "Win/Lose"}
                          {extraCierre(c)}
                        </div>
                        <ActionsMenu items={itemsCierre(c)} />
                      </div>
                      <div className="saldo-card-foot" style={{ gap: 16 }}>
                        <span>Resultado <b>{montoTxt(c.result)}</b></span>
                        <span>Rake <b>{usd(c.rake_total)}</b></span>
                        <span>Rakeback <b>{usd(c.rakeback)}</b></span>
                      </div>
                      {abierto && tieneDesglose(c) && <div className="muted" style={{ marginTop: 8 }}>{desgloseCierre(c)}</div>}
                    </div>
                  </div>
                );
              })}
              {filasVisibles.length === 0 && <div className="muted">No hay cierres para mostrar con estos filtros.</div>}
            </div>
            <div className="wm-pie">
              <div className="wm-tot">
                <span>Cierre final de lo filtrado <b className={filasVisibles.filter((c) => c.status !== "REVERTIDO").reduce((a, c) => a + Number(c.final_closing), 0) >= 0 ? "in" : "out"}>{montoTxt(filasVisibles.filter((c) => c.status !== "REVERTIDO").reduce((a, c) => a + Number(c.final_closing), 0))}</b></span>
                <small>
                  {filasVisibles.length} cierre{filasVisibles.length === 1 ? "" : "s"}
                  {!mostrarCero && cantEnCero > 0 ? ` · ${cantEnCero} en US$ 0 oculto${cantEnCero === 1 ? "" : "s"}` : ""}
                </small>
              </div>
            </div>
            <WmPaginacion p={pgCierres} unidad="cierres" />
          </>
        )}
        </div>
      </div>

      {bancados.length > 0 && (
        <div className="panel">
          <h3>Memoria de bancados <Ayuda>Deuda eterna: cuando el rakeback de una semana no alcanza para cubrir la pérdida en mesa de un bancado, la diferencia
            queda acá y se descuenta de sus próximas semanas positivas antes de acreditarle nada.</Ayuda></h3>
          <table>
            <thead><tr><th>Bancado</th><th>Club</th><th className="num">Memoria pendiente</th><th className="num">Saldo en ese club</th></tr></thead>
            <tbody>
              {bancados.map((b) => (
                <tr key={`${b.agent_id}_${b.club_id}`}>
                  <td>{b.agent_name}</td>
                  <td>{b.club_name}</td>
                  <td className="num">
                    {Number(b.debt) > 0 ? <span className="badge neg">{usd(b.debt)}</span> : <span className="badge pos">Al día</span>}
                  </td>
                  <td className="num money">{usd(b.saldo_agente_club)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Semana lunes–domingo relativa a hoy (0 = esta, -1 = la pasada), en fechas locales YYYY-MM-DD.
function semanaRelativa(offset: number): { desde: string; hasta: string } {
  const hoy = new Date();
  const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const dia = lunes.getDay();
  lunes.setDate(lunes.getDate() + (dia === 0 ? -6 : 1 - dia) + offset * 7);
  const domingo = new Date(lunes);
  domingo.setDate(domingo.getDate() + 6);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { desde: f(lunes), hasta: f(domingo) };
}

function mondayOf(dateStr: string) {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function NuevoCierre({
  agentes,
  clubes,
  adelantos,
  onApplied,
}: {
  agentes: any[];
  clubes: any[];
  adelantos: any[];
  onApplied: () => void;
}) {
  const nav = useNavigate();
  const [agentId, setAgentId] = useState("");
  const [clubId, setClubId] = useState("");
  const [system, setSystem] = useState<"PREPAGO" | "WIN_LOSE">("WIN_LOSE");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [result, setResult] = useState("");
  const [rakeTotal, setRakeTotal] = useState("0");
  const [rakebackPct, setRakebackPct] = useState("70");
  const [rebatePct, setRebatePct] = useState("0");
  // Rodeo (solo tiene sentido para SupremaPoker — Fenix/TeamBack Suprema) cargado a mano para
  // este cierre puntual: no pasa por la memoria automática por jugador (eso solo existe en la
  // importacion de archivo), es un monto directo que el usuario tipea y se suma al cierre tal
  // cual, igual que ya pasa con rakeTotal/rakebackPct en este mismo formulario.
  const [rodeoManual, setRodeoManual] = useState("0");
  // Ajuste manual ("tickets promocionales", 18/09/2026, pedido de Leo): monto libre en USD que
  // se carga a mano y se suma/resta directo al cierre final del agente — nunca sale de ningun
  // calculo automatico (ver engine/cierre.ts). La nota es obligatoria si el monto no es 0, para
  // que quede rastreable en el historial por que se cargo.
  const [ajusteManual, setAjusteManual] = useState("0");
  const [ajusteManualNota, setAjusteManualNota] = useState("");
  const [observation, setObservation] = useState("");
  const [extrasAbiertos, setExtrasAbiertos] = useState(false);
  // Clubes en fichas (hoy: X-Poker — ver Configuración → Clubes, campo "Unidad"): el reporte de
  // la plataforma viene en fichas, no en USD, y el valor de la ficha puede cambiar de una semana
  // a otra (hoy USD 1,20 según la planilla, pero es un parámetro, no una constante) — por eso se
  // pide acá, editable, en vez de hardcodearlo. Arranca con la tasa cargada en el club (current_rate)
  // pero SIEMPRE se puede pisar para esta carga puntual si cambió.
  const [valorFicha, setValorFicha] = useState("1");
  // (25/09/2026, pedido de Leo: mismo boton "En vivo" que ya se agrego en Cargar movimiento)
  // -- PRUEBA solo para Tiny: cotizacion USDT/TWD en vivo de MAX en vez de cargar el valor a
  // mano (ver routes/marketRates.ts). Sigue siendo editable despues, esto solo prellena.
  const [cotizando, setCotizando] = useState(false);
  const [cotizacionMsg, setCotizacionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // La vista previa siempre viene del servidor (mismo motor, misma transacción con ROLLBACK)
  // para que nunca pueda mostrar un número distinto del que después se aplica de verdad.
  // previewKey identifica con qué valores de formulario se calculó — si el formulario cambia
  // después, la vista previa queda vieja y "Aplicar cierre" se bloquea hasta recalcular.
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<any | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  // Deal de Administración (13/11/2026, pedido de Leo, mockup 94): al elegir agente y club se trae el deal cargado para ese club
  // (sistema, % rakeback, % rebate) vigente para la semana del cierre. Sin deal se avisa y se deja cargar a mano.
  const [todosDeals, setTodosDeals] = useState<any[]>([]);
  const [deal, setDeal] = useState<any | null>(null);
  const [dealCargando, setDealCargando] = useState(false);
  const dealAplicado = useRef<string | null>(null);
  useEffect(() => {
    api.todosLosDeals().then(setTodosDeals).catch(() => {});
  }, []);
  const dealsDelAgente = todosDeals.filter((d) => d.agent_id === agentId);
  useEffect(() => {
    if (!agentId || !clubId) {
      setDeal(null);
      return;
    }
    let vigente = true;
    setDealCargando(true);
    api
      .configVigente(agentId, clubId, weekEnd || undefined)
      .then((cfg: any) => {
        if (!vigente) return;
        setDeal(cfg);
        // Solo se pisan los campos cuando cambia el deal (otro agente, club o versión), no cada vez que se toca la fecha:
        // así un % cambiado a mano para este cierre no se pierde.
        const clave = [agentId, clubId, cfg.source, cfg.system, cfg.rakebackPct, cfg.rebatePct].join("|");
        if (dealAplicado.current === clave) return;
        dealAplicado.current = clave;
        if (cfg.source === "deal") {
          setSystem(cfg.system);
          setRakebackPct(pctTexto(cfg.rakebackPct));
          setRebatePct(pctTexto(cfg.rebatePct));
        } else {
          setRakebackPct("");
          setRebatePct(agentes.find((a) => a.id === agentId)?.account_type === "BANCADO" ? "50" : "0");
        }
        invalidarPreview();
      })
      .catch(() => {
        if (vigente) setDeal(null);
      })
      .finally(() => {
        if (vigente) setDealCargando(false);
      });
    return () => {
      vigente = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, clubId, weekEnd]);
  const conDeal = deal?.source === "deal";
  const difiereRakeback = conDeal && Number(rakebackPct) !== Number(pctTexto(deal.rakebackPct));
  const difiereRebate = conDeal && Number(rebatePct) !== Number(pctTexto(deal.rebatePct));

  const agenteSeleccionado = agentes.find((a) => a.id === agentId);
  const esBancado = agenteSeleccionado?.account_type === "BANCADO";
  const clubSeleccionado = clubes.find((c) => c.id === clubId);
  const esFichas = clubSeleccionado?.unit === "FICHAS";
  // Aviso, no automatización: si el AGENTE (no el par agente+club — un agente sigue generando
  // rake en varios clubes a la vez, ver repo/advances.ts) tiene uno o más adelantos de rakeback
  // activos — puede tener varios a la vez, en clubes distintos — se le muestran todos al que
  // carga el cierre para que decida a mano si corresponde ir a Adelantos y registrar un Consumo
  // en alguno; el cierre se calcula y paga igual, completo, sin descontar nada solo.
  const adelantosDelAgente = adelantos.filter((a) => a.agent_id === agentId);
  const adelantoPendienteTotal = adelantosDelAgente.reduce((s, a) => s + (Number(a.amount) - Number(a.consumed)), 0);

  function elegirAgente(id: string) {
    setAgentId(id);
    invalidarPreview();
    const agente = agentes.find((a) => a.id === id);
    if (agente?.account_type === "BANCADO" && rebatePct === "0") {
      setRebatePct("50"); // default razonable: reparto 50/50 de la mesa, ajustable
    }
    // (29/09/2026, pedido de Leo: "recorda de poner lo que se esta liquidando si es prepago o
    // win/lose al momento de empezar el cierre") -- antes el selector de Sistema arrancaba
    // siempre en Win/Lose sin importar el agente elegido, y quedaba en manos de quien carga el
    // cierre acordarse de revisarlo/cambiarlo a mano -- ahora se autocompleta con el sistema
    // REGISTRADO para ese agente (default_system, ver Agentes) apenas se lo elige. Ahora que
    // WIN_LOSE también manda todo a rakeback pendiente en vez de tocar el balance directo (ver
    // repo/closings.ts), elegir mal el sistema acá tiene consecuencias reales -- sigue siendo
    // editable por si hace falta una excepción puntual, pero el punto de partida es el correcto.
    if (agente?.default_system) {
      setSystem(agente.default_system);
    }
    const suyos = todosDeals.filter((d) => d.agent_id === id);
    if (!clubId && suyos.length === 1) elegirClub(suyos[0].club_id);
  }

  function elegirClub(id: string) {
    setClubId(id);
    invalidarPreview();
    setCotizacionMsg(null);
    const club = clubes.find((c) => c.id === id);
    // Precarga la tasa del club (ej. 1,20 para X-Poker) pero queda editable — si esta semana
    // cambió, se pisa acá sin tener que ir a Configuración → Clubes primero.
    if (club?.unit === "FICHAS") setValorFicha(String(club.current_rate ?? 1));
  }

  // PRUEBA solo para Tiny (nombre real hoy: "Tiny GG") -- todavía no hay una fuente en vivo
  // conectada para X-Poker.
  const esTiny = /tiny/i.test(clubSeleccionado?.name ?? "");

  async function traerCotizacionEnVivo() {
    setCotizando(true);
    setCotizacionMsg(null);
    try {
      const r = await api.cotizacionUsdtTwd();
      setValorFicha(String(r.rate));
      invalidarPreview();
      setCotizacionMsg({ ok: true, text: `USDT/TWD ${r.rate} (MAX, recién actualizado) -- lo podés pisar si hace falta.` });
    } catch (err: any) {
      setCotizacionMsg({ ok: false, text: err.message || "No se pudo traer la cotización en vivo." });
    } finally {
      setCotizando(false);
    }
  }

  // Se llama en cada cambio de campo: solo invalida la CLAVE de la vista previa (deja de estar
  // "vigente"), pero no borra el resultado anterior — así se puede seguir mostrando el badge
  // "cambiaste algo, recalculá" en vez de que la vista previa desaparezca sin explicación.
  function invalidarPreview() {
    setPreviewKey(null);
    setPreviewError(null);
  }

  // Reset completo: para cuando se recalcula desde cero o se aplicó el cierre.
  function limpiarPreview() {
    setPreviewKey(null);
    setPreviewResult(null);
    setPreviewError(null);
  }

  function armarPayload() {
    // Clubes en fichas (X-Poker): "result"/"rakeTotal" del formulario son fichas crudas del
    // reporte — el motor de cierre siempre espera USD, así que se convierten acá, una sola vez,
    // con la tasa que se cargó arriba (editable por si cambió esta semana). Para cualquier otro
    // club, tasa = 1 y no cambia nada.
    const tasa = esFichas ? Number(valorFicha) || 1 : 1;
    return {
      agentId,
      clubId,
      weekStart,
      weekEnd,
      system,
      result: (Number(result) || 0) * tasa,
      rakeTotal: (Number(rakeTotal) || 0) * tasa,
      rakebackPct: (Number(rakebackPct) || 0) / 100,
      rebatePct: (Number(rebatePct) || 0) / 100,
      rodeoManual: Number(rodeoManual) || 0,
      ajusteManual: Number(ajusteManual) || 0,
      ajusteManualNota: ajusteManualNota.trim() || undefined,
      observation: observation.trim() || undefined,
      rateSnapshot: esFichas ? tasa : undefined,
    };
  }

  // Si hay ajuste manual cargado, la nota es obligatoria (para que quede rastreable en el
  // historial) — bloquea tanto la vista previa como el aplicar, igual que los demas requisitos.
  const ajusteManualSinNota = (Number(ajusteManual) || 0) !== 0 && !ajusteManualNota.trim();

  const claveActual = JSON.stringify(armarPayload());
  // Vista previa vigente = se calculó con exactamente los valores que hay cargados ahora.
  const previewVigente = previewKey === claveActual;

  async function calcularVistaPrevia() {
    if (!agentId || !clubId || !weekStart || !weekEnd) {
      setPreviewError("Agente, club y fechas de la semana son obligatorios.");
      return;
    }
    if (ajusteManualSinNota) {
      setPreviewError("Cargaste un ajuste manual: la nota (motivo) es obligatoria.");
      return;
    }
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewResult(null);
    const clave = claveActual;
    try {
      const r = await api.previsualizarCierre(armarPayload());
      if (r.alreadyApplied) {
        setPreviewError("Ya existe un cierre aplicado para ese agente+club+semana. No se puede volver a aplicar (BIT-001).");
      } else {
        setPreviewResult(r);
        setPreviewKey(clave);
      }
    } catch (err: any) {
      setPreviewError(err.message || "No se pudo calcular la vista previa — esto mismo bloquearía el cierre si lo intentaras aplicar.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!previewVigente || !previewResult) {
      setMsg({ ok: false, text: "Calculá la vista previa primero (o volvé a calcularla si cambiaste algún campo) antes de aplicar." });
      return;
    }
    setLoading(true);
    try {
      const r = await api.aplicarCierre(armarPayload());
      if (r.alreadyApplied) {
        setMsg({ ok: false, text: "Ya existe un cierre aplicado para ese agente+club+semana. No se duplicó nada (BIT-001)." });
      } else if (r.bancado) {
        setMsg({
          ok: true,
          text: `Cierre aplicado. Acreditado al bancado: ${usd(r.calc?.finalClosing ?? 0)}. Ganancia DigiPlayers (fichas en el club): ${usd(r.calc?.digiplayersShare ?? 0)}. Memoria: ${usd(r.calc?.deudaAnterior ?? 0)} → ${usd(r.calc?.deudaNueva ?? 0)}.`,
        });
        setResult("");
        setObservation("");
        limpiarPreview();
        onApplied();
      } else {
        setMsg({ ok: true, text: `Cierre aplicado. Cierre final: ${usd(r.calc?.finalClosing ?? 0)}` });
        setResult("");
        setObservation("");
        limpiarPreview();
        onApplied();
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err.message || "No se pudo aplicar el cierre." });
      limpiarPreview(); // si el servidor lo rechazó igual, la vista previa ya no vale — recalcular
    } finally {
      setLoading(false);
    }
  }

  // Mockup 95 (13/11/2026, pedido de Leo: "quedó bastante feo"): formulario en 4 pasos numerados, extras plegados y un resumen fijo a
  // la derecha con la vista previa real y los botones.
  const semanaElegida = (s: { desde: string; hasta: string }) => weekStart === s.desde && weekEnd === s.hasta;
  const pasada = semanaRelativa(-1);
  const actual = semanaRelativa(0);
  function usarSemana(s: { desde: string; hasta: string }) {
    setWeekStart(s.desde);
    setWeekEnd(s.hasta);
    invalidarPreview();
  }
  const hayExtras = (Number(rodeoManual) || 0) !== 0 || (Number(ajusteManual) || 0) !== 0 || !!observation.trim();
  const extrasVisibles = extrasAbiertos || hayExtras;
  const calc = previewVigente && previewResult ? previewResult.calc : null;
  const nombreSistema = (s: string) => (s === "PREPAGO" ? "Prepago" : "Win/Lose");

  return (
    <div className="cm-lay">
      <div className="panel cm-form">
        {adelantosDelAgente.length > 0 && (
          <div className="warning" style={{ margin: "14px 0 4px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span>
              ⚠ {agenteSeleccionado?.name} tiene {adelantosDelAgente.length === 1 ? "un adelanto de rakeback activo" : `${adelantosDelAgente.length} adelantos de rakeback activos`} (en cualquier club): pendiente{" "}
              <strong>{usd(adelantoPendienteTotal)}</strong> en total
              {adelantosDelAgente.length > 1 && (
                <>
                  {" "}({adelantosDelAgente.map((a, i) => (
                    <span key={a.id}>
                      {i > 0 && ", "}
                      {usd(Number(a.amount) - Number(a.consumed))}{a.club_origen_name ? ` (${a.club_origen_name})` : ""}
                    </span>
                  ))})
                </>
              )}
              . Este cierre se va a pagar completo — si corresponde descontar parte del rakeback contra algún adelanto, hacelo a mano después en Adelantos.
            </span>
            <button type="button" className="btn secondary small" onClick={() => nav("/dashboard/movimientos")}>
              Ir a Adelantos
            </button>
          </div>
        )}

        <form id="cm-nuevo-cierre" onSubmit={onSubmit}>
          <section className="cm-sec">
            <div className="cm-sh">
              <span className="cm-n">1</span>
              <b>Agente y club</b>
              <Ayuda>{esBancado
                ? "Cuenta tipo Bancado: la mesa se reparte 50/50 (ajustable) y el rakeback es 100% del bancado — si viene con memoria pendiente, se descuenta antes de acreditarle nada."
                : "Se calcula con el mismo motor que valida las reglas especiales (ej. Manzur 75% rake) y se aplica como un movimiento más en el sistema."}</Ayuda>
            </div>
            <div className="cm-g3">
              <div className="field">
                <label>Agente</label>
                <select value={agentId} onChange={(e) => elegirAgente(e.target.value)}>
                  <option value="">Elegir...</option>
                  {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Club</label>
                <select value={clubId} onChange={(e) => elegirClub(e.target.value)} className={conDeal ? "cd-in-deal" : undefined}>
                  <option value="">Elegir...</option>
                  {agentId && dealsDelAgente.length > 0 ? (
                    <>
                      <optgroup label="Con deal cargado">
                        {clubes
                          .filter((c) => dealsDelAgente.some((d) => d.club_id === c.id))
                          .map((c) => {
                            const d = dealsDelAgente.find((x) => x.club_id === c.id);
                            return (
                              <option key={c.id} value={c.id}>
                                {c.name} — {pctTexto(d.rakeback_pct)}% · {nombreSistema(d.system)}
                              </option>
                            );
                          })}
                      </optgroup>
                      {clubes.some((c) => !dealsDelAgente.some((d) => d.club_id === c.id)) && (
                        <optgroup label="Sin deal (se carga a mano)">
                          {clubes.filter((c) => !dealsDelAgente.some((d) => d.club_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </optgroup>
                      )}
                    </>
                  ) : (
                    clubes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                  )}
                </select>
              </div>
              <div className="field">
                <label>Sistema</label>
                <select value={system} onChange={(e) => { setSystem(e.target.value as any); invalidarPreview(); }} className={conDeal && deal.system === system ? "cd-in-deal" : undefined}>
                  <option value="WIN_LOSE">Win/Lose</option>
                  <option value="PREPAGO">Prepago</option>
                </select>
                {conDeal && deal.system !== system && (
                  <div className="cd-hint warn">⚠ El deal dice {nombreSistema(deal.system)}. Estás usando {nombreSistema(system)} solo en este cierre.</div>
                )}
                {/* (29/09/2026, pedido de Leo) -- sin deal, se compara con el sistema registrado del agente (ver repo/closings.ts). */}
                {!conDeal && agenteSeleccionado?.default_system && agenteSeleccionado.default_system !== system && (
                  <div className="cd-hint warn">
                    ⚠ {agenteSeleccionado.name} está registrado como {nombreSistema(agenteSeleccionado.default_system)} y lo estás por liquidar como {nombreSistema(system)}.
                  </div>
                )}
              </div>
            </div>
            {agentId && clubId && deal && !dealCargando && (conDeal ? (
              <div className="cm-deal ok">
                <b>✓ Deal de Administración</b>
                <span>
                  {nombreSistema(deal.system)} · {pctTexto(deal.rakebackPct)}% rakeback · {pctTexto(deal.rebatePct)}% rebate
                  {deal.validFrom ? ` · rige desde el ${dateShort(String(deal.validFrom).slice(0, 10))}` : ""}
                  {weekEnd ? "" : " · elegí la semana para ver el de esa fecha"}
                </span>
              </div>
            ) : (
              <div className="cm-deal warn">
                <b>! Sin deal en {clubSeleccionado?.name}</b>
                <span>Cargá el % a mano. Para que se complete solo, cargalo en Administración → Asignar % a agente.</span>
              </div>
            ))}
          </section>

          <section className="cm-sec">
            <div className="cm-sh"><span className="cm-n">2</span><b>Semana</b></div>
            <div className="cm-semana">
              <button type="button" className={`cm-q ${semanaElegida(pasada) ? "on" : ""}`} onClick={() => usarSemana(pasada)}>Semana pasada</button>
              <button type="button" className={`cm-q ${semanaElegida(actual) ? "on" : ""}`} onClick={() => usarSemana(actual)}>Esta semana</button>
              <div className="field">
                <label>Desde</label>
                <input
                  value={weekStart}
                  onChange={(e) => {
                    setWeekStart(e.target.value);
                    invalidarPreview();
                    if (e.target.value && !weekEnd) {
                      const monday = mondayOf(e.target.value);
                      const sunday = new Date(monday);
                      sunday.setDate(sunday.getDate() + 6);
                      setWeekEnd(sunday.toISOString().slice(0, 10));
                    }
                  }}
                  type="date"
                />
              </div>
              <div className="field">
                <label>Hasta</label>
                <input value={weekEnd} onChange={(e) => { setWeekEnd(e.target.value); invalidarPreview(); }} type="date" />
              </div>
            </div>
          </section>

          <section className="cm-sec">
            <div className="cm-sh"><span className="cm-n">3</span><b>Números de la semana</b><small>{esFichas ? "en fichas" : "en USD"}</small></div>
            <div className="cm-g4">
              <div className="field">
                <label>{esBancado ? "Resultado en la mesa" : "Resultado (win/lose)"}</label>
                <input value={result} onChange={(e) => { setResult(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>Rake total</label>
                <input value={rakeTotal} onChange={(e) => { setRakeTotal(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>{esBancado ? "% Rakeback (bancado)" : "% Rakeback"}</label>
                <input value={rakebackPct} onChange={(e) => { setRakebackPct(e.target.value); invalidarPreview(); }} type="number" step="0.01" className={conDeal ? (difiereRakeback ? "cd-in-edit" : "cd-in-deal") : undefined} />
                {difiereRakeback && <div className="cd-hint warn">⚠ El deal dice {pctTexto(deal.rakebackPct)}%. Solo en este cierre.</div>}
              </div>
              <div className="field">
                <label>{esBancado ? "% mesa para el bancado" : "% Rebate"}</label>
                <input value={rebatePct} onChange={(e) => { setRebatePct(e.target.value); invalidarPreview(); }} type="number" step="0.01" className={conDeal ? (difiereRebate ? "cd-in-edit" : "cd-in-deal") : undefined} />
                {difiereRebate && <div className="cd-hint warn">⚠ El deal dice {pctTexto(deal.rebatePct)}%. Solo en este cierre.</div>}
              </div>
            </div>
            {esFichas && (
              <div className="cm-fichas">
                <div className="field">
                  <label>Valor de la ficha (USD)</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input value={valorFicha} onChange={(e) => { setValorFicha(e.target.value); invalidarPreview(); }} type="number" step="0.01" style={{ flex: 1 }} />
                    {esTiny && (
                      <button type="button" className="btn secondary small" disabled={cotizando} onClick={traerCotizacionEnVivo} title="Traer la cotización USDT/TWD en vivo de MAX (max.maicoin.com)">
                        {cotizando ? "..." : "🔄 En vivo"}
                      </button>
                    )}
                  </div>
                </div>
                <span className="muted">
                  = {usd((Number(result) || 0) * (Number(valorFicha) || 0))} win/lose · {usd((Number(rakeTotal) || 0) * (Number(valorFicha) || 0))} rake
                </span>
                {cotizacionMsg && <div className={cotizacionMsg.ok ? "success" : "error"} style={{ fontSize: 12, padding: "6px 9px" }}>{cotizacionMsg.text}</div>}
              </div>
            )}
          </section>

          <section className="cm-sec">
            <button type="button" className="cm-extras" onClick={() => setExtrasAbiertos((v) => !v)} aria-expanded={extrasVisibles}>
              <span className="cm-tg">{extrasVisibles ? "▾" : "▸"} Extras (opcional)</span>
              <span className="cm-s">
                {hayExtras
                  ? [
                      (Number(rodeoManual) || 0) !== 0 && `Rodeo ${usd(Number(rodeoManual))}`,
                      (Number(ajusteManual) || 0) !== 0 && `Ajuste ${usd(Number(ajusteManual))}`,
                      observation.trim() && "Con observación",
                    ].filter(Boolean).join(" · ")
                  : "Rodeo · Ajuste manual · Observación — sin cargar"}
              </span>
            </button>
            {extrasVisibles && (
              <div className="cm-g3" style={{ marginTop: 12 }}>
                <div className="field">
                  <label>Rodeo (USD) <Ayuda>Solo si este club paga Rodeo (SupremaPoker) y este cierre no viene de una importación de archivo — se suma directo, sin memoria automática.</Ayuda></label>
                  <input value={rodeoManual} onChange={(e) => { setRodeoManual(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
                </div>
                <div className="field">
                  <label>Ajuste manual (USD) <Ayuda>Monto libre que se suma (o resta, si es negativo) directo al cierre final del agente — ej. tickets promocionales asignados a mano. Requiere nota.</Ayuda></label>
                  <input value={ajusteManual} onChange={(e) => { setAjusteManual(e.target.value); invalidarPreview(); }} type="number" step="0.01" />
                </div>
                {Number(ajusteManual) !== 0 && (
                  <div className="field">
                    <label>Nota del ajuste (obligatoria)</label>
                    <input value={ajusteManualNota} onChange={(e) => { setAjusteManualNota(e.target.value); invalidarPreview(); }} placeholder="Ej: ticket promocional torneo X" />
                  </div>
                )}
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label>Observación</label>
                  <input value={observation} onChange={(e) => setObservation(e.target.value)} />
                </div>
              </div>
            )}
          </section>
        </form>
      </div>

      <aside className="panel cm-res">
        <h3>Resumen del cierre</h3>
        <div className="cm-who">
          {agenteSeleccionado || clubSeleccionado || weekStart
            ? [agenteSeleccionado?.name, clubSeleccionado?.name, weekStart && weekEnd ? `${dateShort(weekStart)} – ${dateShort(weekEnd)}` : null].filter(Boolean).join(" · ")
            : "Elegí agente, club y semana"}
        </div>
        <div className="cm-liq">Se liquida como <b>{nombreSistema(system)}</b></div>

        {esBancado ? (
          <div className="cm-rl">
            <div className="cm-r"><span>Ganancia DigiPlayers</span><b>{calc ? usd(calc.digiplayersShare) : "—"}</b></div>
            <div className="cm-r"><span>Memoria</span><b>{calc ? `${usd(calc.deudaAnterior)} → ${usd(calc.deudaNueva)}` : "—"}</b></div>
          </div>
        ) : (
          <div className="cm-rl">
            <div className="cm-r"><span>Rakeback {rakebackPct || 0}%</span><b>{calc ? usd(calc.rakeback) : "—"}</b></div>
            <div className="cm-r"><span>Rebate {rebatePct || 0}%</span><b>{calc ? usd(calc.rebate) : "—"}</b></div>
            {calc?.rodeo != null && Number(calc.rodeo) !== 0 && <div className="cm-r"><span>Rodeo</span><b>{usd(calc.rodeo)}</b></div>}
            {(Number(ajusteManual) || 0) !== 0 && <div className="cm-r"><span>Ajuste manual</span><b>{usd(Number(ajusteManual))}</b></div>}
          </div>
        )}
        <div className="cm-tot">
          <span>{esBancado ? "SE ACREDITA" : "CIERRE FINAL"}</span>
          <b className={calc ? (Number(calc.finalClosing) >= 0 ? "pos" : "neg") : ""}>{calc ? usd(calc.finalClosing) : "—"}</b>
        </div>

        {calc && (calc.ruleApplied || previewResult.supervisorAgentId || previewResult.routedToPartnerAccountName) && (
          <div className="cm-notas">
            {calc.ruleApplied && <div>Regla especial aplicada: <span className="badge neutral">{calc.ruleApplied}</span></div>}
            {previewResult.supervisorAgentId && <div>El rebate ({usd(calc.rebate)}) va al rakeback centralizado del supervisor, no al saldo de este agente.</div>}
            {previewResult.routedToPartnerAccountName && (
              <div>Es una identidad de socio: se acredita {usd(-Number(calc.finalClosing))} en la cuenta "{previewResult.routedToPartnerAccountName}" (Cuentas de socios).</div>
            )}
          </div>
        )}

        <div className="cm-st">
          <i className={previewVigente ? "ok" : ""} />
          {previewVigente
            ? "Vista previa real, calculada contra la base. Si cambiás un campo, se vuelve a pedir."
            : previewResult
            ? "Cambiaste algo: recalculá la vista previa."
            : "Calculá la vista previa (no guarda nada) para poder aplicar."}
        </div>
        {previewError && <div className="error" style={{ marginTop: 10 }}>⚠ {previewError}</div>}
        {msg && <div className={msg.ok ? "success" : "error"} style={{ marginTop: 10 }}>{msg.text}</div>}
        <div className="cm-bs">
          <button type="button" className="btn secondary" disabled={previewLoading} onClick={calcularVistaPrevia}>
            {previewLoading ? "Calculando..." : previewResult ? "Recalcular vista previa" : "Calcular vista previa"}
          </button>
          <button type="submit" form="cm-nuevo-cierre" className="btn" disabled={loading || !previewVigente || !previewResult} title={!previewVigente ? "Calculá la vista previa primero" : undefined}>
            {loading ? "Aplicando..." : "Aplicar cierre"}
          </button>
        </div>
      </aside>
    </div>
  );
}

type FilaImport = {
  key: string; // clubId|agentId
  clubId: string;
  clubName: string;
  agentId: string;
  agentName: string;
  jugadores: number;
  resultado: number;
  rakeTotal: number;
  ringGame?: number;
  mtt?: number;
  sngOtros?: number;
  spin?: number;
  // Solo Tiny GG (18/09/2026): informativo, se guarda junto al cierre pero no afecta el pago.
  bbjContribution?: number;
  system: "PREPAGO" | "WIN_LOSE";
  rakebackPct: number;
  rebatePct: number;
  configSource: "deal" | "sin_configurar";
  // "Rodeo" (solo SupremaPoker): lista cruda por jugador — el monto real que le toca al
  // agente sale recién del preview/apply (procesarRodeoAgenteTx aplica la memoria por jugador).
  rodeoJugadores: { playerExternalId: string; baseRodeo: number }[];
  // Detalle por jugador (23/09/2026, "Resumen por agente" en PDF) — se reenvía tal cual al
  // aplicar, para que el backend persista el desglose (repo/closings.ts).
  jugadoresDetalle: {
    playerId: string;
    playerExternalId: string;
    playerName: string;
    resultado: number;
    rake: number;
    subagenteName: string | null;
    subagenteRakebackPct: number | null;
  }[];
  // Ajuste manual ("tickets promocionales", 18/09/2026): monto libre en USD cargado a mano fila
  // por fila en esta misma grilla — se suma/resta directo al cierre final del agente (ver
  // engine/cierre.ts). ajusteManualNota es obligatoria si el monto no es 0.
  ajusteManual: string;
  ajusteManualNota: string;
  included: boolean;
  previewLoading: boolean;
  previewResult: any | null;
  previewError: string | null;
  applyLoading: boolean;
  applyResult: any | null;
  applyError: string | null;
};

// Importador de cierres (hoy: formato SupremaPoker, hojas Fénix/TeamBack — ver Clubes →
// Configurar → "Hoja de importación" para vincular cada club a su hoja). Nunca inventa el %
// de rakeback: siempre usa la configuración ya cargada en Agentes/Clubes. Reutiliza el mismo
// motor de vista previa/aplicar que el formulario manual, fila por fila, así nunca puede dar
// un número distinto al que se aplicaría cargando el cierre a mano.
function ImportarCierre({ agentes, onDone }: { agentes: any[]; onDone: () => void }) {
  const { alertDialog } = useConfirmDialog();
  const [file, setFile] = useState<File | null>(null);
  // Tiny GG: cada super agente baja su propio archivo — se suben varios juntos, a diferencia de
  // "file" (SUPREMA/GG) que es un solo .xlsx con varias hojas adentro.
  const [tinyFiles, setTinyFiles] = useState<File[]>([]);
  // Tiny GG: los números que trae el reporte de la plataforma NO están en USD (son una unidad
  // propia de Tiny/GG, plata china en la práctica) — hay que dividirlos por la tasa de ESA
  // semana para llegar a USD (confirmado por el usuario: reporte real 31/08-06/09/2026, tasa
  // 31,78). La tasa cambia semana a semana, así que se pide acá, editable, nunca hardcodeada —
  // se aplica una sola vez, al armar las filas de la previa (ver confirmarClubesYProcesar), y de
  // ahí en más todo el resto del flujo (previsualizar/aplicar) ya trabaja en USD como cualquier
  // otro club.
  const [tinyRate, setTinyRate] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [analizando, setAnalizando] = useState(false);
  const [analisisError, setAnalisisError] = useState<string | null>(null);
  const [hojasFormatoInvalido, setHojasFormatoInvalido] = useState<{ sheetName: string; motivo: string }[]>([]);
  // Una fila por cada hoja del archivo con formato válido — el club es SIEMPRE una elección
  // explícita del usuario, sin ningún auto-match ni precarga por nombre de hoja (se sacó: dos
  // clubes reales pueden compartir el mismo nombre de pestaña entre semanas, y guardar esa
  // asociación como default mezcló datos de un club con los de otro).
  const [hojasDetectadas, setHojasDetectadas] = useState<{ sheetName: string; clubIdSugerido: string | null }[]>([]);
  const [clubElegidoPorHoja, setClubElegidoPorHoja] = useState<Record<string, string>>({}); // sheetName -> clubId
  const [hojaIgnorada, setHojaIgnorada] = useState<Record<string, boolean>>({}); // sheetName -> se saltea esta semana
  // Subagentes por jugador (23/09/2026, pedido de Leo): poder elegir el % de rakeback propio de
  // un jugador ACÁ MISMO, al momento de armar el cierre, sin tener que ir a Agentes. Guarda
  // directo contra el jugador (api.setSubagenteJugador) -- independiente de aplicar el cierre.
  const [subagenteModalFila, setSubagenteModalFila] = useState<string | null>(null); // fila.key
  const [subagenteNombre, setSubagenteNombre] = useState("");
  const [subagentePct, setSubagentePct] = useState("");
  const [editandoSubagentePlayerId, setEditandoSubagentePlayerId] = useState<string | null>(null);
  const [guardandoSubagente, setGuardandoSubagente] = useState(false);
  const [errorSubagente, setErrorSubagente] = useState("");

  const [confirmado, setConfirmado] = useState(false); // true = ya se eligió club para cada hoja y se procesó
  const [sinAgentePorClub, setSinAgentePorClub] = useState<{ clubId: string; clubName: string; items: any[] }[]>([]);
  // Superagentes que no existían en el catálogo y se crearon SOLOS en esta corrida porque el
  // archivo traía su nombre (ver repo/imports.ts::resolvePlayerAgent). Se muestra para que quede
  // claro que no fue "magia" — si algún nombre es en realidad un typo de un agente que ya
  // existía, se corrige a mano desde el Árbol de clubes (mover jugadores / eliminar el duplicado).
  const [agentesAutoCreados, setAgentesAutoCreados] = useState<{ agentId: string; agentName: string; agentIdRaw: string | null }[]>([]);
  // Jugadores marcados como "bancados" (pantalla Jugadores bancados) que aparecieron en el
  // archivo — se omiten del agregado del agente (ver repo/imports.ts) y se informan acá para
  // que el total que quedó afuera del cierre no desaparezca en silencio.
  const [bancadosPorClub, setBancadosPorClub] = useState<{ clubId: string; clubName: string; items: any[] }[]>([]);
  // Rebate Unión de Tiny (18/09/2026, pedido de Leo): lo que Tiny/la Unión nos reconoce a
  // NOSOTROS (nunca a los agentes) — un cálculo aparte del rebate por agente, a nivel de todo
  // el super agente. Solo se llena para plataforma TINY (ver repo/importsTinyGG.ts).
  const [tinyRebateUnionPorClub, setTinyRebateUnionPorClub] = useState<
    { clubId: string; clubName: string; items: any[] }[]
  >([]);
  // Version SIN dividir por la tasa (moneda propia de Tiny) -- es lo que se guarda al aplicar
  // (ver aplicarTodo), nunca la version de arriba que ya esta convertida a USD para mostrar.
  const [tinyRebateUnionRawPorClub, setTinyRebateUnionRawPorClub] = useState<
    { clubId: string; weekEnd: string; items: any[] }[]
  >([]);
  const [filas, setFilas] = useState<FilaImport[]>([]);
  const [asignando, setAsignando] = useState<Record<string, string>>({}); // playerId|clubId -> agentId elegido
  const [guardandoAsignacion, setGuardandoAsignacion] = useState<string | null>(null);
  const [previsualizandoTodo, setPrevisualizandoTodo] = useState(false);
  const [aplicandoTodo, setAplicandoTodo] = useState(false);
  const [resumenAplicacion, setResumenAplicacion] = useState<string | null>(null);
  // Clubes elegibles para el selector de esta hoja — TODOS los clubes activos, nunca filtrados
  // (la plataforma no bloquea nada, ver repo/imports.ts).
  const [clubesSuprema, setClubesSuprema] = useState<{ id: string; name: string }[]>([]);
  // Plataforma elegida arriba (pestañas) — SUPREMA y GG ya tienen parser propio; X-Poker
  // todavía muestra un aviso de "todavía no soportado" en vez del importador.
  const [plataforma, setPlataforma] = useState<"SUPREMA" | "GG" | "TINY" | "XPOKER">("SUPREMA");
  const [filtroFilas, setFiltroFilas] = useState<"todos" | "sindeal" | "extras">("todos");
  const [ajusteAbierto, setAjusteAbierto] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Misma lista de "todos los clubes activos" para cualquier plataforma (ver nota en
    // repo/imports.ts sobre por qué nunca se filtra por plataforma acá) — se vuelve a pedir al
    // cambiar de pestaña solo por si se creó un club nuevo mientras tanto.
    const fetchClubes =
      plataforma === "GG"
        ? api.clubesImportacionTeamBackGG()
        : plataforma === "TINY"
        ? api.clubesImportacionTinyGG()
        : api.clubesImportacionSuprema();
    fetchClubes.then(setClubesSuprema).catch(() => setClubesSuprema([]));
  }, [plataforma]);

  // Paso 1: solo lee el archivo y arma la lista de hojas con formato válido (con una sugerencia
  // de club si el nombre matchea algo ya configurado). Todavía no calcula nada por agente — eso
  // recién pasa cuando se confirma a qué club corresponde cada hoja (paso 2).
  async function analizar() {
    if (plataforma === "TINY") {
      if (tinyFiles.length === 0) { setAnalisisError("Elegí uno o más archivos primero."); return; }
      if (!(Number(tinyRate) > 0)) { setAnalisisError("Cargá la tasa de esta semana (fichas por USD) antes de analizar."); return; }
    } else if (!file) {
      setAnalisisError("Elegí un archivo primero.");
      return;
    }
    if (!weekStart || !weekEnd) { setAnalisisError("Completá semana desde/hasta antes de analizar."); return; }
    setAnalizando(true);
    setAnalisisError(null);
    setResumenAplicacion(null);
    setConfirmado(false);
    setFilas([]);
    setSinAgentePorClub([]);
    setAgentesAutoCreados([]);
    setHojaIgnorada({});
    try {
      const r =
        plataforma === "GG"
          ? await api.previsualizarImportacionTeamBackGG(file!, weekEnd)
          : plataforma === "TINY"
          ? await api.previsualizarImportacionTinyGG(tinyFiles, weekEnd)
          : await api.previsualizarImportacion(file!, weekEnd);
      setHojasFormatoInvalido((r.hojasNoReconocidas || []).filter((h: any) => !h.resolvable));
      const sugerencias: Record<string, string> = {};
      const detectadas: { sheetName: string; clubIdSugerido: string | null }[] = [];
      for (const club of r.clubes || []) {
        detectadas.push({ sheetName: club.sheetName, clubIdSugerido: club.clubId });
        sugerencias[club.sheetName] = club.clubId;
      }
      for (const h of (r.hojasNoReconocidas || []).filter((h: any) => h.resolvable)) {
        detectadas.push({ sheetName: h.sheetName, clubIdSugerido: null });
      }
      setHojasDetectadas(detectadas);
      setClubElegidoPorHoja(sugerencias);
    } catch (err: any) {
      setAnalisisError(err.message || "No se pudo leer el archivo.");
    } finally {
      setAnalizando(false);
    }
  }

  // Paso 2: con el club ya elegido para cada hoja (sugerido o cambiado a mano), vuelve a mandar
  // el mismo archivo con esa elección explícita — el backend la usa siempre, sin importar si el
  // nombre de la hoja coincide o no con algo configurado.
  async function confirmarClubesYProcesar() {
    if (plataforma === "TINY" ? tinyFiles.length === 0 : !file) return;
    setAnalizando(true);
    setAnalisisError(null);
    try {
      const hojasAProcesar = hojasDetectadas.filter((h) => !hojaIgnorada[h.sheetName]);
      const overrides: Record<string, string> = {};
      for (const h of hojasAProcesar) {
        if (clubElegidoPorHoja[h.sheetName]) overrides[h.sheetName] = clubElegidoPorHoja[h.sheetName];
      }
      const ignoradas = hojasDetectadas.filter((h) => hojaIgnorada[h.sheetName]).map((h) => h.sheetName);
      const r =
        plataforma === "GG"
          ? await api.previsualizarImportacionTeamBackGG(file!, weekEnd, overrides, ignoradas)
          : plataforma === "TINY"
          ? await api.previsualizarImportacionTinyGG(tinyFiles, weekEnd, overrides, ignoradas)
          : await api.previsualizarImportacion(file!, weekEnd, overrides, ignoradas);
      setConfirmado(true);
      setSinAgentePorClub(
        (r.clubes || [])
          .filter((c: any) => c.sinAgente?.length > 0)
          .map((c: any) => ({ clubId: c.clubId, clubName: c.clubName, items: c.sinAgente }))
      );
      setBancadosPorClub(
        (r.clubes || [])
          .filter((c: any) => c.bancados?.length > 0)
          .map((c: any) => ({ clubId: c.clubId, clubName: c.clubName, items: c.bancados }))
      );
      setAgentesAutoCreados(r.agentesAutoCreados || []);
      // Tiny GG: acá es donde se convierte fichas -> USD, una sola vez, dividiendo por la tasa
      // de esta semana (ver estado tinyRate más arriba). Para cualquier otra plataforma, tasa=1
      // y no cambia nada.
      const tasa = plataforma === "TINY" ? Number(tinyRate) || 1 : 1;
      const nuevasFilas: FilaImport[] = [];
      for (const club of r.clubes || []) {
        for (const a of club.agentes) {
          nuevasFilas.push({
            key: `${club.clubId}|${a.agentId}`,
            clubId: club.clubId,
            clubName: club.clubName,
            agentId: a.agentId,
            agentName: a.agentName,
            jugadores: a.jugadores,
            resultado: Math.round((a.resultado / tasa) * 100) / 100,
            rakeTotal: Math.round((a.rakeTotal / tasa) * 100) / 100,
            ringGame: a.ringGame !== undefined ? Math.round((a.ringGame / tasa) * 100) / 100 : undefined,
            mtt: a.mtt !== undefined ? Math.round((a.mtt / tasa) * 100) / 100 : undefined,
            sngOtros: a.sngOtros !== undefined ? Math.round((a.sngOtros / tasa) * 100) / 100 : undefined,
            spin: a.spin !== undefined ? Math.round((a.spin / tasa) * 100) / 100 : undefined,
            bbjContribution: a.bbjContribution,
            system: a.system,
            rakebackPct: a.rakebackPct,
            rebatePct: a.rebatePct,
            configSource: a.configSource,
            rodeoJugadores: a.rodeoJugadores ?? [],
            jugadoresDetalle: a.jugadoresDetalle ?? [],
            ajusteManual: "0",
            ajusteManualNota: "",
            // CAMBIO (18/09/2026): ya no existe el % default de club — si no hay deal cargado
            // para este agente+club, arranca DESTILDADA (no entra en el lote a aplicar) para que
            // no se cuele un cierre en 0%/0% sin que nadie lo haya configurado a propósito. Leo
            // la sigue viendo en la tabla (con el badge "Sin configurar") para ir a cargarle el
            // deal y volver a calcular si corresponde.
            included: a.configSource === "deal",
            previewLoading: false,
            previewResult: null,
            previewError: null,
            applyLoading: false,
            applyResult: null,
            applyError: null,
          });
        }
      }
      nuevasFilas.sort((a, b) => a.clubName.localeCompare(b.clubName) || a.agentName.localeCompare(b.agentName));
      setFilas(nuevasFilas);

      // Rebate Unión de Tiny: convierte a USD con la misma tasa que el resto de esta corrida y
      // le suma, por club, la Σ del rebate que ya le vamos a pagar a CADA agente (rebatePct ×
      // (resultado + rakeTotal), la misma fórmula que aplica calcularCierre) — así se puede ver
      // de una si lo que Tiny nos reconoce alcanza para cubrir lo que salimos a pagar nosotros.
      if (plataforma === "TINY") {
        setTinyRebateUnionRawPorClub(
          (r.clubes || [])
            .filter((c: any) => (c.tinyRebateUnion?.length ?? 0) > 0)
            .map((c: any) => ({ clubId: c.clubId, weekEnd, items: c.tinyRebateUnion }))
        );
        const rebateAgentesPorClub = new Map<string, number>();
        for (const f of nuevasFilas) {
          const rebateFila = (f.resultado + f.rakeTotal) * f.rebatePct;
          rebateAgentesPorClub.set(f.clubId, (rebateAgentesPorClub.get(f.clubId) ?? 0) + rebateFila);
        }
        setTinyRebateUnionPorClub(
          (r.clubes || [])
            .filter((c: any) => (c.tinyRebateUnion?.length ?? 0) > 0)
            .map((c: any) => ({
              clubId: c.clubId,
              clubName: c.clubName,
              items: c.tinyRebateUnion.map((u: any) => ({
                ...u,
                rgPreRakeExclJp: u.rgPreRakeExclJp != null ? u.rgPreRakeExclJp / tasa : null,
                rebateUnionCalculado: u.rebateUnionCalculado / tasa,
                rebateUnionTiny: u.rebateUnionTiny != null ? u.rebateUnionTiny / tasa : null,
                rakeTotalRingGame: u.rakeTotalRingGame != null ? u.rakeTotalRingGame / tasa : null,
                rakeShare: u.rakeShare != null ? u.rakeShare / tasa : null,
              })),
              rebateAgentesTotal: rebateAgentesPorClub.get(c.clubId) ?? 0,
              baseAgentesTotal: nuevasFilas
                .filter((f) => f.clubId === c.clubId)
                .reduce((s, f) => s + f.resultado + f.rakeTotal, 0),
            }))
        );
      } else {
        setTinyRebateUnionPorClub([]);
        setTinyRebateUnionRawPorClub([]);
      }
    } catch (err: any) {
      setAnalisisError(err.message || "No se pudo procesar el archivo.");
    } finally {
      setAnalizando(false);
    }
  }

  async function asignarJugador(clubId: string, playerId: string) {
    const claveSel = `${clubId}|${playerId}`;
    const agentId = asignando[claveSel];
    if (!agentId) return;
    setGuardandoAsignacion(claveSel);
    try {
      await api.asignarAgenteImportado({ playerExternalId: playerId, clubId, agentId, reason: "Asignado manualmente desde el importador de cierres." });
      await confirmarClubesYProcesar(); // recalcula todo con la asignación ya guardada
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo guardar la asignación.");
    } finally {
      setGuardandoAsignacion(null);
    }
  }

  // Crea el agente que faltaba (un superagente nuevo del archivo, todavía no en el catálogo) y
  // reprocesa el archivo entero — no hace falta asignar jugador por jugador: al quedar creado
  // con su external_id, resolvePlayerAgent lo matchea solo para TODOS los jugadores que le
  // correspondan, no solo el que disparó el alta.
  const [creandoAgente, setCreandoAgente] = useState<string | null>(null);
  async function crearAgenteYReprocesar(agentIdRaw: string | null, agentNameRaw: string) {
    const clave = agentIdRaw ?? agentNameRaw;
    setCreandoAgente(clave);
    try {
      await api.crearAgenteImportado({ name: agentNameRaw, agentIdRaw });
      await confirmarClubesYProcesar();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo crear el agente.");
    } finally {
      setCreandoAgente(null);
    }
  }

  function toggleIncluded(key: string) {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, included: !f.included } : f)));
  }

  function abrirEdicionSubagente(playerId: string, actual: { subagenteName: string | null; subagenteRakebackPct: number | null }) {
    setEditandoSubagentePlayerId(playerId);
    setSubagenteNombre(actual.subagenteName ?? "");
    setSubagentePct(actual.subagenteRakebackPct != null ? String(actual.subagenteRakebackPct * 100) : "");
    setErrorSubagente("");
  }

  async function guardarSubagente(filaKey: string, playerId: string) {
    const nombre = subagenteNombre.trim();
    const pctNum = subagentePct.trim() ? Number(subagentePct) / 100 : null;
    if (nombre && (pctNum === null || !(pctNum >= 0 && pctNum <= 1))) {
      setErrorSubagente("El % de rakeback propio es obligatorio (0 a 100) si se pone un nombre de subagente.");
      return;
    }
    setGuardandoSubagente(true);
    setErrorSubagente("");
    try {
      const r = await api.setSubagenteJugador(playerId, nombre || null, pctNum);
      setFilas((fs) =>
        fs.map((f) =>
          f.key === filaKey
            ? {
                ...f,
                jugadoresDetalle: f.jugadoresDetalle.map((j) =>
                  j.playerId === playerId
                    ? { ...j, subagenteName: r.subagente_name, subagenteRakebackPct: r.subagente_rakeback_pct != null ? Number(r.subagente_rakeback_pct) : null }
                    : j
                ),
              }
            : f
        )
      );
      setEditandoSubagentePlayerId(null);
    } catch (err: any) {
      setErrorSubagente(err.message || "No se pudo guardar.");
    } finally {
      setGuardandoSubagente(false);
    }
  }

  // Cambiar el ajuste manual (o su nota) invalida la vista previa de esa fila -- si no, el
  // "Cierre final (vista previa)" se queda mostrando el numero viejo, calculado sin el ajuste,
  // hasta que alguien vuelva a tocar "Calcular vista previa de todos" sin darse cuenta de que
  // hace falta.
  function setAjusteManualFila(key: string, ajusteManual: string) {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ajusteManual, previewResult: null, previewError: null } : f)));
  }

  function setAjusteManualNotaFila(key: string, ajusteManualNota: string) {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ajusteManualNota, previewResult: null, previewError: null } : f)));
  }

  async function previsualizarTodo() {
    setPrevisualizandoTodo(true);
    setResumenAplicacion(null);
    setFilas((fs) => fs.map((f) => (f.included ? { ...f, previewLoading: true, previewError: null } : f)));
    const incluidas = filas.filter((f) => f.included);
    await Promise.all(
      incluidas.map(async (f) => {
        try {
          // Refresca el % vigente justo antes de calcular: si el deal se creó o editó DESPUÉS
          // de analizar el archivo (caso típico: subís el excel, ves que falta el %, lo cargás
          // en "Ver deals"/Árbol, y volvés acá a calcular), la fila traía el % viejo del momento
          // del análisis y nunca se actualizaba sola — quedaba en 0%/default para siempre hasta
          // resubir el excel entero. Ahora se vuelve a pedir la config vigente en cada cálculo.
          let { system, rakebackPct, rebatePct, configSource } = f;
          try {
            const cfg = await api.configVigente(f.agentId, f.clubId);
            system = cfg.system;
            rakebackPct = cfg.rakebackPct;
            rebatePct = cfg.rebatePct;
            configSource = cfg.source;
          } catch {
            // si falla el refresco, seguimos con lo que ya teníamos en la fila
          }
          const r = await api.previsualizarCierre({
            agentId: f.agentId,
            clubId: f.clubId,
            weekStart,
            weekEnd,
            system,
            result: f.resultado,
            rakeTotal: f.rakeTotal,
            rakebackPct,
            rebatePct,
            observation: `Importado de archivo (${weekStart} al ${weekEnd}).`,
            rodeoJugadores: f.rodeoJugadores.length > 0 ? f.rodeoJugadores : undefined,
            jugadoresDetalle: f.jugadoresDetalle.length > 0 ? f.jugadoresDetalle : undefined,
            rateSnapshot: plataforma === "TINY" ? Number(tinyRate) || undefined : undefined,
            jugadores: f.jugadores,
            ringGame: f.ringGame,
            mtt: f.mtt,
            sng: f.sngOtros,
            spin: f.spin,
            bbjContribution: f.bbjContribution,
            ajusteManual: Number(f.ajusteManual) || undefined,
            ajusteManualNota: f.ajusteManualNota.trim() || undefined,
          });
          setFilas((fs) =>
            fs.map((row) =>
              row.key === f.key
                ? {
                    ...row,
                    system,
                    rakebackPct,
                    rebatePct,
                    configSource,
                    previewLoading: false,
                    previewResult: r,
                    previewError: r.alreadyApplied ? "Ya existe un cierre aplicado para esta semana — no se va a duplicar." : null,
                  }
                : row
            )
          );
        } catch (err: any) {
          setFilas((fs) =>
            fs.map((row) => (row.key === f.key ? { ...row, previewLoading: false, previewError: err.message || "No se pudo calcular." } : row))
          );
        }
      })
    );
    setPrevisualizandoTodo(false);
  }

  const incluidas = filas.filter((f) => f.included);
  const todasPrevisualizadas = incluidas.length > 0 && incluidas.every((f) => f.previewResult && !f.previewError);
  // Nunca se aplica un lote con alguna fila sin deal cargado, aunque el usuario la haya
  // vuelto a tildar a mano — ver comentario de "included" más arriba.
  const hayIncluidasSinConfigurar = incluidas.some((f) => f.configSource !== "deal");
  const sinConfigurarCount = filas.filter((f) => f.configSource !== "deal").length;
  // Ajuste manual cargado sin nota: bloquea aplicar, igual que una fila sin deal — para que
  // quede rastreable en el historial por que se cargo cada ticket promocional.
  const hayIncluidasSinNotaAjuste = incluidas.some((f) => (Number(f.ajusteManual) || 0) !== 0 && !f.ajusteManualNota.trim());
  const totalCierreFinal = incluidas.reduce((sum, f) => sum + Number(f.previewResult?.calc?.finalClosing ?? 0), 0);

  async function aplicarTodo() {
    setAplicandoTodo(true);
    let ok = 0;
    let yaAplicados = 0;
    let errores = 0;
    for (const f of incluidas) {
      setFilas((fs) => fs.map((row) => (row.key === f.key ? { ...row, applyLoading: true } : row)));
      try {
        const r = await api.aplicarCierre({
          agentId: f.agentId,
          clubId: f.clubId,
          weekStart,
          weekEnd,
          system: f.system,
          result: f.resultado,
          rakeTotal: f.rakeTotal,
          rakebackPct: f.rakebackPct,
          rebatePct: f.rebatePct,
          observation: `Importado de archivo (${weekStart} al ${weekEnd}).`,
          rodeoJugadores: f.rodeoJugadores.length > 0 ? f.rodeoJugadores : undefined,
          jugadoresDetalle: f.jugadoresDetalle.length > 0 ? f.jugadoresDetalle : undefined,
          rateSnapshot: plataforma === "TINY" ? Number(tinyRate) || undefined : undefined,
          jugadores: f.jugadores,
          ringGame: f.ringGame,
          mtt: f.mtt,
          sng: f.sngOtros,
          spin: f.spin,
          bbjContribution: f.bbjContribution,
          ajusteManual: Number(f.ajusteManual) || undefined,
          ajusteManualNota: f.ajusteManualNota.trim() || undefined,
        });
        if (r.alreadyApplied) yaAplicados++; else ok++;
        setFilas((fs) => fs.map((row) => (row.key === f.key ? { ...row, applyLoading: false, applyResult: r } : row)));
      } catch (err: any) {
        errores++;
        setFilas((fs) => fs.map((row) => (row.key === f.key ? { ...row, applyLoading: false, applyError: err.message || "Error al aplicar." } : row)));
      }
    }
    // Rebate Union de Tiny (18/09/2026): se guarda UNA VEZ por club, recien aca (nunca en la
    // vista previa) -- reusa los mismos datos que ya se calcularon al analizar el archivo, asi
    // no hay que volver a leer ningun excel. Solo para los clubes que de verdad tuvieron algun
    // cierre aplicado en este lote (si el usuario destildo todo un club, no se guarda nada de
    // el). Si esto falla no se revierte nada de lo ya aplicado -- se avisa aparte.
    if (plataforma === "TINY" && tinyRebateUnionRawPorClub.length > 0) {
      const clubesConAlgunaFilaAplicada = new Set(incluidas.map((f) => f.clubId));
      const erroresGuardado: string[] = [];
      for (const grupo of tinyRebateUnionRawPorClub) {
        if (!clubesConAlgunaFilaAplicada.has(grupo.clubId)) continue;
        try {
          await api.guardarTinyRebateUnion({
            clubId: grupo.clubId,
            weekStart,
            weekEnd: grupo.weekEnd,
            items: grupo.items,
          });
        } catch (err: any) {
          erroresGuardado.push(err.message || "error desconocido");
        }
      }
      if (erroresGuardado.length > 0) {
        setResumenAplicacion(
          `Listo: ${ok} cierre(s) aplicados, ${yaAplicados} ya existían, ${errores} con error. ` +
            `Ademas, no se pudo guardar el Rebate Union para el resumen del club: ${erroresGuardado.join("; ")}.`
        );
        onDone();
        setAplicandoTodo(false);
        return;
      }
    }
    setAplicandoTodo(false);
    setResumenAplicacion(
      `Listo: ${ok} cierre(s) aplicados, ${yaAplicados} ya existían (no se duplicaron), ${errores} con error.`
    );
    onDone();
  }

  const PLATAFORMAS: { key: "SUPREMA" | "GG" | "TINY" | "XPOKER"; label: string }[] = [
    { key: "SUPREMA", label: "SupremaPoker" },
    { key: "GG", label: "GG Poker" },
    { key: "TINY", label: "Tiny GG" },
    { key: "XPOKER", label: "X-Poker" },
  ];

  // Mockup 96 (13/11/2026): mismo estilo que el cierre manual (mockup 95). Los pasos terminados se pliegan en una línea con "Cambiar",
  // la tabla de revisión tiene menos columnas (el ajuste manual se abre por fila) y el total y los botones quedan en un resumen a la derecha.
  const archivoListo = hojasDetectadas.length > 0 || confirmado;
  const hayRevision = confirmado && filas.length > 0;
  const nombrePlataforma = PLATAFORMAS.find((p) => p.key === plataforma)?.label ?? plataforma;
  const nombreArchivo = plataforma === "TINY" ? `${tinyFiles.length} archivo${tinyFiles.length === 1 ? "" : "s"}` : file?.name ?? "";
  const semPasada = semanaRelativa(-1);
  const semActual = semanaRelativa(0);
  const esSemana = (s: { desde: string; hasta: string }) => weekStart === s.desde && weekEnd === s.hasta;

  function elegirArchivos(lista: FileList | null) {
    const archivos = lista ? Array.from(lista).filter((f) => /\.xlsx$/i.test(f.name)) : [];
    if (plataforma === "TINY") setTinyFiles(archivos);
    else setFile(archivos[0] ?? null);
    setFilas([]);
    setHojasDetectadas([]);
    setConfirmado(false);
    setAnalisisError(null);
  }

  // "Cambiar" en los pasos 1 y 2: vuelve a antes de analizar, conservando archivo y semana.
  function volverAlArchivo() {
    setFilas([]);
    setHojasDetectadas([]);
    setConfirmado(false);
    setSinAgentePorClub([]);
    setBancadosPorClub([]);
    setTinyRebateUnionPorClub([]);
    setAgentesAutoCreados([]);
    setHojasFormatoInvalido([]);
    setResumenAplicacion(null);
  }

  const conExtras = (f: FilaImport) =>
    f.rodeoJugadores.length > 0 || f.jugadoresDetalle.some((j) => j.subagenteName) || (Number(f.ajusteManual) || 0) !== 0;
  const filasVisibles = filas.filter((f) =>
    filtroFilas === "sindeal" ? f.configSource !== "deal" : filtroFilas === "extras" ? conExtras(f) : true
  );
  const conPrevia = incluidas.filter((f) => f.previewResult?.calc && !f.previewError);
  const totalRakeback = conPrevia.reduce((s, f) => s + Number(f.previewResult.calc.rakeback ?? 0), 0);
  const totalRebate = conPrevia.reduce((s, f) => s + Number(f.previewResult.calc.rebate ?? 0), 0);
  const algunaPrevia = filas.some((f) => f.previewResult);

  return (
    <div className={`cm-lay ${hayRevision ? "" : "solo"}`}>
    <div className="panel cm-form">
      <section className="cm-sec">
        <div className="cm-sh">
          <span className={`cm-n ${archivoListo ? "ok" : ""}`}>{archivoListo ? "✓" : "1"}</span>
          <b>Plataforma</b>
          {archivoListo ? (
            <>
              <span className="cm-done">· <em>{nombrePlataforma}</em></span>
              <button type="button" className="cm-ch" onClick={volverAlArchivo}>Cambiar</button>
            </>
          ) : (
            <Ayuda>Cada plataforma tiene su propio archivo y su propia liquidación — elegí primero la plataforma del archivo que vas a subir.</Ayuda>
          )}
        </div>
        {!archivoListo && (
          <div className="cm-seg">
            {PLATAFORMAS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={plataforma === p.key ? "on" : ""}
                onClick={() => {
                  setPlataforma(p.key);
                  setFile(null);
                  setTinyFiles([]);
                  setFilas([]);
                  setHojasDetectadas([]);
                  setConfirmado(false);
                  setAnalisisError(null);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </section>

      {plataforma === "XPOKER" && (
        <div className="muted" style={{ padding: "4px 0 16px" }}>
          Todavía no tenemos el importador de X-Poker armado — falta construir el parser para el formato de esa
          plataforma (y su liquidación, que también está pendiente). Mandame un archivo de ejemplo y un cierre de esa
          semana ya calculado a mano, y lo armamos igual que se hizo con Suprema y GG.
        </div>
      )}

      {(plataforma === "SUPREMA" || plataforma === "GG" || plataforma === "TINY") && (
      <>
      <section className="cm-sec">
        <div className="cm-sh">
          <span className={`cm-n ${archivoListo ? "ok" : ""}`}>{archivoListo ? "✓" : "2"}</span>
          <b>Archivo y semana</b>
          {archivoListo ? (
            <>
              <span className="cm-done">· <em>{nombreArchivo}</em> · {dateShort(weekStart)} – {dateShort(weekEnd)}{plataforma === "TINY" ? ` · tasa ${tinyRate}` : ""}</span>
              <button type="button" className="cm-ch" onClick={volverAlArchivo}>Cambiar</button>
            </>
          ) : (
            <Ayuda>
              El % de rakeback/rebate de cada agente sale SIEMPRE del deal cargado en Administración — el archivo nunca lo trae.
              {plataforma === "GG" && " En GG el cierre agrupa por Super Agent (el nivel más alto de la cadena Super Agent → Agent → Member) y el rebate se calcula sobre (Resultado + Rake) × % del club."}
              {plataforma === "TINY" &&
                " En Tiny cada super agente baja su PROPIO archivo (subí varios juntos si tenés más de uno) — el sistema toma a los sub-agentes reales de adentro de cada archivo (no al super agente) y les liquida con la misma fórmula de siempre (resultado + rake) × % rebate. Los números del reporte NO están en USD: hay que cargar la tasa de esta semana para convertirlos."}
            </Ayuda>
          )}
        </div>
        {!archivoListo && (
          <>
            <label
              className={`cm-drop ${(plataforma === "TINY" ? tinyFiles.length > 0 : !!file) ? "lleno" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                elegirArchivos(e.dataTransfer.files);
              }}
            >
              <input type="file" accept=".xlsx" multiple={plataforma === "TINY"} onChange={(e) => elegirArchivos(e.target.files)} />
              {plataforma === "TINY" ? (
                tinyFiles.length > 0 ? (
                  <><b>{tinyFiles.length} archivo{tinyFiles.length === 1 ? "" : "s"}</b> {tinyFiles.map((f) => f.name).join(", ")} · <u>cambiar</u></>
                ) : (
                  <><b>Soltá los .xlsx acá</b> (uno por super agente) o tocá para elegirlos</>
                )
              ) : file ? (
                <><b>{file.name}</b> · <u>cambiar</u></>
              ) : (
                <><b>Soltá el .xlsx acá</b> o tocá para elegirlo</>
              )}
            </label>
            <div className="cm-semana" style={{ marginTop: 12 }}>
              <button type="button" className={`cm-q ${esSemana(semPasada) ? "on" : ""}`} onClick={() => { setWeekStart(semPasada.desde); setWeekEnd(semPasada.hasta); }}>Semana pasada</button>
              <button type="button" className={`cm-q ${esSemana(semActual) ? "on" : ""}`} onClick={() => { setWeekStart(semActual.desde); setWeekEnd(semActual.hasta); }}>Esta semana</button>
              <div className="field">
                <label>Desde</label>
                <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
              </div>
              <div className="field">
                <label>Hasta</label>
                <input type="date" value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} />
              </div>
            </div>
            {plataforma === "TINY" && (
              <div className="field" style={{ maxWidth: 320, marginTop: 12 }}>
                <label>Tasa de esta semana (fichas por USD) <Ayuda>El reporte de Tiny trae los números en su propia unidad, no en USD — se divide todo por esta tasa. Cambia cada semana, revisala antes de analizar.</Ayuda></label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Ej: 31.78"
                  value={tinyRate}
                  onChange={(e) => { setTinyRate(e.target.value); setFilas([]); setConfirmado(false); }}
                />
              </div>
            )}
            <button className="btn" style={{ marginTop: 14 }} disabled={analizando} onClick={analizar}>
              {analizando ? "Analizando..." : "Analizar archivo"}
            </button>
          </>
        )}
      </section>

      {analisisError && <div className="error" style={{ marginTop: 12 }}>⚠ {analisisError}</div>}

      {hojasFormatoInvalido.length > 0 && (
        <div className="error" style={{ marginTop: 12 }}>
          {hojasFormatoInvalido.map((h) => (
            <div key={h.sheetName}>⚠ Hoja "{h.sheetName}": {h.motivo}</div>
          ))}
        </div>
      )}

      {hojasDetectadas.length > 0 && confirmado && (
        <section className="cm-sec">
          <div className="cm-sh">
            <span className="cm-n ok">✓</span>
            <b>Club de cada hoja</b>
            <span className="cm-done">
              ·{" "}
              {hojasDetectadas
                .filter((h) => !hojaIgnorada[h.sheetName])
                .map((h) => `${hojasDetectadas.length > 1 ? `${h.sheetName} → ` : ""}${clubesSuprema.find((c) => c.id === clubElegidoPorHoja[h.sheetName])?.name ?? "?"}`)
                .join(" · ")}
            </span>
            <button type="button" className="cm-ch" onClick={() => setConfirmado(false)}>Cambiar</button>
          </div>
        </section>
      )}

      {hojasDetectadas.length > 0 && !confirmado && (
        <section className="cm-sec">
          <div className="cm-sh"><span className="cm-n">3</span><b>Club de cada hoja</b></div>
          <div className="muted" style={{ marginBottom: 8 }}>
            El archivo trae {hojasDetectadas.length === 1 ? "1 grupo de datos" : `${hojasDetectadas.length} grupos de datos`} — elegí a qué club corresponde cada uno (o tildá "Ignorar" para no procesarlo esta semana).
          </div>
          {hojasDetectadas.length > 1 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button
                className="btn secondary small"
                onClick={() => setHojaIgnorada(Object.fromEntries(hojasDetectadas.map((h) => [h.sheetName, true])))}
              >
                Ignorar todas
              </button>
              <button
                className="btn secondary small"
                onClick={() => setHojaIgnorada(Object.fromEntries(hojasDetectadas.map((h) => [h.sheetName, false])))}
              >
                Incluir todas
              </button>
            </div>
          )}
          <table>
            <thead><tr><th>{hojasDetectadas.length > 1 ? "Grupo" : ""}</th><th>Club</th><th>Ignorar</th></tr></thead>
            <tbody>
              {hojasDetectadas.map((h, idx) => {
                const ignorada = !!hojaIgnorada[h.sheetName];
                return (
                  <tr key={h.sheetName} style={ignorada ? { opacity: 0.5 } : undefined}>
                    <td>{hojasDetectadas.length > 1 ? idx + 1 : ""}</td>
                    <td>
                      <select
                        value={clubElegidoPorHoja[h.sheetName] ?? ""}
                        disabled={ignorada}
                        onChange={(e) => setClubElegidoPorHoja((s) => ({ ...s, [h.sheetName]: e.target.value }))}
                      >
                        <option value="">Elegir club...</option>
                        {clubesSuprema.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={ignorada}
                        onChange={(e) => setHojaIgnorada((s) => ({ ...s, [h.sheetName]: e.target.checked }))}
                        title="No procesar esta hoja esta semana"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {clubesSuprema.length === 0 && (
            <div className="muted" style={{ marginTop: 6 }}>
              No hay ningún club activo todavía — creá uno en Administración → Clubes antes de poder elegir club acá.
            </div>
          )}
          <button
            className="btn secondary"
            style={{ marginTop: 8 }}
            disabled={analizando || hojasDetectadas.some((h) => !hojaIgnorada[h.sheetName] && !clubElegidoPorHoja[h.sheetName])}
            onClick={confirmarClubesYProcesar}
          >
            {analizando ? "Procesando..." : "Confirmar clubes y procesar"}
          </button>
        </section>
      )}

      {hayRevision && (
        <div className="cm-sh" style={{ paddingTop: 14, borderTop: "1px solid var(--border)" }}><span className="cm-n">4</span><b>Revisar y aplicar</b></div>
      )}

      {agentesAutoCreados.length > 0 && (
        <div className="muted" style={{ marginTop: 16 }}>
          Se crearon automáticamente {agentesAutoCreados.length === 1 ? "1 agente nuevo" : `${agentesAutoCreados.length} agentes nuevos`} que
          venían en el archivo y no existían en el catálogo: {agentesAutoCreados.map((a) => a.agentName).join(", ")}.
          Si alguno es en realidad un agente que ya tenías con otro nombre (typo del archivo), corregilo
          desde el Árbol de clubes (mover los jugadores al agente correcto y eliminar el duplicado).
        </div>
      )}

      {sinAgentePorClub.length > 0 && (
        <details className="cm-al warn">
          <summary>
            <b>{sinAgentePorClub.reduce((n, g) => n + g.items.length, 0)} jugador{sinAgentePorClub.reduce((n, g) => n + g.items.length, 0) === 1 ? "" : "es"} sin agente</b>
            <span>en {sinAgentePorClub.map((g) => g.clubName).join(", ")}</span>
            <em>Asignar</em>
          </summary>
        <div className="cm-al-body">
          {sinAgentePorClub.map((grupo) => {
            // Agrupa por agente crudo del archivo (agentIdRaw||agentNameRaw) — varios jugadores
            // suelen compartir el mismo superagente todavía no creado; un solo clic lo crea y
            // reprocesa TODOS los que le correspondan, no solo el jugador que lo disparó.
            const faltantes = new Map<string, { agentIdRaw: string | null; agentNameRaw: string; count: number }>();
            for (const it of grupo.items) {
              if (!it.agentNameRaw) continue;
              const clave = it.agentIdRaw ?? it.agentNameRaw;
              const existente = faltantes.get(clave);
              if (existente) existente.count += 1;
              else faltantes.set(clave, { agentIdRaw: it.agentIdRaw, agentNameRaw: it.agentNameRaw, count: 1 });
            }
            return (
            <div key={grupo.clubId} style={{ marginBottom: 14 }}>
              <div className="muted">{grupo.clubName}</div>
              {faltantes.size > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "8px 0" }}>
                  {[...faltantes.entries()].map(([clave, f]) => (
                    <button
                      key={clave}
                      className="btn secondary small"
                      disabled={creandoAgente === clave}
                      onClick={() => crearAgenteYReprocesar(f.agentIdRaw, f.agentNameRaw)}
                      title={`Crea el agente y asigna automáticamente a los ${f.count} jugador(es) que le corresponden`}
                    >
                      {creandoAgente === clave ? "Creando..." : `+ Crear agente "${f.agentNameRaw}" (${f.count})`}
                    </button>
                  ))}
                </div>
              )}
              <table>
                <thead><tr><th>Jugador</th><th>Agente en el archivo</th><th className="num">Resultado</th><th className="num">Rake</th><th>Asignar a</th><th></th></tr></thead>
                <tbody>
                  {grupo.items.map((it: any) => {
                    const claveSel = `${grupo.clubId}|${it.playerId}`;
                    return (
                      <tr key={it.playerId}>
                        <td>{it.playerName} <span className="muted">#{it.playerId}</span></td>
                        <td>{it.agentNameRaw ?? <span className="muted">(vacío)</span>}</td>
                        <td className="num money">{usd(it.resultado)}</td>
                        <td className="num money">{usd(it.rake)}</td>
                        <td>
                          <select value={asignando[claveSel] ?? ""} onChange={(e) => setAsignando((s) => ({ ...s, [claveSel]: e.target.value }))}>
                            <option value="">Elegir agente...</option>
                            {agentes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <button
                            className="btn secondary small"
                            disabled={!asignando[claveSel] || guardandoAsignacion === claveSel}
                            onClick={() => asignarJugador(grupo.clubId, it.playerId)}
                          >
                            {guardandoAsignacion === claveSel ? "..." : "Asignar"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            );
          })}
        </div>
        </details>
      )}

      {bancadosPorClub.length > 0 && (
        <details className="cm-al info">
          <summary>
            <b>{bancadosPorClub.reduce((n, g) => n + g.items.length, 0)} bancado{bancadosPorClub.reduce((n, g) => n + g.items.length, 0) === 1 ? "" : "s"} omitido{bancadosPorClub.reduce((n, g) => n + g.items.length, 0) === 1 ? "" : "s"}</b>
            <span>no entran a ningún cierre</span>
            <em>Ver</em>
          </summary>
        <div className="cm-al-body">
          <div className="muted" style={{ marginBottom: 10 }}>
            Estos jugadores están marcados en "Jugadores bancados" — no entran al cierre agregado de su agente, se contabilizan
            aparte. El total de acá abajo NO está incluido en ningún cierre que vayas a aplicar.
          </div>
          {bancadosPorClub.map((grupo) => {
            const totalResultado = grupo.items.reduce((s: number, it: any) => s + Number(it.resultado), 0);
            const totalRake = grupo.items.reduce((s: number, it: any) => s + Number(it.rake), 0);
            return (
              <div key={grupo.clubId} style={{ marginBottom: 14 }}>
                <div className="muted">
                  {grupo.clubName} — {grupo.items.length} jugador{grupo.items.length === 1 ? "" : "es"} omitido{grupo.items.length === 1 ? "" : "s"}, resultado
                  total {usd(totalResultado)}, rake total {usd(totalRake)}
                </div>
                <table>
                  <thead><tr><th>Jugador</th><th>Agente</th><th className="num">Resultado</th><th className="num">Rake</th></tr></thead>
                  <tbody>
                    {grupo.items.map((it: any) => (
                      <tr key={it.playerId}>
                        <td>{it.playerName} <span className="muted">#{it.playerExternalId ?? it.playerId}</span></td>
                        <td>{it.agentName}</td>
                        <td className="num money">{usd(it.resultado)}</td>
                        <td className="num money">{usd(it.rake)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
        </details>
      )}

      {tinyRebateUnionPorClub.length > 0 && (
        <details className="cm-al info">
          <summary>
            <b>Rebate Union de Tiny</b>
            <span>conciliación por super agente</span>
            <em>Ver</em>
          </summary>
        <div className="cm-al-body">
          <h4 style={{ margin: "0 0 8px" }}>Rebate Union de Tiny (conciliacion) <Ayuda>Rebate Union: lo que Tiny/la Union nos reconoce a NOSOTROS por super agente, calculado sobre el RG Pre-rake
            P&amp;L (excl. JP) del archivo -- 10% si esa base es negativa, 0 si es positiva o cero. Es un calculo
            INDEPENDIENTE del rebate que nosotros les pagamos a cada agente (columna "Suma Rebate agentes"); nunca se
            reparte directo a los agentes. Diferencia = Rebate Union - Suma Rebate agentes: positiva es margen extra
            para nosotros, negativa es costo extra que absorbemos.</Ayuda></h4>
          {tinyRebateUnionPorClub.map((grupo: any) => {
            const diferencia = grupo.items.reduce((s: number, it: any) => s + it.rebateUnionCalculado, 0) - grupo.rebateAgentesTotal;
            const baseUnionTotal = grupo.items.reduce((s: number, it: any) => s + (it.rgPreRakeExclJp ?? 0), 0);
            return (
              <div key={grupo.clubId} style={{ marginBottom: 14 }}>
                <div className="muted">{grupo.clubName}</div>
                <table>
                  <thead>
                    <tr>
                      <th>Super agente (archivo)</th>
                      <th className="num">RG Pre-rake excl. JP</th>
                      <th className="num">Rebate Union (nuestro)</th>
                      <th className="num">Rebate Union (Tiny)</th>
                      <th className="num">Rake share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupo.items.map((it: any, idx: number) => (
                      <tr key={idx}>
                        <td>{it.superAgentNickname ?? it.fileName}</td>
                        <td className="num money">{it.rgPreRakeExclJp != null ? usd(it.rgPreRakeExclJp) : "-"}</td>
                        <td className="num money">{usd(it.rebateUnionCalculado)}</td>
                        <td className="num">
                          {it.rebateUnionTiny != null ? usd(it.rebateUnionTiny) : "-"}
                          {it.rebateUnionTiny != null && Math.abs(it.rebateUnionTiny - it.rebateUnionCalculado) > 0.5 && (
                            <span className="neg" style={{ marginLeft: 6 }}>difiere</span>
                          )}
                        </td>
                        <td className="num money">{it.rakeShare != null ? usd(it.rakeShare) : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted" style={{ marginTop: 6 }}>
                  Suma Rebate agentes (lo que pagamos nosotros): <strong>{usd(grupo.rebateAgentesTotal)}</strong>
                  {" - "}
                  Diferencia (Rebate Union menos Suma Rebate agentes):{" "}
                  <strong className={diferencia >= 0 ? "pos" : "neg"}>{usd(diferencia)}</strong>
                  {" - "}
                  Base: RG Pre-rake excl. JP {usd(baseUnionTotal)} vs Suma(W/L+Rake) agentes {usd(grupo.baseAgentesTotal)}
                  {Math.abs(baseUnionTotal - grupo.baseAgentesTotal) > 0.5 && (
                    <span className="neg" style={{ marginLeft: 6 }}>bases distintas</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </details>
      )}

      {hayRevision && (
        <div style={{ paddingBottom: 6 }}>
          <div className="ci-tools">
            <b>Cierres a aplicar</b>
            <span className="ci-c">{incluidas.length} de {filas.length}</span>
            <div className="ci-sp">
              <div className="cm-seg chico">
                {([
                  ["todos", "Todos", filas.length],
                  ["sindeal", "Sin deal", sinConfigurarCount],
                  ["extras", "Con extras", filas.filter(conExtras).length],
                ] as const).map(([k, t, n]) => (
                  <button key={k} type="button" className={filtroFilas === k ? "on" : ""} onClick={() => setFiltroFilas(k)}>
                    {t} {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="table-scroll">
            <table className="ci-tabla">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      title="Tildar / destildar todos"
                      checked={filas.length > 0 && filas.every((f) => f.included)}
                      onChange={(e) => setFilas((fs) => fs.map((f) => ({ ...f, included: e.target.checked })))}
                    />
                  </th>
                  <th>Agente · club</th>
                  <th className="num">Jug.</th>
                  <th className="num">Resultado</th>
                  <th className="num">Rake</th>
                  <th>Deal</th>
                  <th>Extras</th>
                  <th className="num">Cierre final</th>
                </tr>
              </thead>
              <tbody>
                {filasVisibles.map((f) => {
                  const calc = f.applyResult?.calc ?? f.previewResult?.calc;
                  const tieneAjuste = (Number(f.ajusteManual) || 0) !== 0;
                  const ajusteVisible = !!ajusteAbierto[f.key] || tieneAjuste;
                  const conSub = f.jugadoresDetalle.filter((j) => j.subagenteName).length;
                  return (
                    <Fragment key={f.key}>
                      <tr className={f.included ? "" : "off"}>
                        <td><input type="checkbox" checked={f.included} onChange={() => toggleIncluded(f.key)} /></td>
                        <td>
                          <b className="ci-ag">{f.agentName}</b>
                          <small className="ci-sub">{f.clubName} · {f.system === "PREPAGO" ? "Prepago" : "Win/Lose"}</small>
                        </td>
                        <td className="num">{f.jugadores}</td>
                        <td className="num"><Monto value={f.resultado} /></td>
                        <td className="num"><Monto value={f.rakeTotal} /></td>
                        <td>
                          {f.configSource === "deal" ? (
                            <span className="ci-bd deal" title={calc ? `Rakeback ${usd(calc.rakeback)} · Rebate ${usd(calc.rebate)}` : "Deal de Administración"}>
                              {pctTexto(f.rakebackPct)}% · {pctTexto(f.rebatePct)}%
                            </span>
                          ) : (
                            <span className="ci-bd no" title="No tiene un deal cargado para este club — no se puede aplicar así. Cargale el % en Administración (Asignar % a agente) y volvé a calcular la vista previa.">
                              Sin deal
                            </span>
                          )}
                        </td>
                        <td className="ci-extras">
                          {f.rodeoJugadores.length > 0 && (
                            <span className="ci-bd x" title="Solo SupremaPoker: se le suma al cierre la parte del agente ya neta de su memoria por jugador.">
                              Rodeo {f.rodeoJugadores.length} jug.{calc?.rodeo != null ? ` · ${usd(calc.rodeo)}` : ""}
                            </span>
                          )}
                          {f.jugadoresDetalle.length > 0 && (
                            <button type="button" className="ci-bd x btn-bd" onClick={() => setSubagenteModalFila(f.key)}>
                              {conSub > 0 ? `${conSub} con subagente` : `${f.jugadoresDetalle.length} jug.`}
                            </button>
                          )}
                          {!tieneAjuste && !f.applyResult && (
                            <button type="button" className="ci-bd x btn-bd" onClick={() => setAjusteAbierto((s) => ({ ...s, [f.key]: !s[f.key] }))}>
                              {ajusteVisible ? "– ajuste" : "+ ajuste"}
                            </button>
                          )}
                          {tieneAjuste && <span className="ci-bd x">Ajuste {usd(Number(f.ajusteManual))}</span>}
                        </td>
                        <td className="num ci-fin">
                          {f.applyResult?.alreadyApplied && <span className="badge neutral">Ya existía</span>}
                          {f.applyResult && !f.applyResult.alreadyApplied && (
                            <><Monto value={f.applyResult.calc?.finalClosing} /><small>aplicado</small></>
                          )}
                          {!f.applyResult && f.previewLoading && "..."}
                          {!f.applyResult && !f.previewLoading && f.previewError && <small className="neg">⚠ {f.previewError}</small>}
                          {!f.applyResult && !f.previewLoading && !f.previewError && f.previewResult && (
                            <>
                              <Monto value={f.previewResult.calc?.finalClosing} />
                              <small>{f.previewResult.calc?.ruleApplied ? f.previewResult.calc.ruleApplied : "vista previa"}</small>
                            </>
                          )}
                          {!f.applyResult && !f.previewLoading && !f.previewError && !f.previewResult && (
                            <><span className="muted">—</span><small>{f.configSource === "deal" ? "sin calcular" : "cargá el deal"}</small></>
                          )}
                          {f.applyError && <small className="neg">⚠ {f.applyError}</small>}
                        </td>
                      </tr>
                      {ajusteVisible && (
                        <tr className={`ci-aj ${f.included ? "" : "off"}`}>
                          <td />
                          <td colSpan={7}>
                            <div className="ci-aj-in">
                            <span>Ajuste manual (USD) <Ayuda>Tickets promocionales u otro monto libre que se suma (o resta) directo al cierre final de este agente. Si no es 0, la nota es obligatoria.</Ayuda></span>
                            <input type="number" step="0.01" value={f.ajusteManual} disabled={!!f.applyResult} onChange={(e) => setAjusteManualFila(f.key, e.target.value)} />
                            <input
                              type="text"
                              placeholder="Motivo (obligatorio si hay ajuste)"
                              value={f.ajusteManualNota}
                              disabled={!!f.applyResult}
                              onChange={(e) => setAjusteManualNotaFila(f.key, e.target.value)}
                            />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sinConfigurarCount > 0 && (
            <div className="error" style={{ marginTop: 10 }}>
              {sinConfigurarCount} fila{sinConfigurarCount === 1 ? "" : "s"} sin deal cargado — quedaron destildadas y no entran en este lote.
              Cargales el % en Administración y volvé a calcular la vista previa para incluirlas.
            </div>
          )}
          {hayIncluidasSinNotaAjuste && (
            <div className="error" style={{ marginTop: 10 }}>
              Hay filas incluidas con un ajuste manual cargado pero sin nota — completá el motivo antes de aplicar.
            </div>
          )}
        </div>
      )}
      </>
      )}
    </div>

      {hayRevision && (
        <aside className="panel cm-res">
          <h3>Resumen de la importación</h3>
          <div className="cm-who">{nombrePlataforma} · {dateShort(weekStart)} – {dateShort(weekEnd)}</div>
          <div className="cm-rl">
            <div className="cm-r"><span>Cierres incluidos</span><b>{incluidas.length} de {filas.length}</b></div>
            <div className="cm-r"><span>Sin deal (no se aplican)</span><b className={sinConfigurarCount > 0 ? "w" : ""}>{sinConfigurarCount}</b></div>
            <div className="cm-r"><span>Rakeback total</span><b>{conPrevia.length ? usd(totalRakeback) : "—"}</b></div>
            <div className="cm-r"><span>Rebate total</span><b>{conPrevia.length ? usd(totalRebate) : "—"}</b></div>
          </div>
          <div className="cm-tot">
            <span>TOTAL</span>
            <b className={todasPrevisualizadas ? (totalCierreFinal >= 0 ? "pos" : "neg") : ""}>{todasPrevisualizadas ? usd(totalCierreFinal) : "—"}</b>
          </div>
          <div className="cm-st">
            <i className={todasPrevisualizadas ? "ok" : ""} />
            {todasPrevisualizadas
              ? "Vista previa real de todos los incluidos. Si cambiás algo, se vuelve a pedir."
              : "Calculá la vista previa de todos (no guarda nada) para poder aplicar."}
          </div>
          {resumenAplicacion && <div className="success" style={{ marginTop: 10 }}>{resumenAplicacion}</div>}
          <div className="cm-bs">
            <button type="button" className="btn secondary" disabled={previsualizandoTodo} onClick={previsualizarTodo}>
              {previsualizandoTodo ? "Calculando..." : algunaPrevia ? "Recalcular vista previa" : "Calcular vista previa de todos"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!todasPrevisualizadas || hayIncluidasSinConfigurar || hayIncluidasSinNotaAjuste || aplicandoTodo}
              title={
                hayIncluidasSinConfigurar
                  ? "Hay filas incluidas sin deal cargado — cargales el % o destildalas antes de aplicar."
                  : hayIncluidasSinNotaAjuste
                  ? "Hay filas con un ajuste manual cargado pero sin nota — completá el motivo antes de aplicar."
                  : !todasPrevisualizadas
                  ? "Calculá la vista previa de todos los cierres primero"
                  : undefined
              }
              onClick={aplicarTodo}
            >
              {aplicandoTodo ? "Aplicando..." : `Aplicar ${incluidas.length} cierre${incluidas.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </aside>
      )}

      {subagenteModalFila && (() => {
        const fila = filas.find((f) => f.key === subagenteModalFila);
        if (!fila) return null;
        return (
          <Modal title={`Subagentes · ${fila.agentName} (${fila.clubName})`} onClose={() => setSubagenteModalFila(null)}>
            <div className="muted" style={{ marginBottom: 10, fontSize: 12.5 }}>
              Asignale a un jugador puntual su propio % de rakeback (distinto al {(fila.rakebackPct * 100).toFixed(1)}% del
              agente) — el nombre de subagente es opcional: poné solo el % si es un override personal de ese jugador, o
              sumale un nombre si además querés armarle una liquidación aparte (para eso sí hace falta el nombre). Queda
              guardado para este y los próximos cierres, y se usa en el PDF de "Resumen por agente".
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 420, overflowY: "auto" }}>
              {fila.jugadoresDetalle.map((j) => (
                <div key={j.playerId} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                  <span style={{ minWidth: 140 }}>{j.playerName}</span>
                  {editandoSubagentePlayerId === j.playerId ? (
                    <>
                      <input
                        value={subagenteNombre}
                        onChange={(e) => setSubagenteNombre(e.target.value)}
                        placeholder="Sin subagente"
                        style={{ fontSize: 11.5, width: 120 }}
                      />
                      <input
                        value={subagentePct}
                        onChange={(e) => setSubagentePct(e.target.value)}
                        placeholder="% RB propio"
                        type="number"
                        step="0.01"
                        style={{ fontSize: 11.5, width: 90 }}
                      />
                      <button className="btn small" disabled={guardandoSubagente} onClick={() => guardarSubagente(fila.key, j.playerId)}>
                        {guardandoSubagente ? "..." : "Guardar"}
                      </button>
                      <button className="btn secondary small" onClick={() => setEditandoSubagentePlayerId(null)}>Cancelar</button>
                    </>
                  ) : (
                    <>
                      {j.subagenteName ? (
                        <span className="badge" style={{ fontSize: 11 }}>
                          Subagente "{j.subagenteName}" · {(Number(j.subagenteRakebackPct) * 100).toFixed(1)}%
                        </span>
                      ) : j.subagenteRakebackPct != null ? (
                        <span className="badge" style={{ fontSize: 11 }}>
                          % propio: {(Number(j.subagenteRakebackPct) * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>Sin subagente</span>
                      )}
                      <button className="btn secondary small" style={{ fontSize: 11 }} onClick={() => abrirEdicionSubagente(j.playerId, j)}>
                        Editar
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
            {errorSubagente && <div className="error" style={{ marginTop: 10 }}>{errorSubagente}</div>}
          </Modal>
        );
      })()}
    </div>
  );
}
