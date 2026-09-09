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
  agentes: () => request("/dashboard/agentes"),
  agentDeals: (id: string) => request(`/dashboard/agentes/${id}/deals`),
  supervisores: () => request("/dashboard/supervisores"),
  bancados: () => request("/dashboard/bancados"),
  miCuenta: () => request("/portal/mi-cuenta"),

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
  // Revierten (nunca borran) — ver nota de ledger inmutable: el original queda en el
  // historial marcado como revertido y se genera un movimiento/ajuste opuesto.
  revertirMovimiento: (id: string, motivo?: string) =>
    request(`/movements/${id}`, { method: "DELETE", body: JSON.stringify({ motivo }) }),
  revertirAjusteTesoreria: (id: string, motivo?: string) =>
    request(`/dashboard/tesoreria/ajuste/${id}`, { method: "DELETE", body: JSON.stringify({ motivo }) }),
  revertirCierre: (id: string, motivo?: string) =>
    request(`/movements/cierre-semanal/${id}`, { method: "DELETE", body: JSON.stringify({ motivo }) }),
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
      // Dar de baja (no borra nada: el agente deja de aparecer para cargar cierres nuevos,
      // pero su historial de movimientos/cierres queda intacto).
      active?: boolean;
    }
  ) => request(`/catalog/agents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  // Garantías: alta/ajuste con historial, separadas del saldo operativo.
  garantias: () => request("/guarantees"),
  garantiasHistorial: (agentId?: string) => request(`/guarantees/historial${agentId ? `?agentId=${agentId}` : ""}`),
  ajustarGarantia: (data: { agentId: string; type: "ALTA" | "AUMENTO" | "REDUCCION" | "CONSUMO" | "BAJA"; amount: number; notes?: string }) =>
    request("/guarantees/ajuste", { method: "POST", body: JSON.stringify(data) }),
  crearDeal: (data: {
    agentId: string;
    clubId: string;
    system: "PREPAGO" | "WIN_LOSE";
    rakebackPct: number;
    rebatePct?: number;
    notes?: string;
  }) => request("/catalog/deals", { method: "POST", body: JSON.stringify(data) }),

  // Motor de reglas configurable: reglas especiales versionadas por agente (ej. Manzur = 75%
  // del rake), en vez de "if agente === X" hardcodeado en el motor de cierre.
  agentRules: (agentId: string) => request(`/catalog/agents/${agentId}/rules`),
  // Vista global: todas las reglas especiales de todos los agentes en un solo listado (evita
  // tener que entrar agente por agente a buscar cuáles tienen algo activo).
  todasLasReglas: () => request(`/catalog/rules`),
  // Árbol Club -> Agentes (con % vigente) para la pestaña "Árbol de clubes" en Administración.
  arbolClubes: () => request(`/catalog/arbol`),
  jugadoresDeAgenteEnClub: (clubId: string, agentId: string) => request(`/catalog/clubs/${clubId}/agents/${agentId}/players`),
  // Borra una fila de jugador mal asignada a un club (ej. por el bug viejo del import_source),
  // para poder recargarla a mano en el club correcto. No toca cierres ni ledger.
  eliminarJugador: (playerId: string) => request(`/catalog/players/${playerId}`, { method: "DELETE" }),
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
  crearUsuario: (data: { agentId: string; email: string; password: string; role: "ADMIN" | "AGENT" }) =>
    request("/users", { method: "POST", body: JSON.stringify(data) }),
  actualizarUsuario: (id: string, data: { role?: "ADMIN" | "AGENT"; active?: boolean; password?: string }) =>
    request(`/users/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

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
  // Clubes elegibles en el selector "a qué club corresponde esta hoja" del importador —
  // filtrados por plataforma, para no mezclar clubes de otras redes (ej. Fénix GG).
  clubesImportacionSuprema: () => request("/imports/suprema/clubs"),
  // Asigna a mano un jugador que vino sin agente en el archivo (Agent Name vacío o agente no
  // reconocido) — queda guardado para siempre, así no vuelve a aparecer pendiente otra semana.
  asignarAgenteImportado: (data: { playerExternalId: string; clubId: string; agentId: string; reason?: string }) =>
    request("/imports/suprema/asignar-agente", { method: "POST", body: JSON.stringify(data) }),
  // Crea de un clic el agente que faltaba (superagente nuevo del archivo, todavía no existía en
  // el catálogo) — queda con external_id = agentIdRaw, matchea solo en la próxima vuelta.
  crearAgenteImportado: (data: { name: string; agentIdRaw?: string | null; defaultSystem?: "PREPAGO" | "WIN_LOSE" }) =>
    request("/imports/suprema/crear-agente", { method: "POST", body: JSON.stringify(data) }),

  setToken: (t: string) => localStorage.setItem("dp_token", t),
  clearToken: () => localStorage.removeItem("dp_token"),
  getToken,
};
