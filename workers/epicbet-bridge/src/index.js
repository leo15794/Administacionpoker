// epicbet-bridge: recibe el clic del anuncio de Meta, arma el `afp` y redirige a SISU.
// Formato de afp: [ad[<AdName>]_]<fb.1.<ms>.<fbclid> | ra.1.<ms>.<richAdsId> | noclid_<ms>>
// IMPORTANTE: si cambia este formato, hay que actualizar la extraccion en epicbet-postback.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const fbclid = url.searchParams.get('fbclid');
    const richAdsClickId = url.searchParams.get('utm_ra_click_id');
    const adName = url.searchParams.get('utm_content');
    const BTA = '35985';
    const BRAND = 'epicbet';

    let afp;
    if (fbclid) {
      afp = 'fb.1.' + Date.now() + '.' + fbclid;
    } else if (richAdsClickId) {
      afp = 'ra.1.' + Date.now() + '.' + richAdsClickId;
    } else {
      afp = 'noclid_' + Date.now();
    }
    if (adName) {
      afp = 'ad[' + adName + ']_' + afp;
    }

    const destination =
      'https://my.sisu.partners/visit/?bta=' + BTA + '&brand=' + BRAND + '&afp=' + encodeURIComponent(afp);
    return Response.redirect(destination, 302);
  },
};
