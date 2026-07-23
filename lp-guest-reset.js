/**
 * Learn Platform — guest/logout progress reset and auth session helpers.
 * Canonical copy — replicate to each app (DeskFlow root, HubFlow/LyricFlow root, FluentFlow/public/).
 */
(function (global) {
  'use strict';

  var HUB_SCORE_PREFIX_RE = /^(advcoll|art|causative|clause|cleft|coll|comp|cond|conf|dict|errhunt|ger|inver|irr|kwt|listen|madeof|modals|odd|paracloze|paraphrase|phonics|phrasal|plural|pos|pref|prep|pron-study|quant|regswitch|rs|sbe|sentcomb|stress|tense|usedto|vchunks|vocab|wf|wordorder|wr)-/;
  var LOGOUT_FLAG_KEY = 'lp-explicit-logout';
  var LOGOUT_FLAG_TTL_MS = 5 * 60 * 1000;
  var PROGRESS_APPS = ['fluentflow', 'hubflow', 'lyricflow'];
  var PRESERVED_CACHE_KEYS = { 'lp-theme': 1, 'lp-navigation-mode': 1, 'lp-user': 1 };

  var EMPTY_SCORE = { correct: 0, incorrect: 0, total: 0, accuracy: 0 };

  function patchZustandStorage(key, patchFn) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return;
      var data = JSON.parse(raw);
      var next = patchFn(data);
      if (next === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(next));
      }
    } catch (e) {
      /* noop */
    }
  }

  function isPreservedCacheKey(key) {
    if (PRESERVED_CACHE_KEYS[key]) return true;
    return /^sb-.+-auth-token$/.test(key);
  }

  function hasLocalSupabaseIdentity() {
    try {
      var raw = localStorage.getItem('lp-user');
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      return !!(parsed && parsed.isSupabaseUser);
    } catch (e) {
      return false;
    }
  }

  function hasLocalProgress() {
    for (var i = 0; i < PROGRESS_APPS.length; i++) {
      var key = 'learnflow:progress:' + PROGRESS_APPS[i] + ':v1';
      try {
        var raw = localStorage.getItem(key);
        if (!raw) continue;
        var doc = JSON.parse(raw);
        if (doc && doc.content && Object.keys(doc.content).length > 0) return true;
      } catch (e) {
        /* noop */
      }
    }
    return false;
  }

  function markExplicitLogout() {
    var stamp = String(Date.now());
    try {
      localStorage.setItem(LOGOUT_FLAG_KEY, stamp);
      sessionStorage.setItem(LOGOUT_FLAG_KEY, stamp);
    } catch (e) {
      /* noop */
    }
  }

  function isExplicitLogout() {
    try {
      var raw = localStorage.getItem(LOGOUT_FLAG_KEY);
      if (raw) {
        var ts = parseInt(raw, 10);
        if (!isNaN(ts) && Date.now() - ts < LOGOUT_FLAG_TTL_MS) return true;
        localStorage.removeItem(LOGOUT_FLAG_KEY);
      }
      var sessionRaw = sessionStorage.getItem(LOGOUT_FLAG_KEY);
      if (sessionRaw) {
        var sessionTs = parseInt(sessionRaw, 10);
        if (!isNaN(sessionTs) && Date.now() - sessionTs < LOGOUT_FLAG_TTL_MS) return true;
        sessionStorage.removeItem(LOGOUT_FLAG_KEY);
      }
    } catch (e) {
      /* noop */
    }
    return false;
  }

  function clearExplicitLogout() {
    try {
      localStorage.removeItem(LOGOUT_FLAG_KEY);
      sessionStorage.removeItem(LOGOUT_FLAG_KEY);
    } catch (e) {
      /* noop */
    }
  }

  function shouldRejectSession() {
    return isExplicitLogout();
  }

  function shouldForceCloudDownload() {
    if (isExplicitLogout()) return false;
    if (!hasLocalSupabaseIdentity()) return true;
    return !hasLocalProgress();
  }

  function clearSharedUserIdentity() {
    localStorage.removeItem('lp-user');
    patchZustandStorage('user-storage', function (data) {
      if (!data || typeof data !== 'object') return null;
      data.state = data.state || {};
      data.state.user = null;
      return data;
    });
  }

  function clearGuestLocalProgress() {
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf('learnflow:progress:') === 0 || k.indexOf('learnflow:activity:') === 0) {
        localStorage.removeItem(k);
        continue;
      }
      if (HUB_SCORE_PREFIX_RE.test(k)) {
        localStorage.removeItem(k);
      }
    }

    localStorage.removeItem('progress-storage');
    localStorage.removeItem('lp-sync-pending');

    clearSharedUserIdentity();

    patchZustandStorage('user-storage', function (data) {
      if (!data || typeof data !== 'object') return null;
      data.state = data.state || {};
      data.state.user = null;
      data.state.userScores = {};
      return data;
    });

    patchZustandStorage('app-storage', function (data) {
      if (!data || typeof data !== 'object') return null;
      data.state = data.state || {};
      data.state.globalScore = Object.assign({}, EMPTY_SCORE);
      data.state.sessionScore = Object.assign({}, EMPTY_SCORE);
      return data;
    });

    try {
      global.dispatchEvent(new CustomEvent('lp-guest-reset'));
    } catch (e) {
      /* noop */
    }
  }

  /** Wipe local learning cache but keep theme, display name, and Supabase session. */
  function clearLocalCachePreserveSession() {
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      if (!isPreservedCacheKey(keys[i])) {
        localStorage.removeItem(keys[i]);
      }
    }
    try {
      var sessionKeys = Object.keys(sessionStorage);
      for (var j = 0; j < sessionKeys.length; j++) {
        if (sessionKeys[j] !== LOGOUT_FLAG_KEY) {
          sessionStorage.removeItem(sessionKeys[j]);
        }
      }
    } catch (e) {
      /* noop */
    }
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('storage', function (e) {
      if (e.key !== LOGOUT_FLAG_KEY || !e.newValue) return;
      try {
        global.dispatchEvent(new CustomEvent('lp-explicit-logout'));
      } catch (err) {
        /* noop */
      }
    });
  }

  global.lpGuestReset = {
    clearGuestLocalProgress: clearGuestLocalProgress,
    clearSharedUserIdentity: clearSharedUserIdentity,
    clearLocalCachePreserveSession: clearLocalCachePreserveSession,
    hasLocalSupabaseIdentity: hasLocalSupabaseIdentity,
    hasLocalProgress: hasLocalProgress,
    markExplicitLogout: markExplicitLogout,
    isExplicitLogout: isExplicitLogout,
    clearExplicitLogout: clearExplicitLogout,
    shouldRejectSession: shouldRejectSession,
    shouldForceCloudDownload: shouldForceCloudDownload
  };
})(typeof window !== 'undefined' ? window : globalThis);
