const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export type AccountType = "PREPAGO" | "WIN_LOSE" | "BANCADO" | "INTERNO" | "SUPERVISOR" | "UNION";

function getToken() {
  return localStorage.getItem("dp_token");
}

async function request(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? (typeof body.error === "string" ? body.error : JSON.stringify(body.error)) : `Error ${res.status}`);
  }
  return res.json();
}

// Igual que request(), pero sin forzar Content-Type: application/json — lo necesita el
// importador de cierres, que sube un archivo como multipart/form-data (el browser arma el
// boundary del Content-Type solo; si lo pisáramos con json el multer del backend no lo lee).
async function requestForm(path: string, form: FormData) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? (typeof body.error === "string" ? body.error : JSON.stringify(body.error)) : `Error ${res.status}`);
  }
  return res.json();
}

function idempotencyKey() {
  return `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const api = {
  login: (email: string, password: string) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  resumen: () => request("/dashboard/resumen"),
  cierres: (week?: string) => request(`/dashboard/cierres${week ? `?week=${week}` : ""}`),
  agentes: (includeInactive?: boolean) => request(`/dashboard/agentes${includeInactive ? "?includeInactive=true" : ""}`),
  agentDeals: (id: string) => request(`/dashboard/agentes/${id}/deals`),
  supervisores: () => request("/dashboard/supervisores"),
  comisionesReferidos: () => request("/dashboard/comisiones-referidos"),
  pagarComisionesReferido: (userId: string) => request(`/dashboard/comisiones-referidos/${userId}/pagar`, { method: "POST" }),
  bancados: () => request("/dashboard/bancados"),
  miCuenta: (agentId?: string) => request(`/portal/mi-cuenta${agentId ? `?agentId=${agentId}` : ""}`),
  // Qué agentes/clubes puede ver el login actual — para el selector en "Mi cuenta" cuando tiene
  // más de uno asociado (ver Usuarios y permisos → "Agentes/clubes que puede ver").
  misAgentes: () => request("/portal/mis-agentes"),
  // Vista del rol Supervisor: agentes a cargo + rakeback centralizado (placeholder mínimo
  // hasta tener las reglas de negocio completas del rol).
  miSupervision: () => request("/portal/mi-supervision"),
  // Comisión por referido de supervisor: agente referido + % sobre su rake semanal, auto-
  // acreditado en cada cierre. Cuelga del LOGIN (userId), no de la cuenta principal del
  // usuario — se gestiona desde Usuarios y permisos, dentro de la edición del usuario
  // Supervisor (ver PanelSupervisor en Usuarios.tsx).
  referidosDeSupervisor: (userId: string) => request(`/users/${userId}/referidos`),
  movimientosReferidos: (userId: string) => request(`/users/${userId}/referidos/movimientos`),
  eliminarMovimientoReferido: (movementId: string) => request(`/users/referidos/movimientos/${movementId}`, { method: "DELETE" }),
  crearReferido: (userId: string, data: { agenteReferidoId: string; porcentaje: number }) =>
    request(`/users/${userId}/referidos`, { method: "POST", body: JSON.stringify(data) }),
  actualizarReferido: (id: string, data: { porcentaje?: number; active?: boolean }) =>
    request(`/users/referidos/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // Mismo shape que miCuenta pero para que un admin vea el estado de cuenta de CUALQUIER agente
  // (saldo por club, garantía, cierres y movimientos) en vez de solo el historial crudo.
  cuentaDeAgente: (agentId: string) => request(`/catalog/agents/${agentId}/cuenta`),
  // Resumen de liquidación (rakeback por club) de una semana puntual, combinando uno o varios
  // agentes/clubes en un solo total (ej. "Prodigio" = varias identidades de agente juntas) — no
  // confundir con cuentaDeAgente (que es el estado de cuenta completo con saldo histórico).
  semanasLiquidacion: (agentIds: string[]) =>
    request(`/catalog/liquidacion/semanas?agentIds=${agentIds.join(",")}`),
  liquidacion: (agentIds: string[], weekStart: string) =>
    request(`/catalog/liquidacion?agentIds=${agentIds.join(",")}&weekStart=${weekStart}`),
  // Historial: guarda una foto congelada de la liquidación (para consultar después "qué le
  // mandamos") — separado de liquidacion() de arriba, que siempre recalcula en vivo.
  guardarLiquidacion: (data: {
    nombreGrupo: string;
    agentIds: string[];
    weekStart: string;
    weekEnd: string;
    filas: any[];
    total: number;
    adelantosAplicados: number;
    adelantosManual: number;
    cargasAplicadas: number;
    totalAPagar: number;
    nota?: string | null;
  }) => request("/catalog/liquidacion/guardar", { method: "POST", body: JSON.stringify(data) }),
  historialLiquidaciones: () => request("/catalog/liquidacion/historial"),
  eliminarLiquidacionGuardada: (id: string) => request(`/catalog/liquidacion/historial/${id}`, { method: "DELETE" }),

  // Drill-down de movimientos y tesorería
  movimientos: (params: { agentId?: string; clubId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.agentId) qs.set("agentId", params.agentId);
    if (params.clubId) qs.set("clubId", params.clubId);
    const q = qs.toString();
    return request(`/dashboard/movimientos${q ? `?${q}` : ""}`);
  },
  tesoreria: (params: { ledger?: "WALLET_MANOS" | "CAJA_EFECTIVO" } = {}) =>
    request(`/dashboard/tesoreria${params.ledger ? `?ledger=${params.ledger}` : ""}`),
  // Resumen financiero (18/09/2026): ganancias generadas + ingresos/egresos reales de todo el
  // sistema, filtrable por rango de fechas — ver repo/resumenFinanciero.ts.
  resumenFinanciero: (desde: string, hasta: string) =>
    request(`/dashboard/resumen-financiero?desde=${desde}&hasta=${hasta}`),
  // Revierten (nunca borran) — ver nota de ledger inmutable: el original queda en el
  // historial marcado como revertido y se genera un movimiento/ajuste opuesto.
  revertirMovimiento: (id: string, motivo?: string) =>
    request(`/movements/${id}`, { method: "DELETE", body: JSON.stringify({ motivo }) }),
  // Borrado real (no reversa) -- solo para el último movimiento de ese agente+club. Ver nota
  // en repo/ledger.ts (eliminarMovimiento).
  eliminarMovimiento: (id: string) => request(`/movements/${id}/definitivo`, { method: "DELETE" }),
  revertirAjusteTesoreria: (id: string, motivo?: string) =>
    request(`/dashboard/tesoreria/ajuste/${id}`, { method: "DELETE", body: JSON.stringify({ motivo }) }),
  revertirCierre: (id: string, motivo?: string) =>
    request(`/movements/cierre-semanal/${id}`, { method: "DELETE", body: JSON.stringify({ motivo }) }),
  // BORRADO REAL, no reversión — solo para limpiar datos de prueba (ver eliminarCierreSemanalDefinitivo).
  // Nunca usar sobre plata real ya operada: para eso está revertirCierre de arriba.
  eliminarCierreDefinitivo: (id: string) =>
    request(`/movements/cierre-semanal/${id}/definitivo`, { method: "DELETE" }),
  // BORRADO REAL en bloque — toda una semana (opcionalmente un solo club) de un saque, misma
  // salvedad: solo para limpiar datos de PRUEBA, nunca plata real ya operada.
  eliminarCierresSemanaDefinitivo: (weekStart: string, clubId?: string) =>
    request(
      `/movements/cierre-semanal/semana/${weekStart}/definitivo${clubId ? `?clubId=${clubId}` : ""}`,
      { method: "DELETE" }
    ),
  ajustarTesoreria: (data: {
    ledger: "WALLET_MANOS" | "CAJA_EFECTIVO";
    direction: "INGRESO" | "EGRESO";
    amount: number;
    custodian?: string;
    reason: string;
    occurredAt?: string;
  }) => request("/dashboard/tesoreria/ajuste", { method: "POST", body: JSON.stringify(data) }),

  // Catálogo (alta/edición)
  clubes: () => request("/catalog/clubs"),
  crearClub: (data: { name: string; unit?: string; currentRate?: number }) =>
    request("/catalog/clubs", { method: "POST", body: JSON.stringify(data) }),
  configurarClub: (
    id: string,
    data: {
      name?: string;
      unit?: string;
      currentRate?: number;
      defaultRakebackPct?: number;
      defaultRebatePct?: number;
      rebateDestino?: "SALDO_OPERATIVO" | "RAKEBACK_SUPERVISOR";
      feePct?: number;
      platformPct?: number;
      unionPct?: number;
      active?: boolean;
      notes?: string | null;
      importSource?: string | null;
      importPlatform?: string | null;
    }
  ) => request(`/catalog/clubs/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  crearAgente: (data: { name: string; defaultSystem: "PREPAGO" | "WIN_LOSE"; supervisor?: string; accountType?: AccountType }) =>
    request("/catalog/agents", { method: "POST", body: JSON.stringify(data) }),
  editarAgente: (
    id: string,
    data: {
      name?: string;
      defaultSystem?: "PREPAGO" | "WIN_LOSE";
      supervisor?: string | null;
      accountType?: AccountType;
      // ID del agente en la plataforma de origen (ej. "Agent ID" del reporte Suprema/Tiny) —
      // permite que el importador lo reconozca aunque el nombre venga distinto o con typos.
      externalId?: string | null;
      // Dar de baja (no borra nada: el agente deja de aparecer para cargar cierres nuevos,
      // pero su historial de movimientos/cierres queda intacto).
      active?: boolean;
      // Cuenta de socio (caso Juan): nombre de una cuenta en Cuentas de socios. Si se setea,
      // el cierre semanal de este agente deja de tocar su balance y se rutea entero ahí.
      personKey?: string | null;
    }
  ) => request(`/catalog/agents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  // BORRADO REAL (no "dar de baja") — solo funciona si el agente no tiene ningún rastro
  // (players/ledger/deals/etc, ver eliminarAgenteDefinitivo). Para duplicados de prueba o
  // auto-creados por error del importador; un agente con historial real se da de baja, no se borra.
  eliminarAgente: (id: string) => request(`/catalog/agents/${id}`, { method: "DELETE" }),

  // Garantías: alta/ajuste con historial, separadas del saldo operativo.
  garantias: () => request("/guarantees"),
  garantiasHistorial: (agentId?: string) => request(`/guarantees/historial${agentId ? `?agentId=${agentId}` : ""}`),
  ajustarGarantia: (data: { agentId: string; type: "ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA"; amount: number; notes?: string }) =>
    request("/guarantees/ajuste", { method: "POST", body: JSON.stringify(data) }),

  // Proveedores (22/09/2026): entidad separada de agentes/clubes -- ej. Manzur como "unión"
  // en Fénix GG, que nos entrega el 75% del rake TOTAL del club (no un agente al 75% de sus
  // propios jugadores, ver Cierres/Liquidaciones para ese caso). Nunca se mezcla con agents.
  proveedores: (includeInactive?: boolean) => request(`/proveedores${includeInactive ? "?includeInactive=1" : ""}`),
  crearProveedor: (data: {
    name: string;
    notes?: string;
    autoCierreClubId?: string | null;
    autoCierreRakebackPct?: number | null;
  }) => request("/proveedores", { method: "POST", body: JSON.stringify(data) }),
  actualizarProveedor: (
    id: string,
    data: {
      name?: string;
      notes?: string | null;
      active?: boolean;
      autoCierreClubId?: string | null;
      autoCierreRakebackPct?: number | null;
    }
  ) => request(`/proveedores/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  proveedoresClubes: () => request("/proveedores/clubes"),
  agentesProveedores: () => request("/proveedores/agentes"),
  saldosProveedores: () => request("/proveedores/saldos"),
  movimientosSaldoProveedor: (proveedorId: string, clubId: string) =>
    request(`/proveedores/saldos/movimientos?proveedorId=${proveedorId}&clubId=${clubId}`),
  cierresProveedor: (proveedorId?: string) => request(`/proveedores/cierres${proveedorId ? `?proveedorId=${proveedorId}` : ""}`),
  lineasCierreProveedor: (cierreId: string) => request(`/proveedores/cierres/${cierreId}/lineas`),
  cierreAgentePreview: (agentId: string, clubId: string, weekStart: string) =>
    request(`/proveedores/cierre-agente-preview?agentId=${agentId}&clubId=${clubId}&weekStart=${weekStart}`),
  cierreClubPreview: (clubId: string, weekStart: string, rakebackPct: number) =>
    request(`/proveedores/cierre-club-preview?clubId=${clubId}&weekStart=${weekStart}&rakebackPct=${rakebackPct}`),
  aplicarCierreProveedor: (data: {
    proveedorId: string;
    weekStart: string;
    lineas: Array<{
      tipo: "CLUB" | "AGENTE";
      clubId: string;
      rakebackPct?: number;
      agentId?: string;
      notes?: string;
    }>;
    notes?: string;
  }) => request("/proveedores/cierres", { method: "POST", body: JSON.stringify(data) }),
  revertirCierreProveedor: (id: string) => request(`/proveedores/cierres/${id}`, { method: "DELETE" }),
  recalcularCierreProveedor: (id: string) => request(`/proveedores/cierres/${id}/recalcular`, { method: "POST" }),
  eliminarCierreProveedorDefinitivo: (id: string) => request(`/proveedores/cierres/${id}/definitivo`, { method: "DELETE" }),
  pagosProveedor: (proveedorId?: string) => request(`/proveedores/pagos${proveedorId ? `?proveedorId=${proveedorId}` : ""}`),
  registrarPagoProveedor: (data: {
    proveedorId: string;
    clubId: string;
    amount: number;
    medio: "USDT" | "EFECTIVO" | "ZELLE" | "OTRO";
    direction: "PAGO" | "COBRO";
    notes?: string;
  }) => request("/proveedores/pagos", { method: "POST", body: JSON.stringify(data) }),
  revertirPagoProveedor: (id: string) => request(`/proveedores/pagos/${id}`, { method: "DELETE" }),
  eliminarPagoProveedorDefinitivo: (id: string) => request(`/proveedores/pagos/${id}/definitivo`, { method: "DELETE" }),
  garantiasProveedores: () => request("/proveedores/garantias"),
  garantiasProveedoresHistorial: (proveedorId?: string) =>
    request(`/proveedores/garantias/historial${proveedorId ? `?proveedorId=${proveedorId}` : ""}`),
  eliminarGarantiaProveedorDefinitivo: (id: string) => request(`/proveedores/garantias/${id}/definitivo`, { method: "DELETE" }),
  eliminarProveedorDefinitivo: (id: string) => request(`/proveedores/${id}`, { method: "DELETE" }),

  // Auto-cierre multi-club (22/09/2026): un proveedor puede tener cualquier cantidad de
  // clubes configurados (ej. Manzur: M CHOCO Y Fénix GG a la vez).
  autoCierreClubesProveedor: (proveedorId: string) => request(`/proveedores/${proveedorId}/auto-cierre-clubes`),
  autoCierreClubesTodos: () => request("/proveedores/auto-cierre-clubes"),
  agregarAutoCierreClub: (proveedorId: string, data: { clubId: string; rakebackPct: number }) =>
    request(`/proveedores/${proveedorId}/auto-cierre-clubes`, { method: "POST", body: JSON.stringify(data) }),
  eliminarAutoCierreClub: (configId: string) => request(`/proveedores/auto-cierre-clubes/${configId}`, { method: "DELETE" }),
  ajustarGarantiaProveedor: (data: {
    proveedorId: string;
    type: "ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA";
    amount: number;
    notes?: string;
  }) => request("/proveedores/garantias/ajuste", { method: "POST", body: JSON.stringify(data) }),

  // Adelantos de rakeback: por agente, pero cada adelanto es independiente — un agente puede
  // tener varios a la vez (distintos momentos, distintos clubes de origen).
  adelantos: () => request("/advances"),
  adelantosHistorial: (agentId?: string) => request(`/advances/historial${agentId ? `?agentId=${agentId}` : ""}`),
  altaAdelanto: (data: { agentId: string; amount: number; medio?: "FICHAS" | "USDT" | null; clubOrigenId?: string | null; notes?: string }) =>
    request("/advances/alta", { method: "POST", body: JSON.stringify(data) }),
  ajustarAdelanto: (data: { advanceId: string; type: "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA"; amount: number; notes?: string }) =>
    request("/advances/ajuste", { method: "POST", body: JSON.stringify(data) }),
  // Cruce de cargas de tesorería pendientes contra una liquidación (21/09/2026) — mismo efecto
  // que ajustarAdelanto CONSUMO, pero sobre carga_pendientes_cruce (ver repo/cargaCruces.ts).
  consumirCarga: (data: { cargaId: string; amount: number; notes?: string }) =>
    request("/catalog/liquidacion/carga/consumir", { method: "POST", body: JSON.stringify(data) }),
  // Borrado real de una carga pendiente (ej. cargada de prueba) -- no queda en historial.
  eliminarCarga: (cargaId: string) => request(`/catalog/liquidacion/carga/${cargaId}`, { method: "DELETE" }),
  eliminarMovimientoCarga: (movementId: string) => request(`/catalog/liquidacion/carga/movimientos/${movementId}`, { method: "DELETE" }),
  corregirAdelanto: (data: { advanceId: string; amount?: number; consumed?: number; clubOrigenId?: string | null; notes?: string }) =>
    request("/advances/correccion", { method: "POST", body: JSON.stringify(data) }),
  eliminarAdelanto: (advanceId: string) => request(`/advances/${advanceId}`, { method: "DELETE" }),

  // Rakeback pendiente (22/09/2026): lo que un cierre semanal genera además del Win/Lose
  // (rakeback, rebate, Rodeo, ajuste manual) -- ver repo/rakebackPendiente.ts.
  rakebackPendiente: () => request("/rakeback-pendiente"),
  pagarRakebackPendiente: (data: { pendienteId: string; amount: number; medio: "FICHAS" | "USDT" | "EFECTIVO" | "ZELLE"; custodian?: string; notes?: string }) =>
    request("/rakeback-pendiente/pagar", { method: "POST", body: JSON.stringify(data) }),
  darDeBajaRakebackPendiente: (id: string, notes?: string) =>
    request(`/rakeback-pendiente/${id}/baja`, { method: "POST", body: JSON.stringify({ notes }) }),
  eliminarRakebackPendiente: (id: string) => request(`/rakeback-pendiente/${id}`, { method: "DELETE" }),
  // Borra UN movimiento puntual (solo el más reciente de su adelanto) — para corregir pruebas
  // sin tener que eliminar el adelanto entero. Ver nota en repo/advances.ts.
  eliminarMovimientoAdelanto: (movementId: string) => request(`/advances/movimientos/${movementId}`, { method: "DELETE" }),

  // Cuentas de socios ("Cuentas y memorias" de la planilla: Saldo Uriel, Compensación Juan,
  // etc.) — plata de los socios, no de agentes. Control total: editar y eliminar directo.
  cuentasSocios: () => request("/partner-accounts"),
  cuentasSociosAgregados: () => request("/partner-accounts/agregados"),
  crearCuentaSocio: (data: { name: string; description?: string }) =>
    request("/partner-accounts", { method: "POST", body: JSON.stringify(data) }),
  editarCuentaSocio: (id: string, data: { name?: string; description?: string }) =>
    request(`/partner-accounts/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  eliminarCuentaSocio: (id: string) => request(`/partner-accounts/${id}`, { method: "DELETE" }),
  movimientosCuentasSocios: (accountId?: string) =>
    request(`/partner-accounts/movimientos${accountId ? `?accountId=${accountId}` : ""}`),
  crearMovimientoCuentaSocio: (data: {
    accountId: string;
    category: "COMPENSACION" | "COMISION" | "PAGO" | "RETIRO" | "GASTO" | "AJUSTE" | "OTRO";
    concept: string;
    amount: number;
    entryDate?: string;
    notes?: string;
  }) => request("/partner-accounts/movimientos", { method: "POST", body: JSON.stringify(data) }),
  editarMovimientoCuentaSocio: (
    id: string,
    data: Partial<{
      category: "COMPENSACION" | "COMISION" | "PAGO" | "RETIRO" | "GASTO" | "AJUSTE" | "OTRO";
      concept: string;
      amount: number;
      entryDate: string;
      notes: string;
    }>
  ) => request(`/partner-accounts/movimientos/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  eliminarMovimientoCuentaSocio: (id: string) => request(`/partner-accounts/movimientos/${id}`, { method: "DELETE" }),

  // Ganancias por período + Ajustes extraordinarios (recreación de esas dos pestañas de la
  // planilla, 15/09/2026). Un período agrupa semanas ya cerradas bajo un nombre y, al cerrarlo,
  // congela los números y consume una cuota de cada ajuste extraordinario todavía activo.
  ajustesExtraordinarios: () => request("/profit-periods/ajustes"),
  crearAjusteExtraordinario: (data: {
    occurredAt?: string;
    tipo: string;
    descripcion: string;
    responsable?: string | null;
    clubAgencia?: string | null;
    montoOriginal: number;
    absorbeDigiplayers?: number;
    absorbeAgente?: number;
    absorbeSupervisor?: number;
    modoDistribucion?: "IGUAL_POR_PERIODO" | "PERSONALIZADO";
    periodosTotales?: number;
    afectadoTipo?: string | null;
    afectadoNombre?: string | null;
    observaciones?: string | null;
  }) => request("/profit-periods/ajustes", { method: "POST", body: JSON.stringify(data) }),
  editarAjusteExtraordinario: (id: string, data: Record<string, any>) =>
    request(`/profit-periods/ajustes/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  eliminarAjusteExtraordinario: (id: string) => request(`/profit-periods/ajustes/${id}`, { method: "DELETE" }),

  semanasDisponiblesPeriodo: () => request("/profit-periods/semanas-disponibles"),
  previewPeriodo: (weekStarts: string[]) =>
    request("/profit-periods/preview", { method: "POST", body: JSON.stringify({ weekStarts }) }),
  periodos: () => request("/profit-periods"),
  periodoDetalle: (id: string) => request(`/profit-periods/${id}`),
  crearPeriodo: (name: string, weekStarts: string[]) =>
    request("/profit-periods", { method: "POST", body: JSON.stringify({ name, weekStarts }) }),
  editarPeriodo: (id: string, data: { name?: string; weekStarts?: string[] }) =>
    request(`/profit-periods/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  cerrarPeriodo: (id: string) => request(`/profit-periods/${id}/cerrar`, { method: "POST" }),
  reabrirPeriodo: (id: string) => request(`/profit-periods/${id}/reabrir`, { method: "POST" }),
  eliminarPeriodo: (id: string) => request(`/profit-periods/${id}`, { method: "DELETE" }),

  // Stock físico por cuenta ("Stock y deudas consolidados" de la planilla) — conteo de fichas en
  // custodia por agente+club, del cual salen las 4 vistas calculadas. Control total: editar y
  // eliminar directo, igual que Cuentas de socios.
  stockList: () => request("/account-stock"),
  stockConsolidado: () => request("/account-stock/consolidado"),
  stockObligacionPrepago: () => request("/account-stock/obligacion-prepago"),
  stockResumen: () => request("/account-stock/resumen"),
  stockDeudasConsolidadas: () => request("/account-stock/deudas-consolidadas"),
  guardarStock: (data: {
    agentId: string;
    clubId: string;
    units: number;
    rate?: number | null;
    excluded?: boolean;
    estado?: string;
    fuente?: string;
    observaciones?: string;
    confirmadoEn?: string;
  }) => request("/account-stock", { method: "POST", body: JSON.stringify(data) }),
  editarStock: (
    id: string,
    data: Partial<{
      units: number;
      rate: number | null;
      excluded: boolean;
      estado: string;
      fuente: string;
      observaciones: string;
      confirmadoEn: string;
    }>
  ) => request(`/account-stock/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  eliminarStock: (id: string) => request(`/account-stock/${id}`, { method: "DELETE" }),
  crearDeal: (data: {
    agentId: string;
    clubId: string;
    system: "PREPAGO" | "WIN_LOSE";
    rakebackPct: number;
    rebatePct?: number;
    notes?: string;
    validFrom?: string;
  }) => request("/catalog/deals", { method: "POST", body: JSON.stringify(data) }),
  // Todos los deals vigentes de todos los agentes de una — para pintar el % en la lista
  // principal sin pedir agente por agente.
  todosLosDeals: () => request("/catalog/deals"),

  // Motor de reglas configurable: reglas especiales versionadas por agente (ej. Manzur = 75%
  // del rake), en vez de "if agente === X" hardcodeado en el motor de cierre.
  agentRules: (agentId: string) => request(`/catalog/agents/${agentId}/rules`),
  // Vista global: todas las reglas especiales de todos los agentes en un solo listado (evita
  // tener que entrar agente por agente a buscar cuáles tienen algo activo).
  todasLasReglas: () => request(`/catalog/rules`),
  // Árbol Club -> Agentes (con % vigente) para la pestaña "Árbol de clubes" en Administración.
  arbolClubes: () => request(`/catalog/arbol`),
  jugadoresDeAgenteEnClub: (clubId: string, agentId: string) => request(`/catalog/clubs/${clubId}/agents/${agentId}/players`),
  jugadoresDeAgente: (agentId: string) => request(`/catalog/agents/${agentId}/players`),
  // Borra una fila de jugador mal asignada a un club (ej. por el bug viejo del import_source),
  // para poder recargarla a mano en el club correcto. No toca cierres ni ledger.
  eliminarJugador: (playerId: string) => request(`/catalog/players/${playerId}`, { method: "DELETE" }),
  // "Jugadores bancados": jugadores puntuales que se excluyen del cierre agregado de su agente
  // (se contabilizan aparte). Ver players.bancado en schema.sql y repo/imports.ts.
  jugadoresBancados: () => request(`/catalog/jugadores-bancados`),
  buscarJugadores: (q: string) => request(`/catalog/players/buscar?q=${encodeURIComponent(q)}`),
  setJugadorBancado: (playerId: string, bancado: boolean) =>
    request(`/catalog/players/${playerId}/bancado`, { method: "PATCH", body: JSON.stringify({ bancado }) }),
  // Motor de liquidación de banca (capital/makeup/rakeback) por jugador bancado — ver
  // engine/bancados.ts.
  bancadoConfig: (playerId: string) => request(`/bancados/config/${playerId}`),
  guardarBancadoConfig: (
    playerId: string,
    data: {
      pctJugador: number;
      pctBanca: number;
      rakebackPct: number;
      rakebackBancaPct: number;
      unionSharePct: number;
      capitalInicial: number;
      makeupInicial: number;
      moneda?: string;
      regla?: string;
      observaciones?: string;
      recuperacionMakeup?: string;
    }
  ) => request(`/bancados/config/${playerId}`, { method: "PUT", body: JSON.stringify(data) }),
  bancadoEstado: (playerId: string) => request(`/bancados/estado/${playerId}`),
  previsualizarCierreBancado: (playerId: string, resultadoMesas: number, rakeTotal: number, ticketPromocional?: number) =>
    request(`/bancados/previsualizar`, { method: "POST", body: JSON.stringify({ playerId, resultadoMesas, rakeTotal, ticketPromocional }) }),
  cerrarCierreBancado: (data: {
    playerId: string;
    weekStart: string;
    weekEnd: string;
    resultadoMesas: number;
    rakeTotal: number;
    // Ticket promocional (21/09/2026): regalo a un jugador bancado pagado por nosotros -- resta
    // solo de nuestra ganancia (gananciaBancaMesas), nunca del bancado. Nota obligatoria si no es 0.
    ticketPromocional?: number;
    ticketPromocionalNota?: string;
    observaciones?: string;
  }) => request(`/bancados/cerrar`, { method: "POST", body: JSON.stringify(data) }),
  // Recarga/ajuste manual de capital (monto negativo = descuento) — para cuando el jugador
  // pierde todo el capital y hay que volver a cargarle fichas.
  recargarCapitalBancado: (data: { playerId: string; monto: number; fecha: string; observaciones?: string }) =>
    request(`/bancados/recargar`, { method: "POST", body: JSON.stringify(data) }),
  historialBancadoGlobal: () => request(`/bancados/historial`),
  historialBancado: (playerId: string) => request(`/bancados/historial/${playerId}`),
  revertirCierreBancado: (id: string, motivo?: string) =>
    request(`/bancados/historial/${id}`, { method: "DELETE", body: JSON.stringify({ motivo }) }),
  // Borrado real (no queda en el historial) — solo para datos de prueba, nunca plata real.
  eliminarCierreBancadoDefinitivo: (id: string) =>
    request(`/bancados/historial/${id}/definitivo`, { method: "DELETE" }),

  pagarCierreBancado: (id: string) =>
    request(`/bancados/historial/${id}/pagar`, { method: "POST" }),
  resumenBancados: () => request(`/bancados/resumen`),
  // Config vigente (deal propio o default del club) AHORA MISMO — para refrescar una fila de
  // importación cuyo % pudo haber cambiado después de analizar el archivo.
  configVigente: (agentId: string, clubId: string) => request(`/catalog/agents/${agentId}/clubs/${clubId}/config-vigente`),
  // Mueve TODOS los jugadores de un agente de un club a otro de una — para arreglar un agente
  // entero mal cargado (ver árbol de clubes). No toca cierres ni ledger.
  moverAgenteDeClub: (clubId: string, agentId: string, toClubId: string) =>
    request(`/catalog/clubs/${clubId}/agents/${agentId}/move`, { method: "POST", body: JSON.stringify({ toClubId }) }),
  crearRegla: (agentId: string, data: { ruleKey: "MANZUR_75_RAKE"; params: Record<string, number>; description: string; clubId?: string | null }) =>
    request(`/catalog/agents/${agentId}/rules`, { method: "POST", body: JSON.stringify(data) }),
  terminarRegla: (ruleId: string) => request(`/catalog/rules/${ruleId}`, { method: "DELETE" }),

  // Movimientos y cierres (escritura sobre el ledger)
  crearMovimiento: (data: {
    type: string;
    clubId: string;
    clubDestinoId?: string;
    agentId: string;
    amount: number;
    paymentMethod?: string;
    occurredAt: string;
    observation?: string;
    custodian?: string;
  }) => request("/movements", { method: "POST", body: JSON.stringify({ ...data, idempotencyKey: idempotencyKey() }) }),

  // Usuarios de acceso (login) y permisos
  usuarios: () => request("/users"),
  // agentIds: uno o varios — el primero queda como "cuenta principal" (la que usa el login por
  // default), el resto solo agrega opciones al selector de "Mi cuenta" de ese usuario.
  crearUsuario: (data: { agentIds: string[]; defaultAgentId: string; email: string; password: string; role: "ADMIN" | "AGENT" | "SUPERVISOR" }) =>
    request("/users", { method: "POST", body: JSON.stringify(data) }),
  actualizarUsuario: (
    id: string,
    data: {
      email?: string;
      role?: "ADMIN" | "AGENT" | "SUPERVISOR";
      active?: boolean;
      password?: string;
      agentIds?: string[];
      // Obligatorio si se manda agentIds: cuál de esos usar como cuenta de acceso por defecto.
      defaultAgentId?: string;
    }
  ) => request(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  eliminarUsuario: (id: string) => request(`/users/${id}`, { method: "DELETE" }),

  aplicarCierre: (data: {
    agentId: string;
    clubId: string;
    weekStart: string;
    weekEnd: string;
    system: "PREPAGO" | "WIN_LOSE";
    result: number;
    rakeTotal: number;
    rakebackPct: number;
    rebatePct?: number;
    observation?: string;
    // "Rodeo" (solo SupremaPoker): lista cruda por jugador — NUNCA un total ya calculado. El
    // backend aplica la memoria por jugador de forma transaccional (repo/rodeo.ts) y recién ahí
    // sale el monto real que se le suma al cierre del agente.
    rodeoJugadores?: { playerExternalId: string; baseRodeo: number }[];
    // Clubes en fichas (hoy: X-Poker): valor de la ficha en USD usado para convertir result/
    // rakeTotal ANTES de mandarlos (esos dos campos siempre viajan ya en USD) — se guarda solo
    // como registro histórico de qué tasa estaba vigente ese cierre, el motor no la usa para
    // calcular nada (ver engine/cierre.ts, ClosingInput.rateSnapshot).
    rateSnapshot?: number;
    // Desglose por tipo de juego (solo importación SupremaPoker) para el resumen por club.
    jugadores?: number;
    ringGame?: number;
    mtt?: number;
    sng?: number;
    // Ajuste manual ("tickets promocionales", 18/09/2026): monto libre en USD que se suma/resta
    // directo al cierre final del agente, cargado a mano en la grilla — ver engine/cierre.ts.
    ajusteManual?: number;
    // Obligatorio en la UI si ajusteManual != 0 (ver Cierres.tsx), para que quede rastreable.
    ajusteManualNota?: string | null;
    // Solo Tiny GG: informativo, ver repo/closings.ts.
    bbjContribution?: number;
  }) => request("/movements/cierre-semanal", { method: "POST", body: JSON.stringify(data) }),
  // Corre la misma lógica que aplicarCierre (idempotencia, reglas especiales, supervisor,
  // memoria de bancado, y ahora memoria de rodeo) pero nunca escribe nada (rollback) — para
  // mostrar el número real antes de aplicar.
  previsualizarCierre: (data: {
    agentId: string;
    clubId: string;
    weekStart: string;
    weekEnd: string;
    system: "PREPAGO" | "WIN_LOSE";
    result: number;
    rakeTotal: number;
    rakebackPct: number;
    rebatePct?: number;
    observation?: string;
    rodeoJugadores?: { playerExternalId: string; baseRodeo: number }[];
    rateSnapshot?: number;
    jugadores?: number;
    ringGame?: number;
    mtt?: number;
    sng?: number;
    ajusteManual?: number;
    ajusteManualNota?: string | null;
    // Solo Tiny GG: informativo, ver repo/closings.ts.
    bbjContribution?: number;
  }) => request("/movements/cierre-semanal/preview", { method: "POST", body: JSON.stringify(data) }),

  // Importador de cierres (BIT-nueva): analiza un archivo semanal (hoy formato SupremaPoker,
  // hojas Fénix/TeamBack) y arma la previa por agente usando SIEMPRE la configuración de
  // rakeback/rebate ya cargada en el sistema — el archivo nunca trae su propio %. No aplica
  // nada; el frontend reutiliza previsualizarCierre/aplicarCierre fila por fila después.
  // sheetClubOverrides: elección explícita del club para cada hoja (siempre gana sobre
  // cualquier auto-match por nombre). sheetsIgnoradas: hojas que el usuario decide no procesar
  // esta semana (no hace falta elegirles club) — el archivo se vuelve a mandar entero cada vez.
  previsualizarImportacion: (
    file: File,
    weekEnd?: string,
    sheetClubOverrides?: Record<string, string>,
    sheetsIgnoradas?: string[]
  ) => {
    const form = new FormData();
    form.append("file", file);
    if (weekEnd) form.append("weekEnd", weekEnd);
    if (sheetClubOverrides && Object.keys(sheetClubOverrides).length > 0) {
      form.append("sheetClubOverrides", JSON.stringify(sheetClubOverrides));
    }
    if (sheetsIgnoradas && sheetsIgnoradas.length > 0) {
      form.append("sheetsIgnoradas", JSON.stringify(sheetsIgnoradas));
    }
    return requestForm("/imports/suprema/preview", form);
  },
  // Mismo endpoint que arriba pero para la plataforma "GG Poker / TeamBack GG" (club "TeamBack
  // GG" en el catálogo) — mismo formato de respuesta (ResultadoImportacion), reutilizado tal
  // cual por toda la UI de "Jugadores sin agente"/"Cierres a aplicar".
  previsualizarImportacionTeamBackGG: (
    file: File,
    weekEnd?: string,
    sheetClubOverrides?: Record<string, string>,
    sheetsIgnoradas?: string[]
  ) => {
    const form = new FormData();
    form.append("file", file);
    if (weekEnd) form.append("weekEnd", weekEnd);
    if (sheetClubOverrides && Object.keys(sheetClubOverrides).length > 0) {
      form.append("sheetClubOverrides", JSON.stringify(sheetClubOverrides));
    }
    if (sheetsIgnoradas && sheetsIgnoradas.length > 0) {
      form.append("sheetsIgnoradas", JSON.stringify(sheetsIgnoradas));
    }
    return requestForm("/imports/teamback-gg/preview", form);
  },
  // Plataforma "Tiny GG" (club "Tiny"): a diferencia de Suprema/TeamBack GG, cada super agente
  // baja su PROPIO archivo — este endpoint recibe VARIOS archivos juntos (campo "files") y arma
  // una sola previa agrupada. sheetClubOverrides/sheetsIgnoradas quedan indexados por NOMBRE DE
  // ARCHIVO (no hay "hoja" acá, cada archivo entero es la unidad).
  previsualizarImportacionTinyGG: (
    files: File[],
    weekEnd?: string,
    sheetClubOverrides?: Record<string, string>,
    sheetsIgnoradas?: string[]
  ) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    if (weekEnd) form.append("weekEnd", weekEnd);
    if (sheetClubOverrides && Object.keys(sheetClubOverrides).length > 0) {
      form.append("sheetClubOverrides", JSON.stringify(sheetClubOverrides));
    }
    if (sheetsIgnoradas && sheetsIgnoradas.length > 0) {
      form.append("sheetsIgnoradas", JSON.stringify(sheetsIgnoradas));
    }
    return requestForm("/imports/tiny-gg/preview", form);
  },
  // Clubes elegibles en el selector "a qué club corresponde esta hoja" del importador —
  // filtrados por plataforma, para no mezclar clubes de otras redes (ej. Fénix GG).
  clubesImportacionSuprema: () => request("/imports/suprema/clubs"),
  clubesImportacionTeamBackGG: () => request("/imports/teamback-gg/clubs"),
  clubesImportacionTinyGG: () => request("/imports/tiny-gg/clubs"),
  // Asigna a mano un jugador que vino sin agente en el archivo (Agent Name vacío o agente no
  // reconocido) — queda guardado para siempre, así no vuelve a aparecer pendiente otra semana.
  asignarAgenteImportado: (data: { playerExternalId: string; clubId: string; agentId: string; reason?: string }) =>
    request("/imports/suprema/asignar-agente", { method: "POST", body: JSON.stringify(data) }),
  // Crea de un clic el agente que faltaba (superagente nuevo del archivo, todavía no existía en
  // el catálogo) — queda con external_id = agentIdRaw, matchea solo en la próxima vuelta.
  crearAgenteImportado: (data: { name: string; agentIdRaw?: string | null; defaultSystem?: "PREPAGO" | "WIN_LOSE" }) =>
    request("/imports/suprema/crear-agente", { method: "POST", body: JSON.stringify(data) }),

  // Resumen semanal por club (ver repo/clubResumen.ts) — desglose por agente + totales del
  // club, reproduce el bloque "RESUMEN DEL CLUB" de la planilla "automatizacion clubes".
  semanasResumenClub: (clubId?: string) => request(`/dashboard/resumen-club/semanas${clubId ? `?clubId=${clubId}` : ""}`),
  resumenClub: (clubId: string, weekStart: string) =>
    request(`/dashboard/resumen-club?clubId=${clubId}&weekStart=${weekStart}`),
  guardarExtrasResumenClub: (data: {
    clubId: string;
    weekStart: string;
    weekEnd: string;
    ingresoPorVentas: number;
    observaciones?: string;
  }) => request("/dashboard/resumen-club/extras", { method: "POST", body: JSON.stringify(data) }),

  // Resumen de club para Tiny GG (18/09/2026) — ver repo/tinyResumen.ts. Complementa a
  // resumenClub (que sigue trayendo el desglose por agente y el Cierre total agentes).
  resumenTinyExtra: (clubId: string, weekStart: string) =>
    request(`/dashboard/resumen-club/tiny-extra?clubId=${clubId}&weekStart=${weekStart}`),
  guardarTinyRebateUnion: (data: {
    clubId: string;
    weekStart: string;
    weekEnd: string;
    items: {
      fileName: string;
      superAgentNickname: string | null;
      rgPreRakeExclJp: number | null;
      rebateUnionCalculado: number;
      rebateUnionTiny: number | null;
      rakeTotalRingGame: number | null;
      ratePct: number | null;
      rakeShare: number | null;
      weeklySettlementOficial: number | null;
    }[];
  }) => request("/dashboard/resumen-club/tiny-rebate-union", { method: "POST", body: JSON.stringify(data) }),

  setToken: (t: string) => localStorage.setItem("dp_token", t),
  clearToken: () => localStorage.removeItem("dp_token"),
  getToken,
};
