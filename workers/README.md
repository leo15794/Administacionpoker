# Cloudflare Workers (Epicbet / SISU)

Codigo traido desde Cloudflare el 2026-10-19 (sin cambios de logica, solo reformateado).

- `epicbet-bridge`: clic de Meta -> arma `afp` -> redirige a SISU.
- `epicbet-postback`: postback de SISU (registro/deposito) -> Meta CAPI.

Ambos deben mantenerse sincronizados: si cambia el formato de `afp` en el bridge,
se actualiza la extraccion de `fbc` en el postback.

- `1win-postback`: postback global de 1win -> Meta CAPI (v2: moneda configurable con `CURRENCY`).
- `1win-bridge` rutas: `/` = Peru (DEST_URL), `/br` = Brasil (p=vnxp), `/br-bonus` = Brasil con bono (p=9cal); otra ruta = 404. Todas arman sub1..sub4 igual y usan el mismo postback.

### 1win-postback: puesta en marcha

1. Cargar secrets en Cloudflare: `META_ACCESS_TOKEN` y `POSTBACK_SECRET` (cualquier texto largo y aleatorio).
2. En `wrangler.toml` confirmar `META_PIXEL_ID` y `CURRENCY` (moneda en la que 1win manda `{amount}`).
3. En 1win Partners, Perfil > Postback global, pegar (cambiando `<subdominio>` y `TU_SECRETO`):

```
https://1win-postback.<subdominio>.workers.dev/?key=TU_SECRETO&sub1={sub1}&event={event}&amount={amount}&country={country}&user_id={user_id}&tx={transaction_id}&ts={date}
```

4. Probar sin tocar produccion: mandar un evento falso con `test_event_code` (sale en Events Manager > Probar eventos):

```bash
curl "https://1win-postback.<subdominio>.workers.dev/?key=TU_SECRETO&event=registration&sub1=ad%5BPrueba%5D_fb.1.1700000000000.CLICKTEST&country=AR&user_id=prueba1&tx=prueba-1&test_event_code=TEST12345"
```

5. Los valores reales de `{event}` quedan en los logs (`evento desconocido` / `meta_ok`). Si 1win usa otros nombres, definir `EVENT_MAP`.

### 1win-bridge (puente de clic)

Recibe el clic del anuncio, arma `sub1 = ad[<utm_content>]_fb.1.<ms>.<fbclid>` y redirige (302) a `DEST_URL`
(el link de 1win). Redireccion simple: todos los visitantes van al mismo destino, sin logica por bot ni revisor.

- Crear un Worker `1win-bridge` en Cloudflare y pegar `1win-bridge/src/index.js`.
- Variables: `DEST_URL` (link de 1win) y `SUB_PARAM` (default `sub1`; confirmar en la prueba real que 1win lo toma).
- URL del anuncio en Meta: `https://1win-bridge.<subdominio>.workers.dev/?utm_content={{ad.name}}` (Meta agrega `fbclid` solo).
- Prueba: abrir esa URL con `&fbclid=PRUEBA123` y mirar que redirija a `DEST_URL` con `sub1` en la query.
- El link de 1win tiene que ser de la MISMA cuenta que tiene configurado el Postback global; si no, el postback no llega.

### 1win-postback: moneda por pais

`CURRENCY` (default USD) o `CURRENCY_MAP` (JSON, ej. `{"MX":"MXN","CL":"CLP"}`) segun el `{country}` del postback.
1win no manda la moneda: confirmar en una prueba real en cual llega `{amount}`.

## Deploy

```bash
cd workers/epicbet-postback
npx wrangler deploy
```

Requiere `wrangler login` o un `CLOUDFLARE_API_TOKEN` con permiso de edicion de Workers.
Los secrets `META_PIXEL_ID` y `META_ACCESS_TOKEN` ya existen en Cloudflare; `wrangler deploy`
no los borra. Nunca commitear tokens.
