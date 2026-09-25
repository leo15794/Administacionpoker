// Cotizaciones externas (25/09/2026, pedido de Leo: "conectar el valor de donde tomamos la
// conversion y que se actualice en tiempo real") -- PRUEBA, solo para Tiny por ahora. El valor
// de la ficha de Tiny historicamente se cargaba a mano (ej. 31,78) copiando el precio del dia de
// USDT/TWD -- este endpoint va a buscar ESE mismo precio en vivo a MAX (max.maicoin.com), el
// exchange que Leo usa como referencia (ver https://max.maicoin.com/trades/usdttwd).
//
// Es un simple proxy de solo lectura: el navegador no puede pegarle directo a la API de MAX por
// CORS, asi que el backend la consulta y devuelve solo lo que hace falta. No requiere API key
// (endpoint publico de MAX), pero igual queda atras de requireAuth/requireAdmin como el resto
// de las rutas de catalogo, para no exponer un proxy abierto a cualquiera.
import { Router } from "express";
import { requireAuth, requireAdmin } from "../lib/auth.js";

export const marketRatesRouter = Router();

// GET /market-rates/usdttwd -- ultimo precio de USDT en TWD segun MAX.
// Ver doc publica: https://max-api.maicoin.com/api/v2/tickers/{market} (sin auth, market en
// minusculas, ej. "usdttwd"). Devuelve algo como { at, buy, sell, open, low, high, last, vol }.
marketRatesRouter.get("/usdttwd", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const r = await fetch("https://max-api.maicoin.com/api/v2/tickers/usdttwd", {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`MAX respondio ${r.status}`);
    const data: any = await r.json();
    const rate = Number(data?.last);
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      throw new Error("MAX no devolvio un precio valido para usdttwd");
    }
    res.json({
      rate,
      market: "usdttwd",
      source: "MAX (max.maicoin.com)",
      fetchedAt: new Date().toISOString(),
      // "at" es el timestamp (unix, segundos) que informa la propia MAX -- se manda igual para
      // que el frontend pueda mostrar "cotizacion de hace X segundos" si hace falta.
      quotedAt: data?.at ? new Date(Number(data.at) * 1000).toISOString() : null,
    });
  } catch (err: any) {
    console.error("Error consultando cotizacion MAX usdttwd:", err);
    res.status(502).json({ error: `No se pudo obtener la cotizacion en vivo de MAX: ${err.message || "error desconocido"}` });
  }
});
