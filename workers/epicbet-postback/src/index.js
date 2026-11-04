// epicbet-postback: recibe el postback de SISU (registro / deposito) y lo reenvia a Meta CAPI.
// - URL con "deposito" en el path -> Purchase; si no -> CompleteRegistration.
// - afp puede venir como "ad[<AdName>]_fb.1.<ms>.<fbclid>" (prefijo agregado por epicbet-bridge).
// Secrets requeridos: META_PIXEL_ID, META_ACCESS_TOKEN.
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const afp = url.searchParams.get('afp') || '';
      const userId = url.searchParams.get('userid') || '';
      const country = url.searchParams.get('country') || '';
      const amount = url.searchParams.get('amount');
      const testCode = url.searchParams.get('test_event_code');

      let eventName = 'CompleteRegistration';
      if (url.pathname.includes('deposito')) {
        eventName = 'Purchase';
      }

      // Trafico de RichAds: se reporta a su endpoint y no a Meta.
      if (afp.startsWith('ra.')) {
        const parts = afp.split('.');
        const richAdsClickId = parts.slice(3).join('.');
        const payout = amount ? parseFloat(amount) : 0;
        const richAdsUrl =
          'https://us.ahows.co/log?action=conversion&key=' + encodeURIComponent(richAdsClickId) + '&price=' + payout;
        const richAdsResponse = await fetch(richAdsUrl);
        return new Response(
          JSON.stringify({ ok: true, eventName, afp, country, sentTo: 'richads', status: richAdsResponse.status }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      }

      const userData = {};

      // Quita el prefijo ad[...]_ antes de buscar el fbc.
      let fbcCandidate = afp;
      const adMatch = afp.match(/^ad\[[^\]]*\]_(.*)$/);
      if (adMatch) {
        fbcCandidate = adMatch[1];
      }
      if (fbcCandidate.startsWith('fb.')) {
        userData.fbc = fbcCandidate;
      }

      if (userId) {
        const data = new TextEncoder().encode(userId);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        userData.external_id = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }

      const eventPayload = {
        data: [
          {
            event_name: eventName,
            event_time: Math.floor(Date.now() / 1000),
            action_source: 'website',
            user_data: userData,
            custom_data: {
              currency: 'CLP',
              value: amount ? parseFloat(amount) : 0,
            },
          },
        ],
      };

      if (testCode) {
        eventPayload.test_event_code = testCode;
      }

      const metaUrl = `https://graph.facebook.com/v21.0/${env.META_PIXEL_ID}/events?access_token=${env.META_ACCESS_TOKEN}`;
      const metaResponse = await fetch(metaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventPayload),
      });
      const metaResult = await metaResponse.json();

      return new Response(JSON.stringify({ ok: true, eventName, afp, country, metaResult }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
