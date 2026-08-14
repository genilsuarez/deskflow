/**
 * LP Dev Tools — recompile / clear cache / screen info panel. Gated behind
 * the shared "Modo Desarrollo" flag that FluentFlow's Advanced settings
 * writes to the `settings-storage` localStorage key (see
 * lp-fluentflow-settings.js) — same origin in prod and local dev, so toggling
 * it once in FluentFlow reveals this section here too. Lives inside the
 * static #settingsOverlay markup (see #settingsSectionDev in index.html);
 * this module only wires up the toggles and actions.
 *
 *   lpDevTools.updateSectionVisibility()
 */
/* eslint-disable no-var */
var lpDevTools = (function () {
  'use strict';

  var SETTINGS_KEY = 'settings-storage';
  var PRESERVED_STORAGE_KEYS = { 'lp-theme': true, 'lp-navigation-mode': true, 'lp-user': true };

  function isPreservedStorageKey(key) {
    return PRESERVED_STORAGE_KEYS[key] === true || /^sb-.+-auth-token$/.test(key);
  }

  function canAccess() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return !!(parsed && parsed.state && parsed.state.developmentMode);
    } catch (e) {
      return false;
    }
  }

  function updateSectionVisibility() {
    var section = document.getElementById('settingsSectionDev');
    if (section) section.hidden = !canAccess();
  }

  function buildStamp() {
    var buildTime = window.__BUILD_TIME__;
    var date = new Date(buildTime || new Date().toISOString());
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function getScreenInfo() {
    return {
      resolution: window.screen.width + ' × ' + window.screen.height,
      viewport: window.innerWidth + ' × ' + window.innerHeight,
      pixelRatio: (window.devicePixelRatio || 1) + 'x',
      colorDepth: window.screen.colorDepth + ' bits',
      orientation: (window.screen.orientation && window.screen.orientation.type) || 'unknown',
    };
  }

  function renderScreenGrid(info) {
    var rows = [
      ['Resolución', info.resolution],
      ['Ventana', info.viewport],
      ['Ratio de Píxeles', info.pixelRatio],
      ['Profundidad de Color', info.colorDepth],
      ['Orientación', info.orientation],
    ];
    return rows.map(function (row) {
      return '<div><dt>' + row[0] + '</dt><dd>' + row[1] + '</dd></div>';
    }).join('');
  }

  async function clearCache() {
    try {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (key) { return caches.delete(key); }));
      if ('serviceWorker' in navigator) {
        var registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(function (registration) { return registration.unregister(); }));
      }
    } catch (e) {
      /* Reload even when a browser does not expose every cache API. */
    }
    try {
      if (window.lpGuestReset && window.lpGuestReset.clearLocalCachePreserveSession) {
        window.lpGuestReset.clearLocalCachePreserveSession();
      } else {
        Object.keys(localStorage).forEach(function (key) {
          if (!isPreservedStorageKey(key)) localStorage.removeItem(key);
        });
        Object.keys(sessionStorage).forEach(function (key) { sessionStorage.removeItem(key); });
      }
    } catch (e) {
      /* Private browsing or storage unavailable — Cache Storage/SW cleanup above still ran. */
    }
    window.location.reload();
  }

  function scrollIntoViewWhenReady(el) {
    requestAnimationFrame(function () {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  }

  function init() {
    var trigger = document.getElementById('devToolsTrigger');
    var panel = document.getElementById('devToolsPanel');
    var buildStampEl = document.getElementById('devBuildStamp');
    var recompileBtn = document.getElementById('devRecompileBtn');
    var clearCacheBtn = document.getElementById('devClearCacheBtn');
    var cacheConfirm = document.getElementById('devCacheConfirm');
    var cacheCancelBtn = document.getElementById('devCacheCancelBtn');
    var cacheConfirmBtn = document.getElementById('devCacheConfirmBtn');
    var screenInfoBtn = document.getElementById('devScreenInfoBtn');
    var screenGrid = document.getElementById('devScreenGrid');
    if (!trigger || !panel) return;

    trigger.addEventListener('click', function () {
      var next = panel.hidden;
      panel.hidden = !next;
      trigger.setAttribute('aria-expanded', String(next));
      if (next) buildStampEl.textContent = 'B: ' + buildStamp();
    });

    recompileBtn.addEventListener('click', function () {
      window.location.reload();
    });

    clearCacheBtn.addEventListener('click', function () {
      var next = cacheConfirm.hidden;
      cacheConfirm.hidden = !next;
      clearCacheBtn.setAttribute('aria-expanded', String(next));
      if (next) {
        screenGrid.hidden = true;
        screenInfoBtn.setAttribute('aria-expanded', 'false');
        scrollIntoViewWhenReady(cacheConfirm);
      }
    });

    cacheCancelBtn.addEventListener('click', function () {
      cacheConfirm.hidden = true;
      clearCacheBtn.setAttribute('aria-expanded', 'false');
    });

    cacheConfirmBtn.addEventListener('click', function () {
      cacheConfirmBtn.disabled = true;
      cacheCancelBtn.disabled = true;
      cacheConfirmBtn.textContent = '…';
      clearCache();
    });

    screenInfoBtn.addEventListener('click', function () {
      var next = screenGrid.hidden;
      screenGrid.hidden = !next;
      screenInfoBtn.setAttribute('aria-expanded', String(next));
      if (next) {
        cacheConfirm.hidden = true;
        clearCacheBtn.setAttribute('aria-expanded', 'false');
        screenGrid.innerHTML = renderScreenGrid(getScreenInfo());
        scrollIntoViewWhenReady(screenGrid);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { updateSectionVisibility: updateSectionVisibility };
})();
