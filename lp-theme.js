/**
 * Learn Platform — unified theme helpers (lp-theme spec v1)
 * Vanilla apps: load in <head> before CSS. React (FluentFlow) uses themeInitializer.ts.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'lp-theme';
  var META_LIGHT = '#ffffff';
  var META_DARK = '#181b20';

  function isLocalDev() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.indexOf('192.168.') === 0;
  }

  function readInitialTheme() {
    var urlTheme = new URLSearchParams(location.search).get('theme');
    if (urlTheme === 'dark' || urlTheme === 'light') {
      try {
        localStorage.setItem(STORAGE_KEY, urlTheme);
      } catch (e) {
        /* noop */
      }
      return urlTheme;
    }
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    return 'light';
  }

  function getStoredTheme() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch (e) {
      /* noop */
    }
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  var APP_PATH_RE = /^\/(deskflow|fluentflow|hubflow|lyricflow)(\/|$)/;

  function isCrossAppHref(href) {
    if (!href || href.charAt(0) === '#') return false;
    try {
      var url = new URL(href, location.origin);
      if (!isLocalDev()) return false;
      // Same gateway origin — localStorage is shared; no ?theme= bridge needed.
      if (url.origin === location.origin) return false;
      var host = url.hostname;
      var isLocalHost =
        host === 'localhost' || host === '127.0.0.1' || host.indexOf('192.168.') === 0;
      if (!isLocalHost) return false;
      if (url.port && url.port !== location.port) return true;
      return APP_PATH_RE.test(url.pathname);
    } catch (e) {
      return false;
    }
  }

  function syncThemeUrlParam(theme) {
    var url = new URL(location.href);
    if (!url.searchParams.has('theme')) return;
    url.searchParams.set('theme', theme);
    history.replaceState(null, '', url.toString());
  }

  function updateMetaTags(theme) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? META_DARK : META_LIGHT);
    var colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
    if (colorSchemeMeta) colorSchemeMeta.setAttribute('content', theme);
    document.documentElement.style.colorScheme = theme;
  }

  function applyTheme(theme, options) {
    options = options || {};
    var html = document.documentElement;
    if (options.transition) html.classList.add('theme-transitioning');
    if (theme === 'dark') html.setAttribute('data-theme', 'dark');
    else html.removeAttribute('data-theme');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* noop */
    }
    updateMetaTags(theme);
    syncThemeUrlParam(theme);
    if (options.transition) {
      setTimeout(function () {
        html.classList.remove('theme-transitioning');
      }, 350);
    }
  }

  function toggleTheme() {
    applyTheme(getStoredTheme() === 'dark' ? 'light' : 'dark', { transition: true });
  }

  function appendThemeToHref(href) {
    if (!isLocalDev() || !href) return href;
    try {
      var url = new URL(href, location.origin);
      var host = url.hostname;
      if (
        host !== 'localhost' &&
        host !== '127.0.0.1' &&
        host.indexOf('192.168.') !== 0
      ) {
        return href;
      }
      url.searchParams.set('theme', getStoredTheme());
      return url.toString();
    } catch (e) {
      return href;
    }
  }

  function setupCrossAppThemeLinks() {
    if (!isLocalDev()) return;
    document.addEventListener('click', function (e) {
      var a = e.target.closest('a[href]');
      if (!a) return;
      var raw = a.getAttribute('href');
      if (!isCrossAppHref(raw)) return;
      var theme = getStoredTheme();
      try {
        var url = new URL(raw, location.origin);
        url.searchParams.set('theme', theme);
        a.href = url.toString();
      } catch (err) {
        /* noop */
      }
    });
  }

  function initEarly() {
    var theme = readInitialTheme();
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      /* noop */
    }
    updateMetaTags(theme);
  }

  // Run before paint when loaded in <head>
  initEarly();

  global.LPTheme = {
    STORAGE_KEY: STORAGE_KEY,
    META_LIGHT: META_LIGHT,
    META_DARK: META_DARK,
    readInitialTheme: readInitialTheme,
    getStoredTheme: getStoredTheme,
    applyTheme: applyTheme,
    toggleTheme: toggleTheme,
    syncThemeUrlParam: syncThemeUrlParam,
    appendThemeToHref: appendThemeToHref,
    setupCrossAppThemeLinks: setupCrossAppThemeLinks,
    isLocalDev: isLocalDev,
  };

  function onReady() {
    setupCrossAppThemeLinks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})(typeof window !== 'undefined' ? window : globalThis);
