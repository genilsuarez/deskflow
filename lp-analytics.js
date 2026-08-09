// lp-analytics.js — Canonical Google Analytics 4 (gtag.js) loader for Learn Platform.
// Copiado tal cual a DeskFlow (root), HubFlow (js/), LyricFlow (root), FluentFlow (public/),
// igual que lp-theme.js.
//
// Measurement ID de la property "LearnFlow" (GA4, stream https://genilsuarez.github.io).
//
// Implementa Google Consent Mode v2 (https://developers.google.com/tag-platform/security/guides/consent):
// el tag se carga SIEMPRE, pero arranca con analytics_storage denegado — no guarda
// cookies ni identifica a nadie — hasta que lp-cookie-consent.js reporte una decisión
// del usuario. Esto es lo que hace legal usar GA4 sin pedir permiso antes de cargar
// el script: no es "pedir consentimiento", es "arrancar denegado y activar si lo dan".
//
// window.lpTrack(eventName, params) queda disponible para eventos custom del embudo
// de onboarding (Fase D.2) sin acoplar analítica al schema de progreso de Supabase.

const MEASUREMENT_ID = 'G-YESJSS2XQF';

(function () {
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  // No hacemos publicidad — ad_storage/ad_user_data/ad_personalization quedan
  // denegados siempre. Solo analytics_storage se activa según la decisión del usuario.
  var stored = localStorage.getItem('lp-cookie-consent');
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: stored === 'granted' ? 'granted' : 'denied',
  });

  window.lpApplyAnalyticsConsent = function (granted) {
    gtag('consent', 'update', { analytics_storage: granted ? 'granted' : 'denied' });
  };

  if (MEASUREMENT_ID.startsWith('REEMPLAZAR')) {
    console.warn('[lp-analytics] MEASUREMENT_ID sin configurar — GA4 desactivado.');
    window.lpTrack = function () {};
    return;
  }

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
  document.head.appendChild(script);

  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);

  window.lpTrack = function (eventName, params) {
    gtag('event', eventName, params || {});
  };
})();
