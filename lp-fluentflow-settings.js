/**
 * LP FluentFlow Settings — lets DeskFlow control FluentFlow's General/Games
 * advanced settings by reading/writing the same localStorage key FluentFlow's
 * zustand `settings-storage` persists to (shared origin in prod and local dev).
 * DeskFlow-only: not copied to HubFlow/LyricFlow (those apps don't have an
 * equivalent settings store yet).
 *
 * Offline downloads stay in FluentFlow — they depend on FluentFlow's own
 * Vite-built asset URLs and Cache API bucket, which can't be replicated here
 * without duplicating (and drifting from) FluentFlow's build.
 *
 *   lpFluentFlowSettings.updateSectionVisibility()
 *   lpFluentFlowSettings.open(event, options)
 */
/* eslint-disable no-var */
var lpFluentFlowSettings = (function () {
  'use strict';

  var SETTINGS_KEY = 'settings-storage';
  var ADVANCED_EMAIL = 'genil.suarez@gmail.com';

  var DEFAULT_STATE = {
    language: 'es',
    developmentMode: false,
    randomizeItems: true,
    gameSettings: {
      flashcardMode: { wordCount: 8 },
      quizMode: { questionCount: 8 },
      completionMode: { itemCount: 8 },
      sortingMode: { wordCount: 4, categoryCount: 3 },
      matchingMode: { wordCount: 5 },
      reorderingMode: { itemCount: 8 },
      transformationMode: { itemCount: 8 },
      wordFormationMode: { itemCount: 8 },
      errorCorrectionMode: { itemCount: 8 },
      dictationMode: { itemCount: 5 },
      listenCompleteMode: { itemCount: 8 },
      listeningQuizMode: { itemCount: 8 },
    },
  };

  var GAMES = [
    { mode: 'flashcardMode', field: 'wordCount', label: 'Flashcards', min: 5, max: 30 },
    { mode: 'quizMode', field: 'questionCount', label: 'Quiz', min: 5, max: 25 },
    { mode: 'completionMode', field: 'itemCount', label: 'Completar', min: 5, max: 20 },
    { mode: 'sortingMode', field: 'wordCount', label: 'Clasificar', min: 4, max: 12 },
    { mode: 'matchingMode', field: 'wordCount', label: 'Emparejar', min: 4, max: 12 },
    { mode: 'reorderingMode', field: 'itemCount', label: 'Reordenar', min: 5, max: 20 },
    { mode: 'transformationMode', field: 'itemCount', label: 'Transformar', min: 5, max: 20 },
    { mode: 'wordFormationMode', field: 'itemCount', label: 'Formación de palabras', min: 5, max: 20 },
    { mode: 'errorCorrectionMode', field: 'itemCount', label: 'Corrección de errores', min: 5, max: 20 },
    { mode: 'dictationMode', field: 'itemCount', label: 'Dictado', min: 5, max: 20 },
    { mode: 'listenCompleteMode', field: 'itemCount', label: 'Escuchar y completar', min: 5, max: 20 },
    { mode: 'listeningQuizMode', field: 'itemCount', label: 'Quiz de escucha', min: 5, max: 20 },
  ];

  function canAccess() {
    var host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.indexOf('192.168.') === 0) return true;
    var user = window.lpLogin && window.lpLogin.getUser && window.lpLogin.getUser();
    return !!(user && user.email && user.email.trim().toLowerCase() === ADVANCED_EMAIL);
  }

  function readSettings() {
    var state = DEFAULT_STATE;
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      state = (parsed && parsed.state) || {};
    } catch (e) {
      state = {};
    }
    return {
      language: state.language || DEFAULT_STATE.language,
      developmentMode: !!state.developmentMode,
      randomizeItems: state.randomizeItems !== false,
      gameSettings: Object.assign({}, DEFAULT_STATE.gameSettings, state.gameSettings || {}),
    };
  }

  function writePatch(patch) {
    var raw, parsed;
    try {
      raw = localStorage.getItem(SETTINGS_KEY);
      parsed = raw ? JSON.parse(raw) : { state: {}, version: 2 };
    } catch (e) {
      parsed = { state: {}, version: 2 };
    }
    var state = parsed.state || {};
    var next = Object.assign({}, state, patch);
    if (patch.gameSettings) {
      var mergedGameSettings = Object.assign({}, state.gameSettings);
      Object.keys(patch.gameSettings).forEach(function (mode) {
        mergedGameSettings[mode] = Object.assign(
          {},
          state.gameSettings && state.gameSettings[mode],
          patch.gameSettings[mode]
        );
      });
      next.gameSettings = mergedGameSettings;
    }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ state: next, version: parsed.version || 2 }));
    } catch (e) {
      /* noop — storage unavailable */
    }
  }

  function setGameField(mode, field, value) {
    var patchMode = {};
    patchMode[field] = value;
    var gameSettings = {};
    gameSettings[mode] = patchMode;
    writePatch({ gameSettings: gameSettings });
  }

  function updateSectionVisibility() {
    var section = document.getElementById('settingsSectionFluentFlow');
    if (section) section.hidden = !canAccess();
  }

  function renderStepperRow(game, settings) {
    var value = (settings.gameSettings[game.mode] && settings.gameSettings[game.mode][game.field]) || game.min;
    return (
      '<div class="lp-ff-stepper" data-mode="' + game.mode + '" data-field="' + game.field +
      '" data-min="' + game.min + '" data-max="' + game.max + '">' +
      '<span class="lp-ff-stepper__label">' + game.label + '</span>' +
      '<div class="lp-ff-stepper__control">' +
      '<button type="button" class="lp-ff-stepper__btn" data-step="-1" aria-label="Reducir ' + game.label + '">−</button>' +
      '<span class="lp-ff-stepper__value">' + value + '</span>' +
      '<button type="button" class="lp-ff-stepper__btn" data-step="1" aria-label="Aumentar ' + game.label + '">+</button>' +
      '</div></div>'
    );
  }

  function renderBody(settings) {
    return (
      '<div class="lp-ff-tabs" role="tablist">' +
      '<button type="button" class="lp-ff-tab is-active" data-tab="general" role="tab" aria-selected="true">General</button>' +
      '<button type="button" class="lp-ff-tab" data-tab="games" role="tab" aria-selected="false">Juegos</button>' +
      '</div>' +
      '<div class="lp-ff-panel" data-panel="general">' +
      '<div class="lp-ff-row">' +
      '<span class="lp-ff-row__label">Idioma</span>' +
      '<div class="lp-ff-segmented" role="group" aria-label="Idioma">' +
      '<button type="button" class="lp-ff-segment' + (settings.language === 'en' ? ' is-active' : '') + '" data-lang="en" aria-pressed="' + (settings.language === 'en') + '">EN</button>' +
      '<button type="button" class="lp-ff-segment' + (settings.language === 'es' ? ' is-active' : '') + '" data-lang="es" aria-pressed="' + (settings.language === 'es') + '">ES</button>' +
      '</div></div>' +
      '<div class="lp-ff-row">' +
      '<label class="lp-ff-row__label" for="ffDevelopmentMode">Modo Desarrollo</label>' +
      '<input type="checkbox" id="ffDevelopmentMode" class="lp-ff-toggle" data-field="developmentMode"' + (settings.developmentMode ? ' checked' : '') + '>' +
      '</div>' +
      '<div class="lp-ff-row">' +
      '<label class="lp-ff-row__label" for="ffRandomizeItems">Aleatorizar ítems</label>' +
      '<input type="checkbox" id="ffRandomizeItems" class="lp-ff-toggle" data-field="randomizeItems"' + (settings.randomizeItems ? ' checked' : '') + '>' +
      '</div>' +
      '</div>' +
      '<div class="lp-ff-panel" data-panel="games" hidden>' +
      GAMES.map(function (game) { return renderStepperRow(game, settings); }).join('') +
      '</div>'
    );
  }

  function open(event, options) {
    options = options || {};
    if (!canAccess()) return;

    document.getElementById('fluentflowSettings')?.remove();
    var opener =
      event && event.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
    var inertTargets = options.inertElements || [];
    if (options.beforeOpen) options.beforeOpen();
    inertTargets.forEach(function (el) { if (el) el.inert = true; });

    var settings = readSettings();
    var overlay = document.createElement('div');
    overlay.id = 'fluentflowSettings';
    overlay.className = 'lp-settings-overlay';
    overlay.innerHTML =
      '<section class="lp-settings-modal" role="dialog" aria-modal="true" aria-labelledby="fluentflowSettingsTitle">' +
      '<header class="lp-settings-header">' +
      '<h2 id="fluentflowSettingsTitle">Configuración avanzada · FluentFlow</h2>' +
      '<button class="lp-settings-close" id="fluentflowSettingsCloseBtn" type="button" aria-label="Cerrar">✕</button>' +
      '</header>' +
      '<div class="lp-settings-body lp-ff-body">' + renderBody(settings) + '</div>' +
      '<footer class="lp-ff-footer">Los cambios se aplican la próxima vez que abras FluentFlow.</footer>' +
      '</section>';
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      inertTargets.forEach(function (el) { if (el) el.inert = false; });
      document.removeEventListener('keydown', onKeydown);
      if (options.onClose) options.onClose();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    }

    function onKeydown(keyEvent) {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        close();
      }
    }

    overlay.querySelector('#fluentflowSettingsCloseBtn').addEventListener('click', close);
    overlay.addEventListener('click', function (clickEvent) {
      if (clickEvent.target === overlay) close();
    });
    document.addEventListener('keydown', onKeydown);

    overlay.querySelectorAll('.lp-ff-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        overlay.querySelectorAll('.lp-ff-tab').forEach(function (t) {
          t.classList.toggle('is-active', t === tab);
          t.setAttribute('aria-selected', String(t === tab));
        });
        var target = tab.dataset.tab;
        overlay.querySelectorAll('.lp-ff-panel').forEach(function (panel) {
          panel.hidden = panel.dataset.panel !== target;
        });
      });
    });

    overlay.querySelectorAll('.lp-ff-segment').forEach(function (segment) {
      segment.addEventListener('click', function () {
        writePatch({ language: segment.dataset.lang });
        overlay.querySelectorAll('.lp-ff-segment').forEach(function (s) {
          s.classList.toggle('is-active', s === segment);
          s.setAttribute('aria-pressed', String(s === segment));
        });
      });
    });

    overlay.querySelectorAll('.lp-ff-toggle').forEach(function (toggle) {
      toggle.addEventListener('change', function () {
        var patch = {};
        patch[toggle.dataset.field] = toggle.checked;
        writePatch(patch);
      });
    });

    overlay.querySelectorAll('.lp-ff-stepper').forEach(function (stepper) {
      var mode = stepper.dataset.mode;
      var field = stepper.dataset.field;
      var min = Number(stepper.dataset.min);
      var max = Number(stepper.dataset.max);
      var valueEl = stepper.querySelector('.lp-ff-stepper__value');
      stepper.querySelectorAll('.lp-ff-stepper__btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var next = Number(valueEl.textContent) + Number(btn.dataset.step);
          next = Math.max(min, Math.min(max, next));
          valueEl.textContent = String(next);
          setGameField(mode, field, next);
        });
      });
    });

    overlay.querySelector('#fluentflowSettingsCloseBtn').focus();
  }

  return { open: open, updateSectionVisibility: updateSectionVisibility };
})();

window.lpFluentFlowSettings = lpFluentFlowSettings; // ESM side-effect import (main.js) does not attach top-level vars to window like a classic <script> did — restore it explicitly.
