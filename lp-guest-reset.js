/**
 * Learn Platform — clear local learning progress when leaving a cloud account.
 * Guest mode should start at zero; cloud progress stays in Supabase until next login.
 */
(function (global) {
  'use strict';

  var HUB_SCORE_PREFIX_RE = /^(advcoll|art|causative|clause|cleft|coll|comp|cond|conf|dict|errhunt|ger|inver|irr|kwt|listen|madeof|modals|odd|paracloze|paraphrase|phonics|phrasal|plural|pos|pref|prep|pron-study|quant|regswitch|rs|sbe|sentcomb|stress|tense|usedto|vchunks|vocab|wf|wordorder|wr)-/;

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

  global.lpGuestReset = {
    clearGuestLocalProgress: clearGuestLocalProgress
  };
})(typeof window !== 'undefined' ? window : globalThis);
