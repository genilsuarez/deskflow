// Nudge de login tras la primera actividad real — un solo intento en toda la
// vida del usuario, en la app donde primero complete algo (lp-login-prompted-v1
// es global a la plataforma). Script clásico sin `export`: FluentFlow lo carga
// como <script src> plano, no como módulo ESM.
// Ver docs/auditoria-y-plan.md — M3.
var lpLoginNudge = (function () {
  var SEEN_KEY = 'lp-login-prompted-v1';

  // hasProgress: boolean, ya evaluado por la app (cada una cuenta distinto).
  // copy: { eyebrow, title, lede } — mismo shape que lpLogin.open({ copy }).
  function maybePrompt(options) {
    options = options || {};
    if (typeof lpLogin === 'undefined') return false;
    if (localStorage.getItem(SEEN_KEY)) return false;
    if (lpLogin.getUser()) {
      localStorage.setItem(SEEN_KEY, '1');
      return false;
    }
    if (!options.hasProgress) return false;

    localStorage.setItem(SEEN_KEY, '1');
    if (typeof window.lpTrack === 'function') {
      window.lpTrack('login_prompt_after_first_activity');
    }
    lpLogin.open({ copy: options.copy });
    return true;
  }

  return { maybePrompt: maybePrompt };
})();
