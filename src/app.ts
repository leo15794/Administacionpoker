import "dotenv/config";
import express from "express";
// 28/09/2026: Express 4 NO atrapa automáticamente un error tirado dentro de una ruta `async` sin
// try/catch -- la promesa rechazada queda como unhandled rejection y el pedido se cuelga PARA
// SIEMPRE, sin log, sin respuesta, nada (bug real que encontró Leo: "El servidor tardó demasiado
// en responder", en una ruta de liquidaciones que no tenía try/catch). Este import parchea
// Express para que cualquier error de una ruta async caiga solo en el manejador de errores de
// abajo (que ya respondía 500, pero nunca lo alcanzaba). Tiene que importarse ANTES de crear
// `app` y de montar cualquier router.
import "express-async-errors";
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
import { teambackRouter } from "./routes/teamback.js";
import { teambackAuthRouter } from "./routes/teambackAuth.js";
import { marketRatesRouter } from "./routes/marketRates.js";

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
// TeamBack Affiliates V1 (25/09/2026) -- sección totalmente aparte, ver src/routes/teamback.ts.
// /teamback/auth NO requiere estar logueado (es el propio login de la sección) -- se monta
// aparte, antes, para que quede claro que es la excepción.
app.use("/teamback/auth", teambackAuthRouter);
app.use("/market-rates", marketRatesRouter);
app.use("/teamback", teambackRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  // Se manda el mensaje real (no solo "Error interno") -- esta es una herramienta interna de
  // administración, no un producto público, y sin acceso a los logs de Vercel desde afuera este
  // mensaje es la única forma de saber qué está fallando de verdad en cada caso.
  res.status(500).json({ error: err?.message || "Error interno" });
});
