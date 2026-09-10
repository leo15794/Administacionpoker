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
import { advancesRouter } from "./routes/advances.js";
import { importsRouter } from "./routes/imports.js";

// La app se define acá, separada de server.ts, para poder reutilizarla tanto en
// modo servidor local (server.ts, con app.listen) como en modo función serverless
// de Vercel (api/index.ts, sin listen — Vercel invoca la función por request).
export const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/dashboard", dashboardRouter);
app.use("/portal", portalRouter);
app.use("/movements", movementsRouter);
app.use("/catalog", catalogRouter);
app.use("/users", usersRouter);
app.use("/guarantees", guaranteesRouter);
app.use("/advances", advancesRouter);
app.use("/imports", importsRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: "Error interno" });
});
