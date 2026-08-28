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
//
// user_id: cuando hay sesión, se manda a GA4 (gtag('set', {user_id})) para que las
// sesiones de la MISMA cuenta en distintos navegadores/dispositivos se cuenten como un
// solo usuario en vez de uno por client_id — ver
// https://developers.google.com/analytics/devguides/collection/ga4/user-id. Con `null`
// se limpia (nunca string vacío, per la doc oficial). Los invitados sin cuenta siguen
// siendo anónimos por client_id — eso es correcto, no un déficit: no hay con qué
// identificarlos sin que se logueen.
// Se lee 'lp-user' directo de localStorage (mismo storage key que lp-login.js, sin
// importarlo) porque en las 4 apps lp-analytics.js se ejecuta ANTES que lp-login.js en
// el bundle (main.js) o en el <head> — depender de `window.lpLogin` en esta primera
// lectura fallaría. La suscripción a cambios en vivo (login/logout durante la sesión)
// espera al evento 'load' (no 'DOMContentLoaded'): los scripts <script defer> /
// type="module" corren cuando `document.readyState` YA pasó a 'interactive' — antes de
// que 'DOMContentLoaded' dispare, no después — así que un guard `readyState === 'loading'`
// acá siempre da falso y el registro nunca ocurre (bug real, encontrado probando en
// navegador: `lpLogin.setUser()` no disparaba el 'set' de gtag). 'load' sí garantiza
// que TODOS los scripts, incluido lp-login.js más adelante en el mismo import graph, ya
// corrieron — sin importar en qué momento de la carga se evalúa este archivo.

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

  function readLoggedInUserId() {
    try {
      var raw = localStorage.getItem('lp-user');
      var user = raw ? JSON.parse(raw) : null;
      return (user && user.id) || null;
    } catch (e) {
      return null;
    }
  }

  gtag('set', { user_id: readLoggedInUserId() });

  window.addEventListener('load', function () {
    if (window.lpLogin && typeof window.lpLogin.onUpdate === 'function') {
      window.lpLogin.onUpdate(function (user) {
        gtag('set', { user_id: (user && user.id) || null });
      });
    }
  });

  window.lpTrack = function (eventName, params) {
    gtag('event', eventName, params || {});
  };
})();
