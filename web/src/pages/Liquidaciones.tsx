import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { usd, dateShort } from "../fmt";
import { useConfirmDialog } from "../components/ConfirmProvider";
import Modal from "../components/Modal";

// Resumen de liquidación semanal, para mandarle el pago a una persona/grupo: una fila por
// agente+club con lo que generó en rakeback esa semana, un total, y (abajo) lo que
// efectivamente se le paga después de cruzar adelantos pendientes — mismo formato que la
// planilla vieja ("PRODIGIO · CIERRE 07/09-13/09"). Se puede combinar MÁS DE UN agente (de
// clubes distintos) en una sola liquidación, porque en la práctica una misma persona ("Prodigio")
// puede tener una identidad de agente distinta por cada club, igual que pasaba con Juan — acá
// es solo para el reporte/PDF, no rutea nada de plata como sí hace "Cuenta de socio".
// Todo en USD: weekly_closings ya guarda los montos convertidos con la tasa de esa semana, no
// el monto en moneda local original, así que cualquier aclaración de conversión se agrega a
// mano en la nota de abajo.
// Ventas y tickets promocionales (21/09/2026): se cargan por FILA (agente+club), no para toda
// la liquidación como el "Adicional manual" -- Leo necesita poder cargárselo a un solo agente
// de la tanda, no a todos. Viajan pegados a cada objeto de `filas` (que ya se guarda como JSON
// tal cual, sin columnas propias) para no tocar el schema.
function filaKey(f: any): string {
  return `${f.agentId}_${f.clubId}`;
}

// Etiquetas para el historial de pagos de una liquidación (28/09/2026, pedido de Leo) -- "tipo"
// y "medio" vienen crudos de la base (ver GET /catalog/liquidacion, campo `pagos`).
function etiquetaTipoPago(tipo: string): string {
  switch (tipo) {
    case "PAGO_FICHAS":
      return "Pago (fichas)";
    case "PAGO_USDT":
      return "Pago";
    case "PAGO":
      return "Pago";
    case "COBRO":
      return "Cobro";
    default:
      return tipo;
  }
}
function etiquetaMedioPago(medio: string | null): string {
  switch (medio) {
    case "FICHAS":
      return "Fichas";
    case "USDT":
      return "USDT";
    case "EFECTIVO":
      return "Efectivo";
    case "ZELLE":
      return "Zelle";
    case "SIN_TESORERIA":
      return "Sin tesorería";
    case "OTRO":
      return "Otro";
    default:
      return "-";
  }
}

interface PdfInput {
  nombreGrupo: string;
  weekStart: string;
  weekEnd: string;
  filas: any[];
  multiAgente: boolean;
  total: number;
  adelantosAplicados: number;
  adelantosManual: number;
  cargasAplicadas: number;
  ventasTickets: number;
  nota: string;
}

// Recibe SIEMPRE los totales ya resueltos (aplicado + tildado + manual) — nunca solo "lo
// tildado ahora mismo", porque si el cruce ya se aplicó (y el checkbox se reseteó al refrescar
// los pendientes), el PDF terminaba mostrando "Adelantos a descontar: 0" a pesar de que el
// cruce sí se había consumido de verdad (BIT: pasaba justo con el adelanto de rake de Prodigio).
async function generarPdf(input: PdfInput) {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc = new jsPDF();
  const margen = 14;
  let y = 18;
  const totalDescontar = input.adelantosAplicados + input.adelantosManual + input.cargasAplicadas + input.ventasTickets;
  const totalAPagar = input.total - totalDescontar;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`${input.nombreGrupo} · Cierre ${dateShort(input.weekStart)} - ${dateShort(input.weekEnd)}`, margen, y);
  y += 9;

  autoTable(doc, {
    startY: y,
    margin: { left: margen, right: margen },
    head: [["Club", "Ganancias/Pérdidas", "Rake", "Rakeback bruto", "Rebate", "Rakeback neto", "Ventas", "Tickets"]],
    body: input.filas.map((f: any) => [
      input.multiAgente ? `${f.clubName} (${f.agentName})` : f.clubName,
      usd(f.resultado),
      usd(f.rakeTotal),
      usd(f.rakebackBruto),
      usd(f.rebate),
      usd(f.rakebackNeto),
      usd(f.ventas || 0),
      usd(f.tickets || 0),
    ]),
    foot: [["TOTAL", "", "", "", "", usd(input.total),
      usd(input.filas.reduce((s: number, f: any) => s + (Number(f.ventas) || 0), 0)),
      usd(input.filas.reduce((s: number, f: any) => s + (Number(f.tickets) || 0), 0)),
    ]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [40, 50, 90] },
    footStyles: { fillColor: [230, 230, 236], textColor: 0, fontStyle: "bold" },
  });
  y = (doc as any).lastAutoTable.finalY + 10;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Después:", margen, y);
  y += 7;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Rakeback / comisiones finales: ${usd(input.total)}`, margen, y);
  y += 6;
  doc.text(`Adelantos + cargas a descontar: -${usd(input.adelantosAplicados + input.adelantosManual + input.cargasAplicadas)}`, margen, y);
  y += 6;
  if (input.ventasTickets !== 0) {
    doc.text(`Ventas + tickets (por agente) a descontar: -${usd(input.ventasTickets)}`, margen, y);
    y += 6;
  }
  if (input.adelantosManual !== 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.text(`(incluye ${usd(input.adelantosManual)} pendiente de registrar)`, margen, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    y += 6;
  }
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`Total a pagar a ${input.nombreGrupo}: ${usd(totalAPagar)}`, margen, y);
  y += 10;

  if (input.nota.trim()) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(90);
    const lineas = doc.splitTextToSize(input.nota.trim(), 180);
    doc.text(lineas, margen, y);
    doc.setTextColor(0);
  }

  const nombreArchivo = `liquidacion_${input.nombreGrupo.replace(/[^a-z0-9]+/gi, "-")}_${input.weekStart}.pdf`;
  doc.save(nombreArchivo);
}

export default function Liquidaciones() {
  const { confirmDialog, alertDialog } = useConfirmDialog();
  const [agentes, setAgentes] = useState<any[]>([]);
  const [filtro, setFiltro] = useState("");
  const [seleccionados, setSeleccionados] = useState<string[]>([]);
  const [nombreGrupo, setNombreGrupo] = useState("");
  const [semanas, setSemanas] = useState<any[]>([]);
  const [weekStart, setWeekStart] = useState("");
  const [data, setData] = useState<any>(null);
  const [aplicado, setAplicado] = useState<number>(0); // suma de lo YA aplicado (consumido de verdad) en esta liquidación
  // Cargas de tesorería pendientes (21/09/2026) -- mismo patrón que "aplicado" de arriba, pero
  // contra carga_pendientes_cruce en vez de rakeback_advances (ver repo/cargaCruces.ts).
  const [aplicadoCarga, setAplicadoCarga] = useState<number>(0);
  // Popup al cruzar (29/09/2026, pedido de Leo: "cuando elija los adelantos y/o cruces se tiene
  // que desplegar un popup y yo seleccionar... la semana fecha que quiero hacer el cruce") --
  // antes se tildaban varios adelantos/cargas y se mandaban juntos con un botón "Aplicar cruce"
  // en lote, sin volver a mirarlos. Ahora cada adelanto/carga tiene su propio botón "Cruzar" que
  // abre este popup, mostrando la semana de ESTA liquidación (la que ya se eligió arriba) y el
  // monto a descontar, para confirmar antes de aplicarlo -- se aplica de a uno, al toque.
  const [modalCruce, setModalCruce] = useState<{ tipo: "ADELANTO" | "CARGA"; item: any; monto: string } | null>(null);
  // Deshacer último cruce (22/09/2026, pedido de Leo, "estamos probando"): guarda los ids de
  // movimiento del ÚLTIMO cruce de adelantos/cargas que se aplicó en esta liquidación, para
  // poder deshacerlo de un click sin ir a Adelantos ni tener que resetear toda la base. Solo
  // el último -- si se aplica otro cruce encima, el backend (eliminarMovimientoAdelanto /
  // eliminarMovimientoCarga) igual exige que sea el más reciente de cada adelanto/carga.
  const [ultimoCruceAdelantos, setUltimoCruceAdelantos] = useState<{ movIds: string[]; monto: number } | null>(null);
  const [ultimoCruceCargas, setUltimoCruceCargas] = useState<{ movIds: string[]; monto: number } | null>(null);
  const [deshaciendoCruce, setDeshaciendoCruce] = useState(false);
  const [adelantosManual, setAdelantosManual] = useState<number>(0);
  // Ventas / tickets promocionales por fila (agente+club) -- keyed por filaKey(f).
  const [ventasPorFila, setVentasPorFila] = useState<Record<string, number>>({});
  const [ticketsPorFila, setTicketsPorFila] = useState<Record<string, number>>({});
  const [borrandoCarga, setBorrandoCarga] = useState<string | null>(null);
  // Enviar/Recibir (21/09/2026): registra el pago/cobro real contra la wallet, reusando el
  // movimiento CARGA... no, PAGO/COBRO que ya existe en Movimientos -- acá elegimos con qué
  // agente+club de la liquidación se cruza (puede ser multi-agente) y el medio de pago, igual
  // que en "Cargar movimiento". Es una acción aparte de "Guardar en historial": se puede enviar
  // sin guardar y guardar sin enviar.
  const [movAbierto, setMovAbierto] = useState<"PAGO" | "COBRO" | null>(null);
  const [movAgenteClub, setMovAgenteClub] = useState("");
  const [movMonto, setMovMonto] = useState("");
  const [movMetodo, setMovMetodo] = useState("SIN_TESORERIA");
  // Pago en lote (22/09/2026, pedido de Leo): "Enviar" ahora puede tildar VARIAS filas a la vez
  // -- cada una con su propio importe (default: lo que le queda pendiente a ESA fila) y su
  // propio medio (fichas mueve el stock de ese club, USDT/Efectivo/Zelle no) -- y las manda
  // todas en un solo click. No es técnicamente "un asiento único" en el ledger (cada club es un
  // movimiento propio, fichas de un club no se pueden mezclar con las de otro), pero para el
  // usuario es una sola acción: si alguna fila falla, se avisa cuál sin frenar el resto. Keyed
  // por filaKey(f). "Recibir" (COBRO) sigue con movAgenteClub de abajo -- ahí nunca hubo
  // concepto de "por fila", el monto siempre fue el total de la liquidación.
  // Splits (24/09/2026, pedido de Leo: "enviar 1000 usdt y 541.64 en fichas" -- un mismo
  // pendiente pagado en más de un medio/importe a la vez): cada fila puede tener varios
  // splits, cada uno con su propio importe y medio, todos contra el mismo pendiente/agente+club.
  const [movFilas, setMovFilas] = useState<Record<string, { checked: boolean; splits: { monto: string; medio: string }[] }>>({});
  const [movCustodio, setMovCustodio] = useState("");
  const [movObservacion, setMovObservacion] = useState("");
  const [registrandoMov, setRegistrandoMov] = useState(false);
  const [movMsg, setMovMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [generandoPdf, setGenerandoPdf] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false); // ya se guardó ESTA liquidación tal cual está — evita duplicar
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [borrandoHist, setBorrandoHist] = useState<string | null>(null);
  const [eliminandoPago, setEliminandoPago] = useState<string | null>(null);
  // "Armar liquidación" (29/09/2026, pedido de Leo): antes, apenas se tildaba un agente ya
  // aparecían los campos de Nombre y Semana -- ahora hay un paso explícito primero: se aprieta
  // el botón, se pone el Nombre (a mano, nunca el de un agente) y recién ahí se eligen los
  // agentes a combinar y la semana. "Cancelar" vuelve todo a cero sin dejar nada a medio armar.
  const [armando, setArmando] = useState(false);

  function cancelarArmado() {
    setArmando(false);
    setSeleccionados([]);
    setNombreGrupo("");
    setFiltro("");
  }

  useEffect(() => {
    api.agentes().then(setAgentes).catch(() => {});
    refrescarHistorial();
  }, []);

  function refrescarHistorial() {
    api.historialLiquidaciones().then(setHistorial).catch(() => {});
  }

  const agentesFiltrados = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    if (!f) return agentes;
    return agentes.filter((a) => a.name.toLowerCase().includes(f));
  }, [agentes, filtro]);

  function toggleAgente(id: string) {
    setSeleccionados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setSemanas([]);
    setWeekStart("");
    setData(null);
  }

  // "Retomar" desde el historial (24/09/2026): setear seleccionados + weekStart a la vez no
  // alcanza -- el efecto de abajo resetea weekStart a "" cada vez que cambian los seleccionados
  // (caso normal: elegir agentes de nuevo desde cero). Este ref lleva el weekStart/nombre que
  // hay que restaurar DESPUÉS de ese reset, para el único caso en que sí queremos saltar
  // directo a una semana puntual. estadoOriginal viaja junto: si se retoma una liquidación que
  // ya estaba "Pagada", NO queremos que el autoguardado la pise y la vuelva a marcar "Pendiente"
  // -- se puede mirar/ajustar sin que cambie su estado (pedido de Leo, 24/09/2026).
  const retomarRef = useRef<{ weekStart: string; nombreGrupo: string; estadoOriginal: string; id: string } | null>(null);
  // (28/09/2026, pedido de Leo: "al retomar una liquidación, lo ya aplicado no aparece") --
  // hasta acá, retomar solo restauraba weekStart/nombreGrupo -- refrescarLiquidacion() siempre
  // reseteaba aplicado/aplicadoCarga/adelantosManual/ventas/tickets/nota/movIds a 0 o vacío,
  // como si la liquidación se estuviera armando desde cero. El problema no era solo visual: el
  // autoguardado manda SIEMPRE el movIdsAdelantosSesion/movIdsCargasSesion actual al guardar
  // (pisa la fila entera) -- si volvías a entrar y esos ids ya estaban en [], el siguiente
  // autoguardado los BORRABA del registro, aunque el cruce siguiera aplicado de verdad en la
  // base (rakeback_advances/carga_pendientes_cruce) -- quedaba huérfano, imposible de revertir
  // después desde "Eliminar" o "Liberar cruces". Este ref lleva todo lo que hay que restaurar
  // (se consume una sola vez, dentro de refrescarLiquidacion, apenas termina de cargar).
  const restaurarRef = useRef<{
    adelantosAplicados: number;
    adelantosManual: number;
    cargasAplicadas: number;
    adelantoMovIds: string[];
    cargaMovIds: string[];
    pagoPendienteMovIds: string[];
    pagoLedgerMovIds: string[];
    filas: any[];
    nota: string;
  } | null>(null);
  // true mientras lo que está cargado en pantalla vino de "Retomar" una liquidación ya PAGADA --
  // pausa el autoguardado por completo hasta que se vuelva a elegir agentes desde cero.
  const [soloRevision, setSoloRevision] = useState(false);
  // Id de la liquidación que se está revisando (soloRevision=true) -- hace falta después para
  // poder llamar a "Liberar cruces de esta liquidación" (ver más abajo).
  const [revisandoId, setRevisandoId] = useState<string | null>(null);
  // Qué estado tenía la liquidación que se está revisando -- "Pagada" muestra "Liberar cruces",
  // "Cerrada" muestra "Reabrir para editar" en su lugar (29/09/2026, pedido de Leo).
  const [revisandoEstado, setRevisandoEstado] = useState<"PAGADA" | "CERRADA" | null>(null);
  const [reabriendo, setReabriendo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  // Se llena SOLO cuando se liberan los cruces de una liquidación Pagada para rehacerla: al
  // guardar de nuevo, en vez de crear una fila nueva en el historial, pisa ésta (pedido de Leo:
  // "que el estado quede pagada en este caso" + rehacer sin duplicar el historial).
  const [reemplazarId, setReemplazarId] = useState<string | null>(null);
  // Acumula TODOS los movementId de cruces (adelantos/cargas) aplicados en esta liquidación
  // durante la sesión actual -- a diferencia de ultimoCruceAdelantos/ultimoCruceCargas (que solo
  // guardan la última tanda, para "Deshacer último cruce"), esto se manda entero al guardar en
  // el historial para poder liberarlos todos juntos después desde "Revisar".
  const [movIdsAdelantosSesion, setMovIdsAdelantosSesion] = useState<string[]>([]);
  const [movIdsCargasSesion, setMovIdsCargasSesion] = useState<string[]>([]);
  // Igual que arriba, pero para pagos reales (Enviar/Recibir) ya aplicados al ledger en esta
  // liquidación -- se manda al guardar/autoguardar para poder revertirlos si se borra
  // (28/09/2026, pedido de Leo: "cuando eliminamos una liquidación todo tiene que volver para
  // atrás"). pagoPendienteMovIds = pagos vía pagarRakebackPendiente (cierres nuevos);
  // pagoLedgerMovIds = pagos/cobros genéricos vía crearMovimiento PAGO/COBRO (cierres viejos).
  const [movIdsPagosPendienteSesion, setMovIdsPagosPendienteSesion] = useState<string[]>([]);
  const [movIdsPagosGenericoSesion, setMovIdsPagosGenericoSesion] = useState<string[]>([]);

  useEffect(() => {
    setSemanas([]);
    setData(null);
    const retomar = retomarRef.current;
    retomarRef.current = null;
    setWeekStart(retomar?.weekStart ?? "");
    const congelada = retomar?.estadoOriginal === "PAGADA" || retomar?.estadoOriginal === "CERRADA";
    setSoloRevision(congelada);
    setRevisandoId(congelada ? retomar!.id : null);
    setRevisandoEstado(congelada ? (retomar!.estadoOriginal as "PAGADA" | "CERRADA") : null);
    setReemplazarId(null);
    setMovIdsAdelantosSesion([]);
    setMovIdsCargasSesion([]);
    setMovIdsPagosPendienteSesion([]);
    setMovIdsPagosGenericoSesion([]);
    if (seleccionados.length === 0) return;
    api.semanasLiquidacion(seleccionados).then(setSemanas).catch(() => {});
    if (retomar) {
      setNombreGrupo(retomar.nombreGrupo);
    }
    // Ya NO se autocompleta el nombre con el del agente (29/09/2026, pedido de Leo: "ese
    // nombre no tiene que ser el de un Agente, se lo vamos a dar nosotros") -- el nombre se pone
    // a mano en el paso de "Armar liquidación", antes de elegir los agentes.
  }, [seleccionados]);

  // Vuelve a elegir ese mismo grupo de agentes + esa semana desde el historial -- para las
  // "Pendiente de pago", para terminar de definir cómo pagar; para las "Pagada", solo para
  // volver a verla o ajustarla sin que eso la marque como pendiente de nuevo.
  function retomarLiquidacionPendiente(h: any) {
    retomarRef.current = { weekStart: h.week_start, nombreGrupo: h.nombre_grupo, estadoOriginal: h.estado, id: h.id };
    restaurarRef.current = {
      adelantosAplicados: Number(h.adelantos_aplicados) || 0,
      adelantosManual: Number(h.adelantos_manual) || 0,
      cargasAplicadas: Number(h.cargas_aplicadas ?? 0) || 0,
      adelantoMovIds: h.adelanto_movement_ids ?? [],
      cargaMovIds: h.carga_movement_ids ?? [],
      pagoPendienteMovIds: h.pago_pendiente_movement_ids ?? [],
      pagoLedgerMovIds: h.pago_ledger_movement_ids ?? [],
      filas: h.filas ?? [],
      nota: h.nota ?? "",
    };
    setSeleccionados(h.agent_ids);
    setArmando(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // preservarAplicado=true después de aplicar un cruce: solo refresca los datos (pendientes
  // actualizados) sin resetear lo que ya se descontó en esta liquidación ni la nota/adelanto
  // manual — si no, el PDF terminaba mostrando "Adelantos a descontar: 0" después de aplicar
  // el cruce, porque se perdía el registro de lo recién consumido.
  function refrescarLiquidacion(preservarAplicado = false) {
    if (seleccionados.length === 0 || !weekStart) return;
    setError("");
    setCargando(true);
    api
      .liquidacion(seleccionados, weekStart)
      .then((d) => {
        setData(d);
        setModalCruce(null);
        setGuardado(false);
        setMovAbierto(null);
        setMovMsg(null);
        const restaurar = restaurarRef.current;
        restaurarRef.current = null;
        if (restaurar) {
          // Retomando una liquidación ya guardada -- reponer lo que ya se había aplicado/
          // tipeado antes, en vez de arrancar de cero (ver nota en restaurarRef más arriba).
          setAplicado(restaurar.adelantosAplicados);
          setAplicadoCarga(restaurar.cargasAplicadas);
          setAdelantosManual(restaurar.adelantosManual);
          setMovIdsAdelantosSesion(restaurar.adelantoMovIds);
          setMovIdsCargasSesion(restaurar.cargaMovIds);
          setMovIdsPagosPendienteSesion(restaurar.pagoPendienteMovIds);
          setMovIdsPagosGenericoSesion(restaurar.pagoLedgerMovIds);
          setNota(restaurar.nota);
          const ventas: Record<string, number> = {};
          const tickets: Record<string, number> = {};
          for (const f of restaurar.filas) {
            const key = filaKey(f);
            if (Number(f.ventas)) ventas[key] = Number(f.ventas);
            if (Number(f.tickets)) tickets[key] = Number(f.tickets);
          }
          setVentasPorFila(ventas);
          setTicketsPorFila(tickets);
          setUltimoCruceAdelantos(null);
          setUltimoCruceCargas(null);
        } else if (!preservarAplicado) {
          setAplicado(0);
          setAplicadoCarga(0);
          setAdelantosManual(0);
          setVentasPorFila({});
          setTicketsPorFila({});
          setUltimoCruceAdelantos(null);
          setUltimoCruceCargas(null);
          if (seleccionados.length === 1) setNota("");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }

  useEffect(() => {
    refrescarLiquidacion(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionados.join(","), weekStart]);

  // Confirmar antes de arrancar la liquidación (28/09/2026, pedido de Leo: "antes de que se
  // guarden solas quiero que al momento de seleccionar los agentes a combinar te aparezca para
  // comenzar la liquidación y cuando le das ok que se guarde") -- hasta acá, apenas se elegía la
  // semana ya arrancaba solo el cálculo y, 1s después, el autoguardado (ver más abajo), sin que
  // nadie confirmara nada. Elegir la semana es el momento real en que "arranca" la liquidación
  // (antes de eso no hay nada que calcular ni guardar) -- por eso el gate va acá: recién si se
  // confirma se fija weekStart, que es lo que dispara el cálculo + autoguardado de arriba. Si se
  // cancela, el <select> vuelve solo a mostrar el valor anterior (no cambió el estado).
  // BUG REAL (29/09/2026, pedido de Leo: "hay varios cruces que están mal realizados") --
  // hasta acá, esto SOLO restauraba lo ya aplicado (aplicado/aplicadoCarga/movIds) cuando se
  // entraba por el botón "Retomar" del historial (ver retomarLiquidacionPendiente). Si en vez de
  // eso alguien volvía a tildar los MISMOS agentes a mano y elegía la MISMA semana (que ya tenía
  // un borrador con cruces aplicados), el estado local arrancaba en 0 igual -- y 1s después el
  // autoguardado mandaba adelantoMovIds/cargaMovIds/pagoMovIds VACÍOS, pisando los que ya
  // estaban guardados en esa fila. El cruce seguía consumido de verdad en la base (eso no se
  // pierde), pero la liquidación se quedaba sin forma de saber que ese cruce era suyo -- "Liberar
  // cruces" y "Eliminar" ya no lo encontraban, y el total "adelantos aplicados" de esa fila
  // arrancaba de nuevo en 0 en vez de sumar lo de antes. Ahora, elegir la semana busca primero si
  // YA hay una fila guardada (historial ya está cargado en memoria) para este mismo grupo+semana
  // -- si la hay, la restaura igual que "Retomar", sin que haga falta pasar por el historial.
  function elegirSemana(value: string) {
    if (!value) {
      setWeekStart("");
      return;
    }
    const semana = semanas.find((s) => s.week_start === value);
    const rango = semana ? `${dateShort(semana.week_start)} - ${dateShort(semana.week_end)}` : value;
    const key = [...seleccionados].sort().join(",");
    const existente = (historial ?? []).find((h: any) => h.grupo_key === key && h.week_start === value);
    const mensaje = existente
      ? `Ya hay una liquidación ${existente.estado === "PAGADA" ? '"Pagada"' : '"Pendiente de pago"'} guardada para "${nombreGrupo || "estos agentes"}" — semana ${rango}, con ${usd(Number(existente.adelantos_aplicados) + Number(existente.adelantos_manual) + Number(existente.cargas_aplicadas ?? 0))} ya descontado. ¿Retomarla (con lo que ya tenía aplicado, en vez de arrancar de cero)?`
      : `¿Comenzar la liquidación de "${nombreGrupo || "estos agentes"}" — semana ${rango}? Se va a calcular y guardar como borrador ("Pendiente de pago") hasta que se registre un pago de verdad.`;
    confirmDialog(mensaje).then((ok) => {
      if (!ok) return;
      if (existente) {
        restaurarRef.current = {
          adelantosAplicados: Number(existente.adelantos_aplicados) || 0,
          adelantosManual: Number(existente.adelantos_manual) || 0,
          cargasAplicadas: Number(existente.cargas_aplicadas ?? 0) || 0,
          adelantoMovIds: existente.adelanto_movement_ids ?? [],
          cargaMovIds: existente.carga_movement_ids ?? [],
          pagoPendienteMovIds: existente.pago_pendiente_movement_ids ?? [],
          pagoLedgerMovIds: existente.pago_ledger_movement_ids ?? [],
          filas: existente.filas ?? [],
          nota: existente.nota ?? "",
        };
        const congelada = existente.estado === "PAGADA" || existente.estado === "CERRADA";
        setSoloRevision(congelada);
        setRevisandoId(congelada ? existente.id : null);
        setRevisandoEstado(congelada ? existente.estado : null);
      }
      setWeekStart(value);
    });
  }

  // Eliminar UN pago puntual de "Historial de pagos de esta liquidación" (29/09/2026, pedido de
  // Leo: caso real de un pago que quedó huérfano -- su movimiento de ledger ya se había borrado
  // por otro lado antes, así que quedaba visible acá para siempre sin forma de sacarlo). Según
  // el tipo pega a un endpoint distinto (ver nota en repo/rakebackPendiente.ts): PAGO_FICHAS/
  // PAGO_USDT son pagos vía rakeback_pendiente (cierres nuevos), PAGO/COBRO son movimientos
  // genéricos del ledger (cierres viejos).
  async function eliminarPago(p: any) {
    if (
      !(await confirmDialog(
        `¿Eliminar este pago de ${usd(p.amount)} (${p.agentName})? Si el movimiento de ledger todavía existe, se revierte de verdad (vuelve a estar pendiente). Si ya no existía (huérfano), solo se saca de esta lista.`
      ))
    )
      return;
    setEliminandoPago(p.id);
    try {
      if (p.tipo === "PAGO_FICHAS" || p.tipo === "PAGO_USDT") {
        await api.eliminarPagoRakebackPendiente(p.id);
      } else {
        await api.eliminarMovimiento(p.id);
      }
      refrescarLiquidacion(true);
      refrescarHistorial();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar el pago.");
    } finally {
      setEliminandoPago(null);
    }
  }

  // Lo que ya se descuenta de verdad: cada cruce se aplica al toque desde su propio popup (ya
  // no queda nada "tildado pero todavía sin aplicar") + el manual.
  const totalDescontarAdelantos = aplicado + aplicadoCarga + adelantosManual;
  const totalVentasFilas = data ? data.filas.reduce((s: number, f: any) => s + (Number(ventasPorFila[filaKey(f)]) || 0), 0) : 0;
  const totalTicketsFilas = data ? data.filas.reduce((s: number, f: any) => s + (Number(ticketsPorFila[filaKey(f)]) || 0), 0) : 0;
  const totalVentasTickets = totalVentasFilas + totalTicketsFilas;
  const totalDescontar = totalDescontarAdelantos + totalVentasTickets;
  const totalAPagar = data ? data.total - totalDescontar : 0;
  // Filas con ventas/tickets ya pegados encima -- lo que de verdad se guarda/imprime, para que
  // el PDF y el historial conserven cuánto se le cargó a cada agente puntual.
  const filasConAjustes = data
    ? data.filas.map((f: any) => ({ ...f, ventas: Number(ventasPorFila[filaKey(f)]) || 0, tickets: Number(ticketsPorFila[filaKey(f)]) || 0 }))
    : [];

  // Autoguardado (24/09/2026, pedido de Leo): "vos elegís a los agentes a cerrar y hacés la
  // liquidación, cuando calculás eso debería quedar guardado" -- a veces no se sabe todavía cómo
  // va a querer cobrar el agente hasta que se le manda la liquidación. Apenas hay un cálculo
  // (data) para un grupo+semana, se guarda solo como borrador PENDIENTE -- debounced 1s para no
  // pegarle a la API en cada tecla mientras se completan ventas/tickets/nota. No reemplaza
  // "Guardar en historial" (esa sigue siendo la foto definitiva que el usuario confirma a mano).
  const autoguardadoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // soloRevision=true: esto se retomó desde una liquidación ya "Pagada" -- se puede mirar y
    // tocar, pero no autoguarda nada mientras tanto (si no, la marcaría "Pendiente" de nuevo).
    if (!data || seleccionados.length === 0 || !weekStart || soloRevision) return;
    if (autoguardadoTimer.current) clearTimeout(autoguardadoTimer.current);
    autoguardadoTimer.current = setTimeout(() => {
      api
        .autoguardarLiquidacion({
          nombreGrupo: nombreGrupo || "Liquidación",
          agentIds: seleccionados,
          weekStart: data.weekStart,
          weekEnd: data.weekEnd,
          filas: filasConAjustes,
          total: data.total,
          adelantosAplicados: aplicado,
          adelantosManual,
          cargasAplicadas: aplicadoCarga,
          totalAPagar,
          nota,
          adelantoMovIds: movIdsAdelantosSesion,
          cargaMovIds: movIdsCargasSesion,
          pagoPendienteMovIds: movIdsPagosPendienteSesion,
          pagoLedgerMovIds: movIdsPagosGenericoSesion,
        })
        .then(() => refrescarHistorial())
        .catch(() => {}); // best-effort -- nunca bloquea ni avisa nada al usuario
    }, 1000);
    return () => {
      if (autoguardadoTimer.current) clearTimeout(autoguardadoTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, seleccionados, weekStart, nombreGrupo, nota, adelantosManual, ventasPorFila, ticketsPorFila, aplicado, aplicadoCarga, movIdsAdelantosSesion, movIdsCargasSesion, movIdsPagosPendienteSesion, movIdsPagosGenericoSesion]);
  // Cuánto rakeback de esta semana queda todavía "libre" para cruzar (contra un adelanto O una
  // carga de tesorería — comparten el mismo "cupo", no tiene sentido consumirle a un agente más
  // de lo que este cierre efectivamente cubre entre las dos cosas juntas).
  const disponibleParaCruzar = Math.max(0, data ? data.total - aplicado - aplicadoCarga : 0);

  // Sugerencia de importe por fila para el pago en lote (22/09/2026: bug que encontró Leo --
  // antes esto sumaba el pendiente BRUTO de cada fila, sin restar lo que ya se descontó a nivel
  // liquidación por adelantos/cargas cruzados -- el total tildado daba más que "Total a pagar".
  // Acá primero se resta lo que SÍ se puede atribuir a una fila puntual (ventas/tickets de esa
  // fila), y lo que queda se escala PROPORCIONALMENTE entre todas las filas para que la suma
  // coincida con totalAPagar -- los adelantos son por agente (no por agente+club) y las cargas
  // no están necesariamente ligadas a este cierre, así que no hay forma de saber con certeza a
  // qué fila puntual "le tocó" ese descuento; repartirlo a prorrata es la mejor aproximación, y
  // de cualquier forma Leo puede ajustar cada importe a mano antes de confirmar.
  const sugerenciasPagoPorFila = useMemo(() => {
    const brutos: Record<string, number> = {};
    let totalBruto = 0;
    (data?.filas ?? []).forEach((f: any) => {
      const key = filaKey(f);
      const ventasTickets = (Number(ventasPorFila[key]) || 0) + (Number(ticketsPorFila[key]) || 0);
      const bruto =
        f && f.rakebackPendienteId && f.rakebackPendienteDisponible !== null
          ? Math.max(0, Number(f.rakebackPendienteDisponible) - ventasTickets)
          : Math.max(0, Math.abs(totalAPagar));
      brutos[key] = bruto;
      totalBruto += bruto;
    });
    const objetivo = Math.max(0, totalAPagar);
    const factor = totalBruto > 0 ? Math.min(1, objetivo / totalBruto) : 1;
    const sugerencias: Record<string, number> = {};
    Object.keys(brutos).forEach((key) => {
      sugerencias[key] = brutos[key] * factor;
    });
    return sugerencias;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ventasPorFila, ticketsPorFila, totalAPagar]);

  function montoSugeridoParaFila(f: any) {
    return (sugerenciasPagoPorFila[filaKey(f)] ?? 0).toFixed(2);
  }

  function abrirMov(tipo: "PAGO" | "COBRO") {
    setMovAbierto(tipo);
    setMovMsg(null);
    if (tipo === "PAGO") {
      // Arranca con todas las filas que tienen algo pendiente tildadas (importe/medio sugerido
      // por fila) -- Leo destilda las que no quiere pagar ahora, o ajusta importe/medio de
      // cualquiera antes de confirmar.
      const filas: Record<string, { checked: boolean; splits: { monto: string; medio: string }[] }> = {};
      (data?.filas ?? []).forEach((f: any) => {
        const monto = montoSugeridoParaFila(f);
        filas[filaKey(f)] = {
          checked: Number(monto) > 0,
          // Arranca con un solo split (mismo comportamiento de siempre) -- el botón "+" de la
          // tabla de abajo permite desdoblar el pago de esta fila en varios splits.
          splits: [
            {
              monto,
              // PREPAGO (24/09/2026, pedido de Leo -- caso real: tb prodigio25 y yAtt0r0 quedaron
              // con fichas de más porque esto arrancaba en "FICHAS" para cualquier agente): un
              // agente PREPAGO solo tiene fichas por lo que paga por adelantado, así que el default acá
              // NUNCA puede ser "FICHAS" para PREPAGO (el servidor además lo rechaza si se fuerza).
              medio: f.rakebackPendienteId ? (f.system === "PREPAGO" ? "USDT" : "FICHAS") : "SIN_TESORERIA",
            },
          ],
        };
      });
      setMovFilas(filas);
      return;
    }
    const primeraFila = data && data.filas.length > 0 ? data.filas[0] : null;
    setMovMonto(Math.abs(totalAPagar).toFixed(2));
    setMovMetodo("SIN_TESORERIA");
    if (primeraFila) {
      setMovAgenteClub(`${primeraFila.agentId}|${primeraFila.clubId}`);
    }
  }

  function actualizarMovFilaChecked(key: string, checked: boolean) {
    setMovFilas((prev) => ({ ...prev, [key]: { ...prev[key], checked } }));
  }

  // Desdoblar el pago de una fila en varios "splits" -- cada uno con su propio importe y medio,
  // todos contra el MISMO pendiente/agente+club de esa fila (24/09/2026, pedido de Leo: poder
  // enviar por ejemplo 1000 en USDT y el resto en fichas en el mismo click).
  function actualizarSplit(key: string, idx: number, patch: Partial<{ monto: string; medio: string }>) {
    setMovFilas((prev) => {
      const fila = prev[key];
      if (!fila) return prev;
      const splits = fila.splits.map((s, i) => (i === idx ? { ...s, ...patch } : s));
      return { ...prev, [key]: { ...fila, splits } };
    });
  }

  function agregarSplit(key: string, medioDefault: string) {
    setMovFilas((prev) => {
      const fila = prev[key];
      if (!fila) return prev;
      return { ...prev, [key]: { ...fila, splits: [...fila.splits, { monto: "", medio: medioDefault }] } };
    });
  }

  function quitarSplit(key: string, idx: number) {
    setMovFilas((prev) => {
      const fila = prev[key];
      if (!fila || fila.splits.length <= 1) return prev;
      return { ...prev, [key]: { ...fila, splits: fila.splits.filter((_, i) => i !== idx) } };
    });
  }

  function cambiarFilaMov(valor: string) {
    setMovAgenteClub(valor);
    if (movAbierto !== "PAGO") return;
    const [agentId, clubId] = valor.split("|");
    const fila = data?.filas.find((f: any) => f.agentId === agentId && f.clubId === clubId);
    setMovMonto(montoSugeridoParaFila(fila));
    setMovMetodo(fila?.rakebackPendienteId ? "FICHAS" : "SIN_TESORERIA");
  }

  async function registrarMov() {
    if (!movAbierto) return;

    if (movAbierto === "COBRO") {
      if (!movAgenteClub) return;
      const [agentId, clubId] = movAgenteClub.split("|");
      const monto = Number(movMonto);
      if (!(monto > 0)) return setMovMsg({ ok: false, text: "El importe tiene que ser mayor a 0." });
      if (movMetodo === "EFECTIVO" && !movCustodio.trim()) {
        return setMovMsg({ ok: false, text: "Un movimiento en efectivo requiere custodio (BIT-051/052)." });
      }
      setRegistrandoMov(true);
      setMovMsg(null);
      try {
        const r = await api.crearMovimiento({
          type: "COBRO",
          agentId,
          clubId,
          amount: monto,
          paymentMethod: movMetodo,
          custodian: movMetodo === "EFECTIVO" ? movCustodio.trim() : undefined,
          occurredAt: new Date().toISOString(),
          observation: movObservacion.trim() || `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
        });
        if (r?.id) setMovIdsPagosGenericoSesion((prev) => [...prev, r.id]);
        setMovMsg({ ok: true, text: "Cobro registrado y aplicado al ledger." });
        setMovObservacion("");
        if (seleccionados.length > 0 && weekStart) {
          const dataActualizada = await api.liquidacion(seleccionados, weekStart);
          setData(dataActualizada);
          // Ya se registró un movimiento real para este grupo+semana -- si había un
          // autoguardado PENDIENTE, queda resuelto (pedido de Leo: automático al registrar el pago).
          api.resolverLiquidacionPendiente(seleccionados, weekStart).then(refrescarHistorial).catch(() => {});
        }
      } catch (err: any) {
        setMovMsg({ ok: false, text: err.message || "No se pudo registrar el movimiento." });
      } finally {
        setRegistrandoMov(false);
      }
      return;
    }

    // PAGO en lote: todas las filas tildadas, cada una con su importe y medio propio. Si la
    // fila tiene su propia fila de rakeback pendiente (cierre nuevo, post-separación
    // stock/pendiente), paga DIRECTO contra esa fila -- Fichas mueve el stock (CARGA),
    // USDT/Efectivo/Zelle no (PAGO_RAKEBACK) -- en vez de un PAGO genérico que restaba del
    // stock sin saber que existía este pendiente (bug real que encontró Leo el 22/09/2026 con
    // triunfoepico). Los cierres viejos sin migrar (sin rakebackPendienteId) siguen con el
    // movimiento genérico de antes.
    const entradas = Object.entries(movFilas).filter(([, v]) => v.checked);
    if (entradas.length === 0) return setMovMsg({ ok: false, text: "Marcá al menos un agente." });
    for (const [, v] of entradas) {
      if (v.splits.length === 0 || v.splits.some((s) => !(Number(s.monto) > 0))) {
        return setMovMsg({ ok: false, text: "Todos los importes tildados tienen que ser mayores a 0." });
      }
    }
    const necesitaCustodio = entradas.some(([, v]) => v.splits.some((s) => s.medio === "EFECTIVO"));
    if (necesitaCustodio && !movCustodio.trim()) {
      return setMovMsg({ ok: false, text: "Un pago en efectivo requiere custodio (BIT-051/052)." });
    }

    setRegistrandoMov(true);
    setMovMsg(null);
    let exitos = 0;
    const errores: string[] = [];
    for (const [key, v] of entradas) {
      const fila = data?.filas.find((f: any) => filaKey(f) === key);
      if (!fila) continue;
      // Cada split de esta fila se manda como su propio movimiento -- así un mismo pendiente se
      // puede pagar en varios medios/importes a la vez (24/09/2026, pedido de Leo).
      for (const [idx, split] of v.splits.entries()) {
        try {
          if (fila.rakebackPendienteId) {
            const rp = await api.pagarRakebackPendiente({
              pendienteId: fila.rakebackPendienteId,
              amount: Number(split.monto),
              medio: split.medio as "FICHAS" | "USDT" | "EFECTIVO" | "ZELLE",
              custodian: split.medio === "EFECTIVO" ? movCustodio.trim() : undefined,
              notes: movObservacion.trim() || `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
            });
            if (rp?.movementRowId) setMovIdsPagosPendienteSesion((prev) => [...prev, rp.movementRowId]);
          } else {
            const rm = await api.crearMovimiento({
              type: "PAGO",
              agentId: fila.agentId,
              clubId: fila.clubId,
              amount: Number(split.monto),
              paymentMethod: split.medio,
              custodian: split.medio === "EFECTIVO" ? movCustodio.trim() : undefined,
              occurredAt: new Date().toISOString(),
              observation: movObservacion.trim() || `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
            });
            if (rm?.id) setMovIdsPagosGenericoSesion((prev) => [...prev, rm.id]);
          }
          exitos++;
        } catch (err: any) {
          const etiqueta = v.splits.length > 1 ? `${fila.agentName} (${fila.clubName}) — parte ${idx + 1}` : `${fila.agentName} (${fila.clubName})`;
          errores.push(`${etiqueta}: ${err.message || "error"}`);
        }
      }
    }
    setMovMsg(
      errores.length === 0
        ? { ok: true, text: `${exitos} pago${exitos === 1 ? "" : "s"} registrado${exitos === 1 ? "" : "s"}.` }
        : {
            ok: false,
            text: `${exitos} pago${exitos === 1 ? "" : "s"} registrado${exitos === 1 ? "" : "s"}, ${errores.length} con error — ${errores.join(" · ")}`,
          }
    );
    setMovObservacion("");
    if (seleccionados.length > 0 && weekStart) {
      const dataActualizada = await api.liquidacion(seleccionados, weekStart);
      setData(dataActualizada);
      if (exitos > 0) {
        // Mismo criterio que en COBRO -- al menos un pago se registró de verdad para este
        // grupo+semana, así que el autoguardado pendiente (si había) queda resuelto.
        api.resolverLiquidacionPendiente(seleccionados, weekStart).then(refrescarHistorial).catch(() => {});
      }
    }
    setRegistrandoMov(false);
  }

  // Abre el popup de cruce para UN adelanto/carga puntual -- sugiere por default el mismo monto
  // de antes (lo que efectivamente cubre esta liquidación, sin comerse el pendiente entero si es
  // mayor a lo que hay para cruzar), pero se puede cambiar a mano antes de confirmar.
  function abrirModalCruce(tipo: "ADELANTO" | "CARGA", item: any) {
    const sugerido = tipo === "ADELANTO" ? Math.min(item.pendiente, disponibleParaCruzar || item.pendiente) : item.pendiente;
    setModalCruce({ tipo, item, monto: String(sugerido > 0 ? sugerido : item.pendiente) });
  }

  // Confirma el cruce del popup -- se aplica de una, contra ESTA liquidación (la semana ya
  // elegida arriba, se muestra en el popup nada más que para confirmar). Mismo efecto real que
  // antes tenía "Aplicar cruce": ajustarAdelanto CONSUMO / consumirCarga.
  async function confirmarModalCruce() {
    if (!modalCruce) return;
    const monto = Math.min(Number(modalCruce.monto) || 0, modalCruce.item.pendiente);
    if (monto <= 0) return;
    setAplicando(true);
    try {
      if (modalCruce.tipo === "ADELANTO") {
        const r = await api.ajustarAdelanto({
          advanceId: modalCruce.item.id,
          type: "CONSUMO",
          amount: monto,
          notes: `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
        });
        const movIds = r?.movementRowId ? [r.movementRowId] : [];
        setAplicado((prev) => prev + monto);
        setUltimoCruceAdelantos({ movIds, monto });
        setMovIdsAdelantosSesion((prev) => [...prev, ...movIds]);
      } else {
        const r = await api.consumirCarga({
          cargaId: modalCruce.item.id,
          amount: monto,
          notes: `Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim(),
        });
        const movIds = r?.movementRowId ? [r.movementRowId] : [];
        setAplicadoCarga((prev) => prev + monto);
        setUltimoCruceCargas({ movIds, monto });
        setMovIdsCargasSesion((prev) => [...prev, ...movIds]);
      }
      setModalCruce(null);
      refrescarLiquidacion(true);
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo aplicar el cruce.");
    } finally {
      setAplicando(false);
    }
  }

  // Deshace el ÚLTIMO cruce aplicado (adelantos y/o cargas) en esta liquidación -- ver estado
  // ultimoCruceAdelantos/ultimoCruceCargas arriba. Sigue habiendo un límite real: si el mismo
  // adelanto/carga tuvo OTRO ajuste después (desde Adelantos, por ejemplo), el backend rechaza
  // ese movimiento puntual porque ya no es el más reciente -- ahí hay que ir a Adelantos/la
  // carga y deshacerlo en orden, del más nuevo hacia atrás.
  async function deshacerUltimoCruce() {
    if (!ultimoCruceAdelantos && !ultimoCruceCargas) return;
    const monto = (ultimoCruceAdelantos?.monto ?? 0) + (ultimoCruceCargas?.monto ?? 0);
    if (!(await confirmDialog(`¿Deshacer el último cruce aplicado (${usd(monto)})? El adelanto/carga vuelve a quedar pendiente como antes.`))) return;
    setDeshaciendoCruce(true);
    const errores: string[] = [];
    try {
      for (const id of ultimoCruceAdelantos?.movIds ?? []) {
        try {
          await api.eliminarMovimientoAdelanto(id);
        } catch (err: any) {
          errores.push(err.message || "No se pudo deshacer un cruce de adelanto.");
        }
      }
      for (const id of ultimoCruceCargas?.movIds ?? []) {
        try {
          await api.eliminarMovimientoCarga(id);
        } catch (err: any) {
          errores.push(err.message || "No se pudo deshacer un cruce de carga.");
        }
      }
      if (ultimoCruceAdelantos) setAplicado((prev) => Math.max(0, prev - ultimoCruceAdelantos.monto));
      if (ultimoCruceCargas) setAplicadoCarga((prev) => Math.max(0, prev - ultimoCruceCargas.monto));
      if (ultimoCruceAdelantos) {
        const idsDeshechos = new Set(ultimoCruceAdelantos.movIds);
        setMovIdsAdelantosSesion((prev) => prev.filter((id) => !idsDeshechos.has(id)));
      }
      if (ultimoCruceCargas) {
        const idsDeshechos = new Set(ultimoCruceCargas.movIds);
        setMovIdsCargasSesion((prev) => prev.filter((id) => !idsDeshechos.has(id)));
      }
      setUltimoCruceAdelantos(null);
      setUltimoCruceCargas(null);
      refrescarLiquidacion(true);
      if (errores.length > 0) await alertDialog(errores.join(" · "));
    } finally {
      setDeshaciendoCruce(false);
    }
  }

  // "Liberar cruces de esta liquidación" (23/09/2026 cont., pedido de Leo: poder rehacer una
  // liquidación ya Pagada y reusar el monto descontado): a diferencia de "Deshacer último
  // cruce" (que solo conoce la última tanda aplicada EN ESTA SESIÓN), esto le pide al backend
  // que deshaga TODOS los cruces que quedaron guardados junto a esta liquidación puntual (ver
  // adelanto_movement_ids/carga_movement_ids), sean de esta sesión o de una anterior. Solo
  // aparece revisando una liquidación ya "Pagada" (revisandoId). Después de liberar, la
  // liquidación queda como recién calculada -- se puede recruzar distinto -- y al guardarla de
  // nuevo pisa esta misma fila del historial en vez de duplicarla (reemplazarId).
  const [liberandoCruces, setLiberandoCruces] = useState(false);
  async function liberarCrucesLiquidacion() {
    if (!revisandoId) return;
    if (
      !(await confirmDialog(
        `Esto libera los adelantos/cargas que quedaron descontados por esta liquidación, para poder recalcularla y volver a cruzarlos distinto. Al guardar de nuevo, va a reemplazar esta misma fila del historial (sigue quedando como "Pagada"). ¿Confirmás?`
      ))
    )
      return;
    setLiberandoCruces(true);
    try {
      const r = await api.liberarCrucesLiquidacion(revisandoId);
      setReemplazarId(revisandoId);
      // soloRevision se queda en true a propósito -- sigue sin autoguardar solo (no queremos que
      // el recálculo cree un borrador PENDIENTE aparte): solo se confirma con "Guardar en
      // historial", que ahora va a pisar esta misma fila (reemplazarId).
      setAplicado(0);
      setAplicadoCarga(0);
      setUltimoCruceAdelantos(null);
      setUltimoCruceCargas(null);
      setMovIdsAdelantosSesion([]);
      setMovIdsCargasSesion([]);
      refrescarLiquidacion(false);
      if (r?.errores?.length > 0) {
        await alertDialog(`Se liberaron ${r.liberados} movimiento(s), pero hubo errores con algunos: ${r.errores.join(" · ")}`);
      }
    } catch (err: any) {
      await alertDialog(err.message || "No se pudieron liberar los cruces de esta liquidación.");
    } finally {
      setLiberandoCruces(false);
    }
  }

  // "Reabrir para editar" una liquidación Cerrada (29/09/2026, pedido de Leo): a diferencia de
  // "Liberar cruces" (que es solo para las Pagadas), acá NO se revierte ningún cruce -- los
  // adelantos/cargas que ya se descontaron mientras se armaba siguen consumidos de verdad. Solo
  // vuelve a Pendiente para que se pueda seguir tocando (autoguardándose sola de nuevo) antes de
  // mandar el pago.
  async function reabrirLiquidacionCerrada() {
    if (!revisandoId) return;
    if (!(await confirmDialog(`¿Reabrir esta liquidación para seguir editándola? Los adelantos/cargas que ya se cruzaron mientras se armaba siguen consumidos igual -- esto solo la vuelve a dejar como "Pendiente de pago" para poder tocar algo antes de mandar el pago.`))) return;
    setReabriendo(true);
    try {
      await api.reabrirLiquidacion(revisandoId);
      setSoloRevision(false);
      setRevisandoId(null);
      setRevisandoEstado(null);
      refrescarHistorial();
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo reabrir la liquidación.");
    } finally {
      setReabriendo(false);
    }
  }

  // Borrado real de una carga pendiente (ej. cargada de prueba, o al agente/club equivocado) --
  // no queda en historial, a diferencia de consumirla. Mismo criterio que "Eliminar" en Adelantos.
  async function eliminarCargaPendiente(cg: any) {
    if (!(await confirmDialog(`¿Eliminar la carga pendiente de ${cg.agentName} (${cg.clubName}) por ${usd(cg.pendiente)}? Esto la borra del todo (no queda en historial) -- para una carga que nunca debió existir. No se puede deshacer.`))) return;
    setBorrandoCarga(cg.id);
    try {
      await api.eliminarCarga(cg.id);
      refrescarLiquidacion(true);
    } catch (err: any) {
      await alertDialog(err.message || "No se pudo eliminar la carga.");
    } finally {
      setBorrandoCarga(null);
    }
  }

  return (
    <div>
      <h2>Liquidaciones</h2>
      <p className="muted" style={{ marginTop: -6, marginBottom: 18 }}>
        Resumen de rakeback por club de una semana puntual, listo para mandarle el pago. Se pueden combinar varios
        agentes de clubes distintos en una sola liquidación (ej. una misma persona con una identidad por club).
      </p>

      <div className="panel">
        {!armando ? (
          <button type="button" className="btn" onClick={() => setArmando(true)}>
            + Armar liquidación
          </button>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <div>
                <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                  Nombre del pago {seleccionados.length > 1 && "(varios agentes combinados)"}
                </label>
                <input
                  value={nombreGrupo}
                  onChange={(e) => setNombreGrupo(e.target.value)}
                  placeholder="Ej: Prodigio"
                  style={{ width: 220 }}
                  autoFocus
                />
              </div>
              <button type="button" className="btn secondary small" onClick={cancelarArmado}>
                Cancelar
              </button>
            </div>

            <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Agentes a combinar</label>
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Buscar agente..."
              style={{ width: "100%", maxWidth: 320, marginBottom: 8 }}
            />
            {seleccionados.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                {seleccionados.map((id) => {
                  const a = agentes.find((x) => x.id === id);
                  return (
                    <span
                      key={id}
                      className="badge neutral"
                      style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                      onClick={() => toggleAgente(id)}
                      title="Sacar de la liquidación"
                    >
                      {a ? a.name : id}
                      <span style={{ opacity: 0.6 }}>✕</span>
                    </span>
                  );
                })}
              </div>
            )}
            {agentesFiltrados.length > 0 && (
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <button type="button" className="btn secondary small" onClick={() => setSeleccionados((s) => [...new Set([...s, ...agentesFiltrados.map((a) => a.id)])])}>
                  Seleccionar todos
                </button>
                <button type="button" className="btn secondary small" onClick={() => setSeleccionados((s) => s.filter((id) => !agentesFiltrados.some((a) => a.id === id)))}>
                  Deseleccionar todos
                </button>
              </div>
            )}
            <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 8 }}>
              {agentesFiltrados.map((a) => (
                <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 4px", cursor: "pointer" }}>
                  <input type="checkbox" checked={seleccionados.includes(a.id)} onChange={() => toggleAgente(a.id)} />
                  {a.name}
                </label>
              ))}
              {agentesFiltrados.length === 0 && <div className="muted">Sin resultados.</div>}
            </div>

            {seleccionados.length > 0 && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
                <div>
                  <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>Fecha</label>
                  <select value={weekStart} onChange={(e) => elegirSemana(e.target.value)} disabled={semanas.length === 0}>
                    <option value="">{semanas.length === 0 ? "Sin cierres para estos agentes" : "Elegir semana..."}</option>
                    {semanas.map((s) => (
                      <option key={s.week_start} value={s.week_start}>
                        {dateShort(s.week_start)} - {dateShort(s.week_end)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
      {cargando && <div className="muted" style={{ marginTop: 14 }}>Cargando...</div>}

      {data && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="topbar" style={{ marginBottom: 14 }}>
            <div>
              <strong>{nombreGrupo || data.agentes.map((a: any) => a.name).join(" + ")}</strong>
              <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
                Cierre {dateShort(data.weekStart)} - {dateShort(data.weekEnd)}
              </span>
              {soloRevision && (
                <span
                  className={revisandoEstado === "PAGADA" ? "badge pos" : "badge neutral"}
                  style={{ marginLeft: 10 }}
                  title={
                    revisandoEstado === "PAGADA"
                      ? "Esto ya está Pagada -- se puede mirar/ajustar, pero no se autoguarda nada hasta que apretés Guardar"
                      : 'Esto está Cerrada -- armada y lista para elegir, pero todavía no se mandó ni recibió ningún pago. No se autoguarda nada hasta que la reabras o registres el pago.'
                  }
                >
                  Revisando · {revisandoEstado === "PAGADA" ? "Pagada" : "Cerrada"}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {soloRevision && revisandoId && revisandoEstado === "PAGADA" && (
                <button className="btn secondary small" disabled={liberandoCruces} onClick={liberarCrucesLiquidacion} title="Deshace los adelantos/cargas que quedaron descontados por esta liquidación puntual, para poder recalcularla y cruzarlos distinto">
                  {liberandoCruces ? "Liberando..." : "Liberar cruces de esta liquidación"}
                </button>
              )}
              {soloRevision && revisandoId && revisandoEstado === "CERRADA" && (
                <button className="btn secondary small" disabled={reabriendo} onClick={reabrirLiquidacionCerrada} title="La vuelve a Pendiente de pago para poder seguir editándola antes de mandar el pago">
                  {reabriendo ? "Reabriendo..." : "Reabrir para editar"}
                </button>
              )}
              {!soloRevision && (
                <button
                  className="btn secondary small"
                  disabled={cerrando}
                  onClick={async () => {
                    if (
                      !(await confirmDialog(
                        `¿Cerrar esta liquidación? Queda armada y guardada tal cual está ahora, SIN mandar ni recibir ningún pago -- listo para elegirla después desde el historial y recién ahí registrar el pago/cobro real. Se puede reabrir para editarla si hace falta corregir algo.`
                      ))
                    )
                      return;
                    setCerrando(true);
                    try {
                      const r = await api.guardarLiquidacion({
                        nombreGrupo: nombreGrupo || "Liquidación",
                        agentIds: seleccionados,
                        weekStart: data.weekStart,
                        weekEnd: data.weekEnd,
                        filas: filasConAjustes,
                        total: data.total,
                        adelantosAplicados: aplicado,
                        adelantosManual,
                        cargasAplicadas: aplicadoCarga,
                        totalAPagar,
                        nota,
                        adelantoMovIds: movIdsAdelantosSesion,
                        cargaMovIds: movIdsCargasSesion,
                        pagoPendienteMovIds: movIdsPagosPendienteSesion,
                        pagoLedgerMovIds: movIdsPagosGenericoSesion,
                        reemplazarId: reemplazarId ?? undefined,
                        cerrar: true,
                      });
                      setGuardado(true);
                      setReemplazarId(null);
                      // Se congela como si se hubiera retomado una Cerrada -- así el autoguardado
                      // no la vuelve a pisar como PENDIENTE un segundo después (ver nota en
                      // /liquidacion/guardar del backend).
                      setSoloRevision(true);
                      setRevisandoId(r.id);
                      setRevisandoEstado("CERRADA");
                      refrescarHistorial();
                    } catch (err: any) {
                      await alertDialog(err.message || "No se pudo cerrar la liquidación.");
                    } finally {
                      setCerrando(false);
                    }
                  }}
                  title="Arma y guarda la liquidación sin mandar ni recibir ningún pago todavía"
                >
                  {cerrando ? "Cerrando..." : "Cerrar liquidación"}
                </button>
              )}
              <button
                className="btn secondary small"
                disabled={guardando}
                onClick={async () => {
                  setGuardando(true);
                  try {
                    await api.guardarLiquidacion({
                      nombreGrupo: nombreGrupo || "Liquidación",
                      agentIds: seleccionados,
                      weekStart: data.weekStart,
                      weekEnd: data.weekEnd,
                      filas: filasConAjustes,
                      total: data.total,
                      adelantosAplicados: aplicado,
                      adelantosManual,
                      cargasAplicadas: aplicadoCarga,
                      totalAPagar,
                      nota,
                      adelantoMovIds: movIdsAdelantosSesion,
                      cargaMovIds: movIdsCargasSesion,
                      pagoPendienteMovIds: movIdsPagosPendienteSesion,
                      pagoLedgerMovIds: movIdsPagosGenericoSesion,
                      reemplazarId: reemplazarId ?? undefined,
                    });
                    setGuardado(true);
                    setReemplazarId(null);
                    refrescarHistorial();
                  } catch (err: any) {
                    await alertDialog(err.message || "No se pudo guardar la liquidación.");
                  } finally {
                    setGuardando(false);
                  }
                }}
                title="Deja esta liquidación guardada en el historial de abajo, tal cual está ahora"
              >
                {guardando ? "Guardando..." : guardado ? "✓ Guardada" : "Guardar en historial"}
              </button>
              <button
                className="btn secondary small"
                disabled={generandoPdf}
                onClick={async () => {
                  setGenerandoPdf(true);
                  try {
                    await generarPdf({
                      nombreGrupo: nombreGrupo || "Liquidación",
                      weekStart: data.weekStart,
                      weekEnd: data.weekEnd,
                      filas: filasConAjustes,
                      multiAgente: data.agentes.length > 1,
                      total: data.total,
                      adelantosAplicados: aplicado,
                      adelantosManual,
                      cargasAplicadas: aplicadoCarga,
                      ventasTickets: totalVentasTickets,
                      nota,
                    });
                  } catch (err: any) {
                    await alertDialog(err.message || "No se pudo generar el PDF.");
                  } finally {
                    setGenerandoPdf(false);
                  }
                }}
              >
                {generandoPdf ? "Generando..." : "Descargar PDF"}
              </button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Club</th>
                {data.agentes.length > 1 && <th>Agente</th>}
                <th>Ganancias/Pérdidas</th>
                <th>Rake</th>
                <th>Rakeback bruto</th>
                <th>Rebate</th>
                <th>Rakeback neto</th>
                <th>Rakeback pendiente</th>
                <th>Ventas</th>
                <th>Tickets</th>
              </tr>
            </thead>
            <tbody>
              {data.filas.map((f: any) => {
                const key = filaKey(f);
                return (
                  <tr key={key}>
                    <td>{f.clubName}</td>
                    {data.agentes.length > 1 && <td className="muted">{f.agentName}</td>}
                    <td className={Number(f.resultado) >= 0 ? "pos" : "neg"}>{usd(f.resultado)}</td>
                    <td>{usd(f.rakeTotal)}</td>
                    <td>{usd(f.rakebackBruto)}</td>
                    <td>{usd(f.rebate)}</td>
                    <td><strong>{usd(f.rakebackNeto)}</strong></td>
                    <td className="muted" title={f.rakebackPendienteId ? "Lo que todavía no se pagó de esta fila -- pagalo con el botón \"Enviar\" de abajo." : "Cierre viejo (de antes de separar el stock del rakeback pendiente) -- no tiene fila propia acá."}>
                      {f.rakebackPendienteId ? usd(f.rakebackPendienteDisponible) : "—"}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={ventasPorFila[key] ?? ""}
                        placeholder="0"
                        onChange={(e) => {
                          setGuardado(false);
                          const v = Number(e.target.value) || 0;
                          setVentasPorFila((prev) => ({ ...prev, [key]: v }));
                        }}
                        style={{ width: 90, textAlign: "right" }}
                        title={`Ventas cargadas solo a ${f.agentName} (${f.clubName}) -- se descuenta de su parte, no de toda la liquidación.`}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        value={ticketsPorFila[key] ?? ""}
                        placeholder="0"
                        onChange={(e) => {
                          setGuardado(false);
                          const v = Number(e.target.value) || 0;
                          setTicketsPorFila((prev) => ({ ...prev, [key]: v }));
                        }}
                        style={{ width: 90, textAlign: "right" }}
                        title={`Tickets promocionales cargados solo a ${f.agentName} (${f.clubName}) -- se descuenta de su parte, no de toda la liquidación.`}
                      />
                    </td>
                  </tr>
                );
              })}
              <tr style={{ fontWeight: 700 }}>
                <td>TOTAL</td>
                {data.agentes.length > 1 && <td></td>}
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td>{usd(data.total)}</td>
                <td>{usd(data.filas.reduce((s: number, f: any) => s + (f.rakebackPendienteId ? Number(f.rakebackPendienteDisponible) : 0), 0))}</td>
                <td>{usd(totalVentasFilas)}</td>
                <td>{usd(totalTicketsFilas)}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
            <h3 style={{ marginTop: 0 }}>Cruzar adelantos pendientes</h3>
            {data.adelantos.length > 0 && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Disponible para cruzar en esta liquidación: {usd(disponibleParaCruzar)} (no se propone cruzar más que esto por
                default, aunque el adelanto tenga más pendiente — se puede subir a mano si hace falta).
              </div>
            )}
            {data.adelantos.length === 0 ? (
              <div className="muted">Sin adelantos activos para estos agentes.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.adelantos.map((a: any) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ minWidth: 260 }}>
                      {a.agentName}{a.clubOrigenName ? ` (${a.clubOrigenName})` : ""} — pendiente {usd(a.pendiente)}
                      {a.createdAt && <span className="muted"> ({dateShort(a.createdAt)})</span>}
                    </span>
                    <button type="button" className="btn secondary small" onClick={() => abrirModalCruce("ADELANTO", a)}>
                      Cruzar
                    </button>
                  </div>
                ))}
                <div className="muted" style={{ fontSize: 12 }}>
                  Esto consume de verdad el adelanto (mismo efecto que "Consumo" en Adelantos) -- al confirmar en el popup.
                </div>
              </div>
            )}

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <h3 style={{ marginTop: 0 }}>Cruzar cargas de tesorería pendientes</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Fichas/USD que ya se le cargaron a este agente en este club (ver "Cargar Movimiento", tipo CARGA) y todavía
                no se descontaron de ninguna liquidación.
              </div>
              {data.cargas.length === 0 ? (
                <div className="muted">Sin cargas de tesorería pendientes para estos agentes/clubes.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {data.cargas.map((cg: any) => (
                    <div key={cg.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ minWidth: 260, flex: 1 }}>
                        {cg.agentName} ({cg.clubName}) — pendiente {usd(cg.pendiente)}
                        {cg.createdAt && <span className="muted"> ({dateShort(cg.createdAt)})</span>}
                      </span>
                      <button type="button" className="btn secondary small" onClick={() => abrirModalCruce("CARGA", cg)}>
                        Cruzar
                      </button>
                      <button
                        type="button"
                        className="btn secondary small"
                        disabled={borrandoCarga === cg.id}
                        onClick={() => eliminarCargaPendiente(cg)}
                        title="Borrado real — no queda en el historial. Para una carga que nunca debió cargarse (ej. de prueba)."
                        style={{ color: "var(--danger, #e5484d)" }}
                      >
                        {borrandoCarga === cg.id ? "..." : "Eliminar"}
                      </button>
                    </div>
                  ))}
                  <div className="muted" style={{ fontSize: 12 }}>
                    Esto consume de verdad la carga (mismo efecto que "Consumo" en cargas de tesorería) -- al confirmar en el popup.
                  </div>
                </div>
              )}
              {(ultimoCruceAdelantos || ultimoCruceCargas) && (
                <div style={{ marginTop: 10 }}>
                  <button className="btn secondary small" disabled={deshaciendoCruce} onClick={deshacerUltimoCruce}>
                    {deshaciendoCruce
                      ? "Deshaciendo..."
                      : `Deshacer último cruce (${usd((ultimoCruceAdelantos?.monto ?? 0) + (ultimoCruceCargas?.monto ?? 0))})`}
                  </button>
                  <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
                    Vuelve el/los adelanto(s) o carga(s) a como estaban antes de aplicar el último cruce.
                  </span>
                </div>
              )}
            </div>

            <div style={{ marginTop: 16 }}>
              <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                Adicional manual a descontar (ej. adelanto todavía no registrado en el sistema)
              </label>
              <input
                type="number"
                step="0.01"
                // value={adelantosManual} directo mostraba "0" fijo en el campo -- para escribir
                // un monto había que borrar ese 0 a mano primero (el "bug del 0"). Mostrando ""
                // cuando el valor es 0 (el default) se puede tipear directo.
                value={adelantosManual === 0 ? "" : adelantosManual}
                onChange={(e) => {
                  setAdelantosManual(Number(e.target.value) || 0);
                  setGuardado(false);
                }}
                style={{ width: 150 }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 420, marginTop: 16 }}>
              <div className="topbar" style={{ margin: 0 }}>
                <span className="muted">Rakeback / comisiones finales</span>
                <span>{usd(data.total)}</span>
              </div>
              <div className="topbar" style={{ margin: 0 }}>
                <span className="muted">Adelantos + cargas a descontar</span>
                <span>-{usd(totalDescontarAdelantos)}</span>
              </div>
              {totalVentasTickets !== 0 && (
                <div className="topbar" style={{ margin: 0 }}>
                  <span className="muted">Ventas + tickets (por agente) a descontar</span>
                  <span>-{usd(totalVentasTickets)}</span>
                </div>
              )}
              <div className="topbar" style={{ margin: 0, fontWeight: 700, fontSize: 16, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
                <span>Total a pagar</span>
                <span className={totalAPagar >= 0 ? "pos" : "neg"}>{usd(totalAPagar)}</span>
              </div>
            </div>

            {data.pagos && data.pagos.length > 0 && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                <h3 style={{ marginTop: 0 }}>Historial de pagos de esta liquidación</h3>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Pagos/cobros ya registrados de verdad (ledger) para estos agentes en esta semana — a dónde fueron y con qué medio.
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th><th>Agente</th><th>Club</th><th>Tipo</th><th>Medio</th><th>Importe</th><th>Observación</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pagos.map((p: any) => (
                      <tr key={p.id}>
                        <td className="muted">{dateShort(p.occurredAt)}</td>
                        <td>{p.agentName}</td>
                        <td>{p.clubName}</td>
                        <td>{etiquetaTipoPago(p.tipo)}</td>
                        <td>
                          {etiquetaMedioPago(p.medio)}
                          {p.custodian && <span className="muted"> ({p.custodian})</span>}
                        </td>
                        <td className={p.tipo === "COBRO" ? "money neg" : "money pos"}>{usd(p.amount)}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{p.observation || "-"}</td>
                        <td>
                          <button
                            type="button"
                            className="btn danger small"
                            disabled={eliminandoPago === p.id}
                            onClick={() => eliminarPago(p)}
                            title="Eliminar este pago"
                          >
                            {eliminandoPago === p.id ? "..." : "Eliminar"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" className="btn" onClick={() => abrirMov("PAGO")}>
                Enviar (pagarle al agente)
              </button>
              <button type="button" className="btn" onClick={() => abrirMov("COBRO")}>
                Recibir (el agente nos debe)
              </button>
            </div>

            {movAbierto === "PAGO" && (
              <div className="panel" style={{ marginTop: 10, maxWidth: 620 }}>
                <h4 style={{ marginTop: 0 }}>Registrar pago al agente</h4>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Tildá una o varias filas y mandalas juntas en un click — cada una con su propio importe y
                  medio (Fichas mueve el stock físico de ese club, USDT/Efectivo/Zelle es un pago financiero
                  que no lo toca). Es independiente de "Guardar en historial": podés enviar sin guardar, o
                  guardar sin enviar.
                </div>
                <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => setMovFilas((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, checked: true }])))}
                  >
                    Marcar todos
                  </button>
                  <button
                    type="button"
                    className="btn secondary small"
                    onClick={() => setMovFilas((prev) => Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, { ...v, checked: false }])))}
                  >
                    Ninguno
                  </button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Agente / club</th>
                      <th>Importe (USD)</th>
                      <th>Medio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.filas.map((f: any) => {
                      const key = filaKey(f);
                      const v = movFilas[key] ?? { checked: false, splits: [{ monto: "0", medio: "SIN_TESORERIA" }] };
                      const medioDefault = f.rakebackPendienteId ? (f.system === "PREPAGO" ? "USDT" : "FICHAS") : "SIN_TESORERIA";
                      const opcionesMedio = f.rakebackPendienteId ? (
                        <>
                          {/* Fichas SÍ está disponible para PREPAGO (24/09/2026, pedido de Leo:
                              "falto poder cargar fichas" -- pagar el pendiente en fichas es un
                              adelanto válido, igual que un Adelanto de rakeback). Lo único que
                              nunca hace es venir tildado por defecto para PREPAGO -- ver
                              abrirMov() más arriba -- así no se repite el bug del 22/09/2026
                              (tb prodigio25/yAtt0r0 con fichas de más por un default sin elegir). */}
                          <option value="FICHAS">
                            {f.system === "PREPAGO" ? "Fichas (adelanto -- suma stock)" : "Fichas (mueve el stock)"}
                          </option>
                          <option value="USDT">USDT</option>
                          <option value="EFECTIVO">Efectivo</option>
                          <option value="ZELLE">Zelle</option>
                        </>
                      ) : (
                        <>
                          <option value="SIN_TESORERIA">Sin tesorería</option>
                          <option value="USDT">USDT</option>
                          <option value="EFECTIVO">Efectivo</option>
                          <option value="ZELLE">Zelle</option>
                          <option value="OTRO">Otro</option>
                        </>
                      );
                      // Desdoblar en varios pagos/medios (24/09/2026, pedido de Leo -- ej. "enviar
                      // 1000 usdt y 541.64 en fichas"): un renglón por split, todos contra el
                      // mismo agente+club/pendiente -- el checkbox y el nombre solo se muestran
                      // en el primer renglón de la fila, "+" agrega otro split y "×" saca uno de
                      // más (nunca el único que queda).
                      return v.splits.map((split, idx) => (
                        <tr key={`${key}:${idx}`}>
                          <td>
                            {idx === 0 && (
                              <input
                                type="checkbox"
                                checked={v.checked}
                                onChange={(e) => actualizarMovFilaChecked(key, e.target.checked)}
                              />
                            )}
                          </td>
                          <td>
                            {idx === 0 && (
                              <>
                                {f.agentName} — {f.clubName}
                                {f.rakebackPendienteId && (
                                  <div className="muted" style={{ fontSize: 11 }}>
                                    Pendiente: {usd(f.rakebackPendienteDisponible)}
                                  </div>
                                )}
                              </>
                            )}
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              value={split.monto}
                              disabled={!v.checked}
                              onChange={(e) => actualizarSplit(key, idx, { monto: e.target.value })}
                              style={{ width: 110 }}
                            />
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              <select
                                value={split.medio}
                                disabled={!v.checked}
                                onChange={(e) => actualizarSplit(key, idx, { medio: e.target.value })}
                              >
                                {opcionesMedio}
                              </select>
                              {idx === v.splits.length - 1 && (
                                <button
                                  type="button"
                                  className="btn secondary small"
                                  title="Desdoblar este pago en otro medio/importe"
                                  disabled={!v.checked}
                                  onClick={() => agregarSplit(key, medioDefault)}
                                >
                                  +
                                </button>
                              )}
                              {v.splits.length > 1 && (
                                <button
                                  type="button"
                                  className="btn secondary small"
                                  title="Sacar este renglón"
                                  disabled={!v.checked}
                                  onClick={() => quitarSplit(key, idx)}
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ));
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td></td>
                      <td><strong>Total tildado</strong></td>
                      <td colSpan={2}>
                        <strong>
                          {usd(
                            Object.values(movFilas).reduce(
                              (s, v) => s + (v.checked ? v.splits.reduce((s2, sp) => s2 + (Number(sp.monto) || 0), 0) : 0),
                              0
                            )
                          )}
                        </strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
                {Object.values(movFilas).some((v) => v.checked && v.splits.some((s) => s.medio === "EFECTIVO")) && (
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Custodio del efectivo (aplica a todas las filas en efectivo)</label>
                    <input value={movCustodio} onChange={(e) => setMovCustodio(e.target.value)} placeholder="Quién tiene la plata físicamente" />
                  </div>
                )}
                <div className="field" style={{ marginTop: 10 }}>
                  <label>Observación (opcional, se usa en todas las filas)</label>
                  <input
                    value={movObservacion}
                    onChange={(e) => setMovObservacion(e.target.value)}
                    placeholder={`Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim()}
                  />
                </div>
                {movMsg && <div className={movMsg.ok ? "success" : "error"}>{movMsg.text}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button type="button" className="btn" disabled={registrandoMov} onClick={registrarMov}>
                    {registrandoMov ? "Registrando..." : "Confirmar pago(s)"}
                  </button>
                  <button type="button" className="btn secondary" onClick={() => setMovAbierto(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {movAbierto === "COBRO" && (
              <div className="panel" style={{ marginTop: 10, maxWidth: 460 }}>
                <h4 style={{ marginTop: 0 }}>Registrar cobro al agente</h4>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  Esto registra un movimiento real de COBRO contra la wallet (mismo efecto que cargarlo en
                  "Cargar movimiento"). Es independiente de "Guardar en historial": podés recibir sin
                  guardar, o guardar sin recibir.
                </div>
                <div className="field">
                  <label>Agente + club</label>
                  <select value={movAgenteClub} onChange={(e) => cambiarFilaMov(e.target.value)}>
                    {data.filas.map((f: any) => (
                      <option key={`${f.agentId}|${f.clubId}`} value={`${f.agentId}|${f.clubId}`}>
                        {f.agentName} — {f.clubName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Importe (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={movMonto}
                    onChange={(e) => setMovMonto(e.target.value)}
                    style={{ width: 150 }}
                  />
                </div>
                <div className="field">
                  <label>Medio de pago</label>
                  <select value={movMetodo} onChange={(e) => setMovMetodo(e.target.value)}>
                    <option value="SIN_TESORERIA">Sin tesorería (interno)</option>
                    <option value="USDT">USDT</option>
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="ZELLE">Zelle</option>
                    <option value="OTRO">Otro</option>
                  </select>
                </div>
                {movMetodo === "EFECTIVO" && (
                  <div className="field">
                    <label>Custodio del efectivo</label>
                    <input value={movCustodio} onChange={(e) => setMovCustodio(e.target.value)} placeholder="Quién tiene la plata físicamente" />
                  </div>
                )}
                <div className="field">
                  <label>Observación (opcional)</label>
                  <input
                    value={movObservacion}
                    onChange={(e) => setMovObservacion(e.target.value)}
                    placeholder={`Liquidación ${nombreGrupo || ""} — cierre ${weekStart}`.trim()}
                  />
                </div>
                {movMsg && <div className={movMsg.ok ? "success" : "error"}>{movMsg.text}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn" disabled={registrandoMov} onClick={registrarMov}>
                    {registrandoMov ? "Registrando..." : "Confirmar cobro"}
                  </button>
                  <button type="button" className="btn secondary" onClick={() => setMovAbierto(null)}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 14 }}>
              <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                Nota (aclaraciones de conversión de moneda, etc. — se incluye en el PDF)
              </label>
              <textarea
                value={nota}
                onChange={(e) => {
                  setNota(e.target.value);
                  setGuardado(false);
                }}
                rows={2}
                style={{ width: "100%", resize: "vertical" }}
                placeholder="Ej: rakeback bruto calculado con el rate de la semana; ver diferencia de TWD al momento del pago."
              />
            </div>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Historial de liquidaciones</h3>
        {!historial ? (
          <div className="muted">Cargando...</div>
        ) : historial.length === 0 ? (
          <div className="muted">Todavía no se guardó ninguna liquidación.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Fecha</th><th>Estado</th><th>Nombre</th><th>Semana</th><th>Rakeback total</th>
                <th>Descontado</th><th>Total pagado</th><th></th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id}>
                  <td className="muted">{dateShort(h.created_at)}</td>
                  <td>
                    {h.estado === "PENDIENTE" ? (
                      <span className="badge neg" title="Se calculó pero todavía no se registró ningún pago ni cobro para este grupo/semana">Pendiente de pago</span>
                    ) : h.estado === "CERRADA" ? (
                      <span className="badge neutral" title="Armada y guardada, pero todavía no se mandó ni recibió ningún pago -- elegila para recién ahí pagar">Cerrada</span>
                    ) : (
                      <span className="badge pos">Pagada</span>
                    )}
                  </td>
                  <td>{h.nombre_grupo}</td>
                  <td className="muted">{dateShort(h.week_start)} - {dateShort(h.week_end)}</td>
                  <td>{usd(h.total)}</td>
                  <td>-{usd(Number(h.adelantos_aplicados) + Number(h.adelantos_manual) + Number(h.cargas_aplicadas ?? 0) + (h.filas || []).reduce((s: number, f: any) => s + (Number(f.ventas) || 0) + (Number(f.tickets) || 0), 0))}</td>
                  <td><strong>{usd(h.total_a_pagar)}</strong></td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <button className="btn small" onClick={() => retomarLiquidacionPendiente(h)}>
                      {h.estado === "PENDIENTE" ? "Retomar" : h.estado === "CERRADA" ? "Retomar para pagar" : "Revisar"}
                    </button>
                    <button
                      className="btn secondary small"
                      onClick={() =>
                        generarPdf({
                          nombreGrupo: h.nombre_grupo,
                          weekStart: h.week_start,
                          weekEnd: h.week_end,
                          filas: h.filas,
                          multiAgente: h.agent_ids.length > 1,
                          total: Number(h.total),
                          adelantosAplicados: Number(h.adelantos_aplicados),
                          adelantosManual: Number(h.adelantos_manual),
                          cargasAplicadas: Number(h.cargas_aplicadas ?? 0),
                          ventasTickets: (h.filas || []).reduce((s: number, f: any) => s + (Number(f.ventas) || 0) + (Number(f.tickets) || 0), 0),
                          nota: h.nota || "",
                        }).catch((err: any) => alertDialog(err.message || "No se pudo generar el PDF."))
                      }
                    >
                      Descargar PDF
                    </button>
                    <button
                      className="btn danger small"
                      disabled={borrandoHist === h.id}
                      onClick={async () => {
                        if (!(await confirmDialog(`¿Eliminar del historial la liquidación de "${h.nombre_grupo}" (${dateShort(h.week_start)})? Esto borra el registro/foto Y revierte los cruces de adelantos/cargas Y los pagos reales (Enviar/Recibir) que se hayan aplicado en esta liquidación puntual — no toca ningún cierre.`))) return;
                        setBorrandoHist(h.id);
                        try {
                          const r = await api.eliminarLiquidacionGuardada(h.id);
                          const erroresTotales = [...(r?.cruces?.errores ?? []), ...(r?.pagos?.errores ?? [])];
                          if (erroresTotales.length > 0) {
                            await alertDialog(
                              `Se borró la liquidación. Se revirtieron ${r?.cruces?.liberados ?? 0} cruce(s) y ${r?.pagos?.revertidos ?? 0} pago(s), pero ${erroresTotales.length} no se pudieron deshacer (revisalos a mano en Adelantos/Movimientos/Liquidaciones):\n\n${erroresTotales.join("\n")}`
                            );
                          }
                          refrescarHistorial();
                        } catch (err: any) {
                          await alertDialog(err.message || "No se pudo eliminar.");
                        } finally {
                          setBorrandoHist(null);
                        }
                      }}
                    >
                      {borrandoHist === h.id ? "..." : "Eliminar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalCruce && data && (
        <Modal
          title={`Cruzar ${modalCruce.tipo === "ADELANTO" ? "adelanto" : "carga de tesorería"}`}
          onClose={() => !aplicando && setModalCruce(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <strong>{modalCruce.item.agentName}</strong>
              {(modalCruce.item.clubOrigenName || modalCruce.item.clubName) && (
                <span className="muted"> ({modalCruce.item.clubOrigenName || modalCruce.item.clubName})</span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              Semana de esta liquidación: {dateShort(data.weekStart)} - {dateShort(data.weekEnd)}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              Pendiente: {usd(modalCruce.item.pendiente)}
            </div>
            <div>
              <label className="muted" style={{ display: "block", fontSize: 12, marginBottom: 4 }}>
                Monto a cruzar contra esta semana
              </label>
              <input
                type="number"
                step="0.01"
                min={0}
                max={modalCruce.item.pendiente}
                autoFocus
                value={modalCruce.monto}
                onChange={(e) => setModalCruce((prev) => (prev ? { ...prev, monto: e.target.value } : prev))}
                style={{ width: 140, textAlign: "right" }}
              />
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              Esto consume de verdad el {modalCruce.tipo === "ADELANTO" ? "adelanto" : "la carga"} (mismo efecto que "Consumo" en{" "}
              {modalCruce.tipo === "ADELANTO" ? "Adelantos" : "cargas de tesorería"}). Se puede deshacer con "Deshacer último
              cruce" mientras no se aplique nada más encima.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
              <button className="btn secondary small" disabled={aplicando} onClick={() => setModalCruce(null)}>
                Cancelar
              </button>
              <button
                className="btn small"
                disabled={aplicando || (Number(modalCruce.monto) || 0) <= 0}
                onClick={confirmarModalCruce}
              >
                {aplicando ? "Aplicando..." : "Confirmar cruce"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
