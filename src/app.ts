import "dotenv/config";
import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { portalRouter } from "./routes/portal.js";
import { movementsRouter } from "./routes/movements.js";
import { catalogRouter } from "./routes/catalog.js";
import { usersRouter } from "./routes/users.js";
import { guaranteesRouter } from "./routes/guarantees.js";
import { proveedoresRouter } from "./routes/proveedores.js";
import { advancesRouter } from "./routes/advances.js";
import { importsRouter } from "./routes/imports.js";
import { partnerAccountsRouter } from "./routes/partnerAccounts.js";
import { accountStockRouter } from "./routes/accountStock.js";
import { bancadosRouter } from "./routes/bancados.js";
import { profitPeriodsRouter } from "./routes/profitPeriods.js";
import { rakebackPendienteRouter } from "./routes/rakebackPendiente.js";
import { rodeoRouter } from "./routes/rodeo.js";
import { agentesResumenRouter } from "./routes/agentesResumen.js";

// La app se define acá, separada de server.ts, para poder reutilizarla tanto en
// modo servidor local (server.ts, con app.listen) como en modo función serverless
// de Vercel (api/index.ts, sin listen — Vercel invoca la función por request).
export const app = express();
app.use(cors());
app.use(express.json());

// (24/09/2026, pedido de Leo: "a veces hay que apretar F5 para que se actualice") -- por las
// dudas de que el navegador, un proxy intermedio o el CDN de Vercel decida cachear una respuesta
// GET (esta API es 100% dinámica, nunca corresponde servir una respuesta vieja), se fuerza
// no-store en TODAS las respuestas. No afecta rendimiento de forma perceptible -- estas rutas ya
// pegan contra la base en cada request, no había cache real ganando nada acá, solo el riesgo de
// una respuesta vieja quedando pegada en el medio.
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/dashboard", dashboardRouter);
app.use("/portal", portalRouter);
app.use("/movements", movementsRouter);
app.use("/catalog", catalogRouter);
app.use("/users", usersRouter);
app.use("/guarantees", guaranteesRouter);
app.use("/proveedores", proveedoresRouter);
app.use("/advances", advancesRouter);
app.use("/imports", importsRouter);
app.use("/partner-accounts", partnerAccountsRouter);
app.use("/account-stock", accountStockRouter);
app.use("/bancados", bancadosRouter);
app.use("/profit-periods", profitPeriodsRouter);
app.use("/rakeback-pendiente", rakebackPendienteRouter);
app.use("/rodeo", rodeoRouter);
app.use("/agentes-resumen", agentesResumenRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: "Error interno" });
});
