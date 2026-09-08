// Punto de entrada para Vercel: cada request a /api/* (redirigido acá por vercel.json)
// invoca esta función serverless, que delega en la misma app de Express que se usa
// en local (src/app.ts). Vercel detecta y compila este archivo TypeScript solo.
import { app } from "../src/app.js";

export default app;
