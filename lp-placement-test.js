/**
 * LP Placement Test — examen real B2+ (Fases P.2-P.4 del plan de examen).
 * Ver docs/placement-test-b2plus-plan.md — diseño two-stage fixed-form.
 * Solo DeskFlow — no se comparte con FluentFlow/HubFlow/LyricFlow.
 *
 * Requiere:
 *  - lp-placement-test.css
 *  - lp-placement-items.json (ítems curados, copia de scripts/lp-placement-items.json)
 *  - la función pura scorePlacement (scripts/lp-placement-scoring.js), inyectada por
 *    quien llama a open()/maybeShowOffer() — este archivo es un <script> plano, no un
 *    módulo, así que no la importa directo (mismo patrón que app.js con lpOnboarding).
 */
/* eslint-disable no-var */
var lpPlacementTest = (function () {
  'use strict';

  var PENDING_KEY = 'lp-placement-test-pending';
  var SESSION_DISMISS_KEY = 'lp-placement-offer-dismissed';
  var ITEMS_URL = 'lp-placement-items.json';

  // Quien llega acá se autoreportó B2+ en el onboarding (ver nota junto a
  // LEVEL_OPTIONS en lp-onboarding.js — self-report no es confiable por sí solo,
  // por eso igual se verifica con un piso B1 real). Pero forzar las 15 preguntas
  // completas de B1 a alguien que ya dijo "domino esto" es fricción innecesaria:
  // se acorta el piso a una verificación rápida en vez de eliminarlo.
  var QUICK_FLOOR_SIZE = 5;

  var STAGE_LABELS = {
    b1: 'Nivel B1 (piso)',
    b2: 'Nivel B2',
    c1: 'Nivel C1',
    c2: 'Nivel C2',
  };

  function isPending() {
    return localStorage.getItem(PENDING_KEY) === '1';
  }

  function track(eventName, params) {
    if (typeof window.lpTrack === 'function') window.lpTrack(eventName, params);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function fetchItems() {
    return fetch(ITEMS_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('lp-placement-items.json fetch failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        return data.items;
      });
  }

  function findBlock(result, level) {
    for (var i = 0; i < result.stage2Blocks.length; i++) {
      if (result.stage2Blocks[i].level === level) return result.stage2Blocks[i];
    }
    return null;
  }

  /**
   * @param {object} options
   * @param {function} options.score - scorePlacement (scripts/lp-placement-scoring.js)
   * @param {string} options.stage1Level - STAGE1_LEVEL exportado por lp-placement-scoring.js
   * @param {string[]} options.stage2Levels - STAGE2_LEVELS exportado por lp-placement-scoring.js
   */
  function open(options) {
    options = options || {};
    if (typeof options.score !== 'function') {
      throw new Error('lpPlacementTest.open requiere options.score (scorePlacement)');
    }
    if (!options.stage1Level || !options.stage2Levels) {
      throw new Error('lpPlacementTest.open requiere options.stage1Level y options.stage2Levels');
    }

    track('placement_test_started');

    fetchItems()
      .then(function (items) {
        renderExam(items, options);
      })
      .catch(function (err) {
        console.error('[lpPlacementTest]', err);
      });
  }

  function renderExam(items, options) {
    var levelOrder = [options.stage1Level].concat(options.stage2Levels);
    var itemsByLevel = {};
    levelOrder.forEach(function (lvl) {
      itemsByLevel[lvl] = items.filter(function (it) {
        return it.level === lvl;
      });
    });

    // Piso B1 acortado para quien se autoreportó B2+ (ver nota de QUICK_FLOOR_SIZE).
    if (isPending() && itemsByLevel[options.stage1Level].length > QUICK_FLOOR_SIZE) {
      itemsByLevel[options.stage1Level] = itemsByLevel[options.stage1Level].slice(0, QUICK_FLOOR_SIZE);
    }

    var state = {
      levelIndex: 0,
      itemIndex: 0,
      presentedItems: [],
      answers: [],
      answered: false,
    };

    var overlay = document.createElement('div');
    overlay.id = 'lpPlacementTest';
    overlay.className = 'placement-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'placementTestTitle');
    document.body.appendChild(overlay);
    document.body.classList.add('placement-open');

    var appShell = document.querySelector('.app-shell');
    if (appShell) appShell.inert = true;

    var card = document.createElement('section');
    card.className = 'placement-card';

    var topbar = document.createElement('div');
    topbar.className = 'placement-topbar';
    var counter = document.createElement('span');
    counter.className = 'placement-topbar__counter';
    topbar.appendChild(counter);
    var progress = document.createElement('div');
    progress.className = 'placement-progress';
    var progressFill = document.createElement('div');
    progressFill.className = 'placement-progress__fill';
    progress.appendChild(progressFill);
    topbar.appendChild(progress);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'placement-close';
    closeBtn.setAttribute('aria-label', 'Cerrar examen');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', function () {
      close({ reload: false });
    });
    topbar.appendChild(closeBtn);
    card.appendChild(topbar);

    var body = document.createElement('div');
    body.className = 'placement-body';
    card.appendChild(body);

    var footer = document.createElement('div');
    footer.className = 'placement-footer';
    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'lp-btn lp-btn--primary placement-next';
    nextBtn.disabled = true;
    footer.appendChild(nextBtn);
    card.appendChild(footer);

    overlay.appendChild(card);

    function currentLevel() {
      return levelOrder[state.levelIndex];
    }

    function currentBlock() {
      return itemsByLevel[currentLevel()];
    }

    function updateTopbar() {
      var block = currentBlock();
      counter.textContent = STAGE_LABELS[currentLevel()] + ' · Pregunta ' + (state.itemIndex + 1) + ' de ' + block.length;
      progressFill.style.width = Math.round((state.itemIndex / block.length) * 100) + '%';
    }

    function renderQuestion() {
      state.answered = false;
      nextBtn.disabled = true;
      var block = currentBlock();
      var isVeryLastItem = state.levelIndex === levelOrder.length - 1 && state.itemIndex === block.length - 1;
      nextBtn.textContent = isVeryLastItem ? 'Ver resultado' : 'Siguiente';
      updateTopbar();

      var item = block[state.itemIndex];
      body.innerHTML = '';
      body.insertAdjacentHTML('beforeend', '<h2 id="placementTestTitle">' + escapeHtml(item.question) + '</h2>');

      var optionsWrap = document.createElement('div');
      optionsWrap.className = 'placement-options';
      item.options.forEach(function (optionText) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'placement-option';
        btn.textContent = optionText;
        btn.addEventListener('click', function () {
          if (state.answered) return;
          state.answered = true;
          state.presentedItems.push(item);
          state.answers.push(optionText);

          Array.prototype.slice.call(optionsWrap.children).forEach(function (b) {
            b.disabled = true;
            if (b.textContent === item.correct) b.classList.add('is-correct');
            else if (b === btn) b.classList.add('is-wrong');
          });

          if (item.explanation) {
            var expl = document.createElement('p');
            expl.className = 'placement-explanation';
            expl.textContent = item.explanation;
            body.appendChild(expl);
          }

          nextBtn.disabled = false;
          nextBtn.focus();
        });
        optionsWrap.appendChild(btn);
      });
      body.appendChild(optionsWrap);
    }

    nextBtn.addEventListener('click', function () {
      if (!state.answered) return;

      var block = currentBlock();
      if (state.itemIndex < block.length - 1) {
        state.itemIndex += 1;
        renderQuestion();
        return;
      }

      // Bloque de nivel terminado — evaluar si se sigue al siguiente (Etapa 1
      // solo decide seguir/cortar; Etapa 2 corta en el primer bloque reprobado).
      var result = options.score(state.presentedItems, state.answers);
      var level = currentLevel();
      var blockPassed = level === options.stage1Level ? result.stage1.passed : (findBlock(result, level) || {}).passed;
      var isLastLevel = state.levelIndex === levelOrder.length - 1;

      if (!blockPassed || isLastLevel) {
        finish(result);
      } else {
        state.levelIndex += 1;
        state.itemIndex = 0;
        renderQuestion();
      }
    });

    function finish(result) {
      localStorage.setItem('lp-level', result.level);
      localStorage.removeItem(PENDING_KEY);
      track('placement_test_completed', { level: result.level });
      renderResult(result);
    }

    function renderResult(result) {
      progressFill.style.width = '100%';
      topbar.style.display = 'none';
      body.innerHTML = '';
      footer.innerHTML = '';

      var copy = result.stage1.passed
        ? 'Ajustamos tu contenido a nivel ' + result.level.toUpperCase() + '. Los niveles anteriores siguen disponibles para repasar, ya no son obligatorios.'
        : 'Confirmamos tu nivel B1 — sigue siendo tu punto de partida real, con acceso a todo el contenido para repasar cuando quieras.';

      body.insertAdjacentHTML(
        'beforeend',
        '<div class="placement-result-badge" aria-hidden="true">' + result.level.toUpperCase() + '</div>' +
          '<h2 id="placementTestTitle">Tu nivel confirmado: ' + result.level.toUpperCase() + '</h2>' +
          '<p class="placement-body-text">' + copy + '</p>'
      );

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'lp-btn lp-btn--primary placement-next';
      closeBtn.textContent = 'Continuar';
      closeBtn.addEventListener('click', function () {
        close({ reload: true });
      });
      footer.appendChild(closeBtn);
    }

    function close(closeOptions) {
      var reload = !!(closeOptions && closeOptions.reload);
      overlay.remove();
      document.body.classList.remove('placement-open');
      if (appShell) appShell.inert = false;
      document.removeEventListener('keydown', onKeydown);
      if (reload) {
        location.reload();
        return;
      }
      var main = document.getElementById('mainContent');
      if (main) main.focus({ preventScroll: true });
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        // v1 no guarda progreso parcial (decisión de producto, ver plan) — cerrar
        // a mitad de examen no escribe nada; el flag pending sigue activo y se
        // puede reintentar completo más adelante.
        close({ reload: false });
      }
    }
    document.addEventListener('keydown', onKeydown);

    renderQuestion();
  }

  // --- P.3: aviso descartable en el dashboard, ofrecido tras la primera
  // actividad real (misma señal que B.5, allValidEvents().length > 0). ---
  function maybeShowOffer(container, options) {
    if (!container) return;
    if (!isPending()) return;
    if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return;
    if (document.getElementById('placementOffer')) return;

    track('placement_test_offered');

    var offer = document.createElement('section');
    offer.id = 'placementOffer';
    offer.className = 'placement-offer';
    offer.setAttribute('aria-labelledby', 'placementOfferTitle');
    offer.innerHTML =
      '<h2 class="placement-offer__title" id="placementOfferTitle">Confirma tu nivel real</h2>' +
      '<p class="placement-offer__text">Te ubicamos en B1 mientras preparábamos el examen — ya está listo. ' +
      'Toma unos minutos y puede subir tu nivel hasta C2 si tu inglés da para más.</p>' +
      '<div class="placement-offer__actions"></div>';
    var actions = offer.querySelector('.placement-offer__actions');

    var startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'lp-btn lp-btn--primary';
    startBtn.textContent = 'Confirmar mi nivel';
    startBtn.addEventListener('click', function () {
      offer.remove();
      open(options);
    });
    actions.appendChild(startBtn);

    var laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.className = 'placement-later';
    laterBtn.textContent = 'Ahora no';
    laterBtn.addEventListener('click', function () {
      sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
      offer.remove();
    });
    actions.appendChild(laterBtn);

    container.prepend(offer);
  }

  return {
    open: open,
    isPending: isPending,
    maybeShowOffer: maybeShowOffer,
  };
})();
