/**
 * Learn Platform — shared URL helpers (lp-platform-urls spec v1)
 *
 * Production and local dev both use one origin with path prefixes:
 *   /deskflow/  /fluentflow/  /hubflow/  /lyricflow/
 *
 * Vanilla apps: load in <head> immediately after lp-theme.js.
 * React (FluentFlow): mirror in src/utils/platformUrls.ts.
 */
(function (global) {
  'use strict';

  var APPS = ['deskflow', 'fluentflow', 'hubflow', 'lyricflow'];
  var PRODUCTION_ORIGIN = 'https://genilsuarez.github.io';
  var LOCAL_GATEWAY_PORT = '3000';

  /** @deprecated — legacy independent dev ports; redirect to gateway paths. */
  var LEGACY_PORT_APP = {
    '3001': 'fluentflow',
    '3002': 'hubflow',
    '3003': 'lyricflow',
    '3100': 'deskflow',
    '3101': 'hubflow',
    '3102': 'lyricflow',
  };

  function isLocalDev() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.indexOf('192.168.') === 0;
  }

  function localGatewayOrigin() {
    return location.protocol + '//' + location.hostname + ':' + LOCAL_GATEWAY_PORT;
  }

  function joinUrl(base, path) {
    if (!path || path === '/') return base.endsWith('/') ? base : base + '/';
    try {
      return new URL(path.replace(/^\//, ''), base.endsWith('/') ? base : base + '/').toString();
    } catch (e) {
      return base;
    }
  }

  function appHref(app, path) {
    path = path || '/';
    if (APPS.indexOf(app) === -1) return '/';
    if (isLocalDev()) return joinUrl(localGatewayOrigin() + '/' + app + '/', path);
    return joinUrl(PRODUCTION_ORIGIN + '/' + app + '/', path);
  }

  function portalHref() {
    return appHref('deskflow');
  }

  function isSharedOrigin() {
    if (!isLocalDev()) return true;
    if (location.port !== LOCAL_GATEWAY_PORT) return false;
    return /^\/(deskflow|fluentflow|hubflow|lyricflow)(\/|$)/.test(location.pathname);
  }

  function redirectLegacyPortIfNeeded() {
    if (!isLocalDev()) return false;
    var app = LEGACY_PORT_APP[location.port];
    if (!app) return false;

    var path = location.pathname || '/';
    path = path.replace(/^\/(?:deskflow|fluentflow|hubflow|lyricflow)\/?/, '/');
    if (path === '/') path = '/';

    var target =
      localGatewayOrigin() +
      '/' +
      app +
      path +
      location.search +
      location.hash;
    location.replace(target);
    return true;
  }

  // Redirect before any app JS reads localStorage on a legacy port.
  redirectLegacyPortIfNeeded();

  global.LPPlatformUrls = {
    APPS: APPS,
    PRODUCTION_ORIGIN: PRODUCTION_ORIGIN,
    LOCAL_GATEWAY_PORT: LOCAL_GATEWAY_PORT,
    isLocalDev: isLocalDev,
    isSharedOrigin: isSharedOrigin,
    localGatewayOrigin: localGatewayOrigin,
    appHref: appHref,
    portalHref: portalHref,
    redirectLegacyPortIfNeeded: redirectLegacyPortIfNeeded,
  };
})(typeof window !== 'undefined' ? window : globalThis);
