// 1win-postback (v2). Basado en epicbet-postback.
// Recibe el postback global de 1win y lo manda a Meta CAPI (y a RichAds si el sub1 es ra.*).
//
// URL a pegar en 1win (Perfil > Postback global), cambiando <subdominio> y TU_SECRETO:
//   https://1win-postback.<subdominio>.workers.dev/?key=TU_SECRETO&sub1={sub1}&event={event}&amount={amount}&country={country}&user_id={user_id}&tx={transaction_id}&ts={date}
//
// Secrets: META_ACCESS_TOKEN, POSTBACK_SECRET
// Variables (no secretas, ver wrangler.toml):
//   META_PIXEL_ID  (default abajo)
//   CURRENCY       moneda de {amount} para el evento Purchase (default USD; 1win no manda la moneda en el postback)
//   CURRENCY_MAP   JSON opcional por pais, ej {"MX":"MXN","CL":"CLP"}; pisa a CURRENCY segun {country}
//   EVENT_MAP      JSON opcional, ej: {"registration":"CompleteRegistration","deposit":"Purchase"}
//   ACTION_SOURCE  default 'other'
//
// IMPORTANTE: los valores reales de {event} NO estan confirmados. Los eventos desconocidos NO se
// mandan a Meta: se registran en logs (con el valor crudo) y se responde ignored:true.

const DEFAULT_EVENT_MAP = {
  // ajustar cuando 1win confirme los valores de {event}
  registration: 'CompleteRegistration',
  reg: 'CompleteRegistration',
  deposit: 'Purchase',
  first_deposit: 'Purchase',
  ftd: 'Purchase',
};

// Pixel ID (no es secreto). Se puede pisar con env.META_PIXEL_ID.
const DEFAULT_PIXEL_ID = '1089915630582788';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      // 1win manda el texto "null" cuando un macro esta vacio (ej. sub4=null, tx=null): se trata como vacio.
      const q = { get: (k) => { const v = url.searchParams.get(k); return v === 'null' || v === 'undefined' ? null : v; } };

      // Autenticacion simple: el endpoint es publico, sin esto cualquiera puede inyectar eventos.
      if (!env.POSTBACK_SECRET || q.get('key') !== env.POSTBACK_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      const sub1 = q.get('sub1') || '';
      const rawEvent = (q.get('event') || '').toLowerCase().trim();
      const amountRaw = q.get('amount');
      const amountParsed = amountRaw ? parseFloat(amountRaw) : 0;
      const amount = Number.isFinite(amountParsed) ? amountParsed : 0;
      const country = q.get('country') || '';
      const userId = q.get('user_id') || '';
      const tx = q.get('tx') || '';
      const ts = parseInt(q.get('ts') || '', 10); // {date} viene en ms
      const testCode = q.get('test_event_code');

      let map = DEFAULT_EVENT_MAP;
      if (env.EVENT_MAP) {
        try { map = JSON.parse(env.EVENT_MAP); } catch (_) { /* usa default */ }
      }
      const eventName = map[rawEvent];
      if (!eventName) {
        console.log('evento desconocido', JSON.stringify({ rawEvent, amountRaw, country, tx, hasSub1: !!sub1 }));
        return json({ ok: true, ignored: true, reason: 'unmapped_event', event: rawEvent });
      }

      // RichAds (mismo prefijo que epicbet-postback)
      if (sub1.startsWith('ra.')) {
        const clickId = sub1.split('.').slice(3).join('.');
        const r = await fetch(
          'https://us.ahows.co/log?action=conversion&key=' + encodeURIComponent(clickId) + '&price=' + amount
        );
        return json({ ok: true, eventName, sentTo: 'richads', status: r.status });
      }

      // Meta CAPI
      const userData = {};
      // 1win corta cada sub a 128 caracteres: el bridge reparte el fbclid en sub2+sub3+sub4 y deja el
      // momento del clic (ms) al final de sub1. Se rearma aca: fb.1.<ms>.<fbclid>.
      const fbclid = ['sub2', 'sub3', 'sub4'].map((k) => q.get(k) || '').join('');
      const msMatch = sub1.match(/(\d{12,})$/);
      if (fbclid && msMatch) {
        userData.fbc = 'fb.1.' + msMatch[1] + '.' + fbclid;
      } else {
        // Formato anterior (fbc completo dentro de sub1, con o sin corchetes).
        const legacy = sub1.match(/fb\.\d+\.\d+\..+$/);
        if (legacy) userData.fbc = legacy[0];
      }
      if (userId) userData.external_id = await sha256(userId);
      if (country) userData.country = await sha256(country.toLowerCase());

      const eventTime =
        Number.isFinite(ts) && ts > 0 ? Math.floor(ts / 1000) : Math.floor(Date.now() / 1000);

      // Moneda del Purchase: CURRENCY_MAP (JSON por pais, ej {"MX":"MXN","CL":"CLP"}) y si no, CURRENCY.
      // IMPORTANTE: 1win no manda la moneda; confirmar en la prueba real en que moneda llega {amount}.
      let currency = env.CURRENCY || 'USD';
      if (env.CURRENCY_MAP && country) {
        try {
          const byCountry = JSON.parse(env.CURRENCY_MAP);
          currency = byCountry[country.toUpperCase()] || currency;
        } catch (_) { /* usa CURRENCY */ }
      }

      const payload = {
        data: [{
          event_name: eventName,
          event_time: eventTime,
          // event_id = transaction_id: Meta deduplica reintentos del mismo evento.
          event_id: tx || undefined,
          // Un postback servidor a servidor no tiene IP ni user agent del usuario, asi que
          // 'website' (que los exige) no aplica. Configurable por si Events Manager sugiere otro.
          action_source: env.ACTION_SOURCE || 'other',
          user_data: userData,
          custom_data: eventName === 'Purchase' ? { currency, value: amount } : {},
        }],
      };
      if (testCode) payload.test_event_code = testCode;

      const pixelId = env.META_PIXEL_ID || DEFAULT_PIXEL_ID;
      const metaUrl =
        `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${env.META_ACCESS_TOKEN}`;
      const res = await fetch(metaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const metaResult = await res.json();

      if (!res.ok) {
        // Falla visible: queda en logs y devuelve 502 para que 1win pueda reintentar.
        console.error('meta_error', JSON.stringify({ eventName, rawEvent, tx, metaResult }));
        return json({ ok: false, eventName, metaResult }, 502);
      }
      console.log(
        'meta_ok',
        JSON.stringify({ eventName, rawEvent, tx, country, hasFbc: !!userData.fbc, amount, currency })
      );
      return json({ ok: true, eventName, country, hasFbc: !!userData.fbc, metaResult });
    } catch (err) {
      return json({ ok: false, error: err.message }, 500);
    }
  },
};
