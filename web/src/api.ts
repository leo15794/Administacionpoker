const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

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
  miCuenta: () => request("/portal/mi-cuenta"),

  // Drill-down de movimientos y tesorería
  movimientos: (params: { agentId?: string; clubId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.agentId) qs.set("agentId", params.agentId);
    if (params.clubId) qs.set("clubId", params.clubId);
    const q = qs.toString();
    return request(`/dashboard/movimientos${q ? `?${q}` : ""}`);
  },
  tesoreria: () => request("/dashboard/tesoreria"),
  eliminarMovimiento: (id: string) => request(`/movements/${id}`, { method: "DELETE" }),
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
  crearAgente: (data: { name: string; defaultSystem: "PREPAGO" | "WIN_LOSE"; supervisor?: string }) =>
    request("/catalog/agents", { method: "POST", body: JSON.stringify(data) }),
  editarAgente: (id: string, data: { name?: string; defaultSystem?: "PREPAGO" | "WIN_LOSE"; supervisor?: string | null }) =>
    request(`/catalog/agents/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  crearDeal: (data: {
    agentId: string;
    clubId: string;
    system: "PREPAGO" | "WIN_LOSE";
    rakebackPct: number;
    rebatePct?: number;
    notes?: string;
  }) => request("/catalog/deals", { method: "POST", body: JSON.stringify(data) }),

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
  }) => request("/movements/cierre-semanal", { method: "POST", body: JSON.stringify(data) }),

  setToken: (t: string) => localStorage.setItem("dp_token", t),
  clearToken: () => localStorage.removeItem("dp_token"),
  getToken,
};
