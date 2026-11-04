// 1win-bridge: recibe el clic del anuncio de Meta, arma los sub y redirige al link de 1win.
// Es una redireccion simple y transparente: todos los visitantes van al mismo destino.
// (No hace deteccion de bots, revisores ni user agents; no muestra contenido distinto a nadie.)
//
// 1win CORTA cada sub a 128 caracteres y el fbclid de Meta mide 150-190, por eso va repartido:
//   sub1 = [<AdName>_]<ms>        (o [<AdName>_]noclid_<ms> si no hay fbclid)
//   sub2 = fbclid[0..100)   sub3 = fbclid[100..200)   sub4 = fbclid[200..300)
// El postback rearma el fbc: fb.1.<ms>.<sub2+sub3+sub4>
// IMPORTANTE: si cambia este formato, hay que actualizar 1win-postback y la URL del postback de 1win
// (tiene que incluir sub2, sub3 y sub4).
//
// Variables (wrangler.toml / panel de Cloudflare):
//   DEST_URL  link de 1win al que se redirige (con ?p=...). Default abajo.

const DEFAULT_DEST = 'https://one-vv1796.com/?p=qinc';
const CHUNK = 100;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const fbclid = url.searchParams.get('fbclid') || '';
    // Solo letras, numeros, guion y guion bajo: el nombre viaja dentro de sub1 y 1win lo repite en el postback.
    const adName = (url.searchParams.get('utm_content') || '').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 60);
    const ms = Date.now();

    let sub1 = fbclid ? String(ms) : 'noclid_' + ms;
    if (adName) sub1 = adName + '_' + sub1;

    let dest;
    try {
      dest = new URL(env.DEST_URL || DEFAULT_DEST);
    } catch (_) {
      return new Response('DEST_URL invalida', { status: 500 });
    }
    dest.searchParams.set('sub1', sub1);
    if (fbclid) {
      for (let i = 0; i < 3; i++) {
        const part = fbclid.slice(i * CHUNK, (i + 1) * CHUNK);
        if (part) dest.searchParams.set('sub' + (i + 2), part);
      }
    }

    return Response.redirect(dest.toString(), 302);
  },
};
