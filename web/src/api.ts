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
    throw new Error(body.error ? JSON.stringify(body.error) : `Error ${res.status}`);
  }
  return res.json();
}

export const api = {
  login: (email: string) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email }) }),
  resumen: () => request("/dashboard/resumen"),
  cierres: (week?: string) => request(`/dashboard/cierres${week ? `?week=${week}` : ""}`),
  agentes: () => request("/dashboard/agentes"),
  agentDeals: (id: string) => request(`/dashboard/agentes/${id}/deals`),
  miCuenta: () => request("/portal/mi-cuenta"),
  setToken: (t: string) => localStorage.setItem("dp_token", t),
  clearToken: () => localStorage.removeItem("dp_token"),
  getToken,
};
