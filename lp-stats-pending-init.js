/**
 * Early boot: hide home stats before ES modules load (prevents HTML default flash).
 * Inline in <head> of each app — see copy-shared.sh.
 */
(function () {
  'use strict';
  try {
    for (var index = 0; index < localStorage.length; index += 1) {
      var key = localStorage.key(index);
      if (!key || !/^sb-.+-auth-token$/.test(key)) continue;
      var parsed = JSON.parse(localStorage.getItem(key) || 'null');
      if (parsed && (parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token))) {
        document.documentElement.dataset.statsPending = 'true';
        break;
      }
    }
  } catch (e) {
    /* noop */
  }
})();
