// lp-analytics.js — Canonical GoatCounter loader for Learn Platform.
// Copiado tal cual a DeskFlow (root), HubFlow (js/), LyricFlow (root), FluentFlow (public/),
// igual que lp-theme.js.
//
// GoatCounter (no Plausible: sin tier gratis desde 2026) — sin cookies, hosting gratis
// para proyectos personales/hobby. Reemplazar SITE_CODE tras crear la cuenta en
// https://www.goatcounter.com/ (paso manual, no delegable).
//
// window.lpTrack(eventName) queda disponible para eventos custom del embudo de
// onboarding (Fase D.2) sin acoplar analítica al schema de progreso de Supabase.

const SITE_CODE = 'REEMPLAZAR-CON-TU-CODIGO-GOATCOUNTER';

(function () {
  if (SITE_CODE.startsWith('REEMPLAZAR')) {
    console.warn('[lp-analytics] SITE_CODE sin configurar — analítica desactivada.');
    window.lpTrack = function () {};
    return;
  }

  const script = document.createElement('script');
  script.setAttribute('data-goatcounter', `https://${SITE_CODE}.goatcounter.com/count`);
  script.async = true;
  script.src = '//gc.zgo.at/count.js';
  document.head.appendChild(script);

  window.lpTrack = function (eventName, extra = {}) {
    if (!window.goatcounter || typeof window.goatcounter.count !== 'function') return;
    window.goatcounter.count({
      path: eventName,
      title: eventName,
      event: true,
      ...extra,
    });
  };
})();
