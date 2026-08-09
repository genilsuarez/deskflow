// lp-cookie-consent.js — Canonical cookie consent banner for Learn Platform.
// Copiado tal cual a DeskFlow (root), HubFlow (js/), LyricFlow (root), FluentFlow (public/).
// Requiere lp-cookie-consent.css y debe cargarse DESPUÉS de lp-analytics.js
// (usa window.lpApplyAnalyticsConsent, definido ahí).
//
// Decisión del usuario en localStorage['lp-cookie-consent'] = 'granted' | 'denied'.
// Botones "Aceptar"/"Rechazar" con el mismo peso visual — GDPR exige que rechazar
// sea igual de fácil que aceptar, no un link chiquito escondido.
/* eslint-disable no-var */
(function () {
  'use strict';

  var CONSENT_KEY = 'lp-cookie-consent';

  function privacyHref() {
    return 'privacy.html';
  }

  function decide(granted) {
    localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied');
    if (typeof window.lpApplyAnalyticsConsent === 'function') {
      window.lpApplyAnalyticsConsent(granted);
    }
    var banner = document.getElementById('lpCookieConsent');
    if (banner) banner.remove();
  }

  function render() {
    if (localStorage.getItem(CONSENT_KEY)) return;

    var banner = document.createElement('div');
    banner.id = 'lpCookieConsent';
    banner.className = 'cookie-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Aviso de cookies');
    banner.innerHTML =
      '<p class="cookie-consent__text">Usamos cookies para entender cómo se usa la plataforma y mejorarla. ' +
      '<a href="' + privacyHref() + '">Más información</a>.</p>' +
      '<div class="cookie-consent__actions">' +
      '<button type="button" class="cookie-consent__btn cookie-consent__btn--reject" id="cookieConsentReject">Rechazar</button>' +
      '<button type="button" class="cookie-consent__btn cookie-consent__btn--accept" id="cookieConsentAccept">Aceptar</button>' +
      '</div>';

    document.body.appendChild(banner);
    document.getElementById('cookieConsentAccept').addEventListener('click', function () {
      decide(true);
    });
    document.getElementById('cookieConsentReject').addEventListener('click', function () {
      decide(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
