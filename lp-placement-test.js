/**
 * LP Placement Test — examen que valida el nivel que el usuario pidió en la encuesta.
 * Solo DeskFlow — no se comparte con FluentFlow/HubFlow/LyricFlow.
 *
 * No ubica: confirma. Pedir B1 rinde el bloque B1; pedir B2 rinde un piso B1
 * abreviado + el bloque B2. Aprobar otorga el nivel pedido; reprobar o abandonar
 * cae al nivel de fallback — nunca por debajo del que ya se ganó completando
 * contenido real (ver commitLevel).
 *
 * Requiere:
 *  - lp-placement-test.css, lp-about.css (el modal de reanudación reusa .about-modal)
 *  - lp-placement-items.json (copia de scripts/lp-placement-items.json)
 *  - las funciones puras de scripts/lp-placement-scoring.js, inyectadas por quien
 *    llama a open()/maybeShowOffer()/maybeShowResumePrompt() — este archivo es un
 *    <script> plano, no un módulo (mismo patrón que app.js con lpOnboarding).
 */
/* eslint-disable no-var */
var lpPlacementTest = (function () {
  'use strict';

  var REQUEST_KEY = 'lp-placement-request';
  var SNAPSHOT_KEY = 'lp-placement-progress';
  var SESSION_DISMISS_KEY = 'lp-placement-offer-dismissed';
  var ITEMS_URL = 'lp-placement-items.json';

  // Un examen a medias caduca: retomar algo que se dejó hace semanas mide el
  // recuerdo del intento, no el nivel. Pasado el plazo se ofrece la encuesta.
  var SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  var STAGE_LABELS = {
    b1: 'Nivel B1',
    b2: 'Nivel B2',
  };

  // El piso B1 va abreviado cuando lo que se valida es B2: quien pide B2 igual
  // verifica un piso real, pero rendirle el bloque B1 completo es fricción.
  var FLOOR_BLOCK_SIZE = 5;

  function track(eventName, params) {
    if (typeof window.lpTrack === 'function') window.lpTrack(eventName, params);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Estado persistido -------------------------------------------------

  /** Nivel pedido en la encuesta y todavía no validado ('b1' | 'b2' | null). */
  function pendingRequest() {
    try {
      return localStorage.getItem(REQUEST_KEY);
    } catch (e) {
      return null;
    }
  }

  function clearRequest() {
    try {
      localStorage.removeItem(REQUEST_KEY);
    } catch (e) {
      /* localStorage no disponible */
    }
  }

  /** Examen a medias todavía válido, o null si no hay / caducó / cambió el banco. */
  function readSnapshot(itemsVersion) {
    var raw;
    try {
      raw = localStorage.getItem(SNAPSHOT_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;

    var snap;
    try {
      snap = JSON.parse(raw);
    } catch (e) {
      clearSnapshot();
      return null;
    }
    if (!snap || !snap.requestedLevel || !Array.isArray(snap.answers)) {
      clearSnapshot();
      return null;
    }
    if (Date.now() - (snap.updatedAt || 0) > SNAPSHOT_MAX_AGE_MS) {
      clearSnapshot();
      return null;
    }
    // Los ítems no tienen id: si cambió el banco, los índices guardados ya no
    // apuntan a las mismas preguntas y el intento deja de ser reanudable.
    if (itemsVersion != null && snap.itemsVersion !== itemsVersion) {
      clearSnapshot();
      return null;
    }
    return snap;
  }

  function writeSnapshot(snap) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    } catch (e) {
      /* sin persistencia el examen sigue funcionando, solo no se puede retomar */
    }
  }

  function clearSnapshot() {
    try {
      localStorage.removeItem(SNAPSHOT_KEY);
    } catch (e) {
      /* localStorage no disponible */
    }
  }

  /** `true` si hay algo que resolver: petición pendiente o examen a medias. */
  function isPending() {
    return !!pendingRequest() || !!readSnapshot(null);
  }

  // --- Otorgar el nivel --------------------------------------------------

  function higherLevel(levelA, levelB, levelOrder) {
    return levelOrder.indexOf(levelA) >= levelOrder.indexOf(levelB) ? levelA : levelB;
  }

  /**
   * Escribe el nivel resultante, con piso en lo ya ganado orgánicamente:
   * reprobar un intento de B2 no puede borrar un B1 que se ganó completando
   * módulos. Notifica al llamador para que lo persista en la nube — incluso
   * cuando baja, porque el restore de login nunca baja por su cuenta y si no
   * se sincroniza el nivel viejo vuelve solo en el próximo inicio de sesión.
   */
  function commitLevel(level, options) {
    var floor = 'a1';
    if (typeof options.earnedFloor === 'function') {
      try {
        floor = options.earnedFloor();
      } catch (e) {
        floor = 'a1';
      }
    }
    var finalLevel = higherLevel(level, floor, options.levelOrder);
    try {
      localStorage.setItem('lp-level', finalLevel);
    } catch (e) {
      /* localStorage no disponible */
    }
    if (typeof options.onLevelCommitted === 'function') options.onLevelCommitted(finalLevel);
    return finalLevel;
  }

  // --- Composición del examen -------------------------------------------

  function fetchItemBank() {
    return fetch(ITEMS_URL, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('lp-placement-items.json fetch failed: ' + res.status);
      return res.json();
    });
  }

  /**
   * Bloques a rendir, en orden, para el nivel pedido. Determinista: reanudar un
   * examen reconstruye exactamente la misma secuencia de preguntas.
   */
  function buildBlocks(items, requestedLevel, options) {
    var order = options.blocksFor(requestedLevel);
    var byLevel = {};
    order.forEach(function (level) {
      byLevel[level] = items.filter(function (item) {
        return item.level === level;
      });
    });
    if (order.length > 1 && byLevel[order[0]].length > FLOOR_BLOCK_SIZE) {
      byLevel[order[0]] = byLevel[order[0]].slice(0, FLOOR_BLOCK_SIZE);
    }
    var flat = [];
    order.forEach(function (level) {
      flat = flat.concat(byLevel[level]);
    });
    return { order: order, byLevel: byLevel, flat: flat };
  }

  function requireOptions(options) {
    if (typeof options.score !== 'function' || typeof options.blocksFor !== 'function') {
      throw new Error('lpPlacementTest requiere options.score y options.blocksFor');
    }
    if (!Array.isArray(options.levelOrder) || !options.fallbackLevel) {
      throw new Error('lpPlacementTest requiere options.levelOrder y options.fallbackLevel');
    }
  }

  /**
   * @param {object} options
   * @param {string} options.requestedLevel - nivel a validar; por defecto, la petición pendiente.
   * @param {function} options.score - scoreValidation (scripts/lp-placement-scoring.js)
   * @param {function} options.blocksFor - blocksFor (idem)
   * @param {string} options.fallbackLevel - FALLBACK_LEVEL (idem)
   * @param {string[]} options.levelOrder - LEVEL_ORDER (scripts/lp-progress-summary.js)
   * @param {function} [options.earnedFloor] - getEarnedLevelFloor (idem)
   * @param {function} [options.onLevelCommitted] - persistencia en la nube del nivel resultante
   * @param {object} [options.resumeFrom] - snapshot devuelto por readSnapshot()
   */
  function open(options) {
    options = options || {};
    requireOptions(options);

    var requestedLevel = options.requestedLevel || pendingRequest();
    if (!requestedLevel) return;

    track('placement_test_started', { level: requestedLevel, resumed: !!options.resumeFrom });

    fetchItemBank()
      .then(function (bank) {
        renderExam(bank, requestedLevel, options);
      })
      .catch(function (err) {
        console.error('[lpPlacementTest]', err);
      });
  }

  function renderExam(bank, requestedLevel, options) {
    var items = bank.items;
    var itemsVersion = bank.version;
    var blocks = buildBlocks(items, requestedLevel, options);
    if (blocks.order.length === 0) return;

    // Revalidación del intento guardado contra el examen que se va a rendir de
    // verdad. maybeShowResumePrompt() ofrece retomar sin haber cargado el banco,
    // así que este es el único punto donde se puede comprobar: si el banco cambió
    // (los ítems no tienen id, los índices dejan de apuntar a lo mismo), si el
    // nivel pedido es otro, o si los índices se salen de rango, se descarta y se
    // empieza limpio en vez de rendir preguntas que no corresponden.
    var resume = options.resumeFrom;
    if (
      resume &&
      (resume.itemsVersion !== itemsVersion ||
        resume.requestedLevel !== requestedLevel ||
        resume.levelIndex >= blocks.order.length ||
        resume.answers.length > blocks.flat.length ||
        resume.itemIndex >= blocks.byLevel[blocks.order[resume.levelIndex]].length)
    ) {
      clearSnapshot();
      resume = null;
    }

    var state = {
      levelIndex: resume ? resume.levelIndex : 0,
      itemIndex: resume ? resume.itemIndex : 0,
      answers: resume ? resume.answers.slice() : [],
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
      abandon();
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
      return blocks.order[state.levelIndex];
    }

    function currentBlock() {
      return blocks.byLevel[currentLevel()];
    }

    /** Ítems ya rendidos, en orden — alineados 1:1 con state.answers. */
    function presentedItems() {
      return blocks.flat.slice(0, state.answers.length);
    }

    function persist() {
      writeSnapshot({
        itemsVersion: itemsVersion,
        requestedLevel: requestedLevel,
        levelIndex: state.levelIndex,
        itemIndex: state.itemIndex,
        answers: state.answers,
        answeredCount: state.answers.length,
        totalCount: blocks.flat.length,
        updatedAt: Date.now(),
      });
    }

    function updateTopbar() {
      var block = currentBlock();
      counter.textContent =
        STAGE_LABELS[currentLevel()] + ' · Pregunta ' + (state.itemIndex + 1) + ' de ' + block.length;
      progressFill.style.width = Math.round((state.itemIndex / block.length) * 100) + '%';
    }

    function renderQuestion() {
      state.answered = false;
      nextBtn.disabled = true;
      var block = currentBlock();
      var isVeryLastItem =
        state.levelIndex === blocks.order.length - 1 && state.itemIndex === block.length - 1;
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
          state.answers.push(optionText);
          // Se persiste en cuanto se responde: si cierra acá, la respuesta ya
          // cuenta y no puede reintentarse limpio (ver § abandono).
          persist();

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
        persist();
        renderQuestion();
        return;
      }

      // Bloque terminado: si se reprueba, el examen corta acá — el resultado
      // ya está decidido y los bloques siguientes no lo pueden rescatar.
      var result = options.score(requestedLevel, presentedItems(), state.answers);
      var blockResult = null;
      for (var i = 0; i < result.blocks.length; i++) {
        if (result.blocks[i].level === currentLevel()) blockResult = result.blocks[i];
      }
      var isLastBlock = state.levelIndex === blocks.order.length - 1;

      if (!blockResult || !blockResult.passed || isLastBlock) {
        finish(result);
      } else {
        state.levelIndex += 1;
        state.itemIndex = 0;
        persist();
        renderQuestion();
      }
    });

    function finish(result) {
      var committed = commitLevel(result.level, options);
      clearSnapshot();
      clearRequest();
      track('placement_test_completed', {
        requested: requestedLevel,
        passed: result.passed,
        level: committed,
      });
      renderResult(result, committed);
    }

    /**
     * Abandono a mitad de examen. Otorga el nivel de fallback (con piso en lo
     * ganado) en vez de no escribir nada: dejar el nivel pedido sin validar
     * sería exactamente el agujero que este gate cierra. El snapshot se
     * conserva para poder retomar donde quedó — reanudar arrastra las
     * respuestas ya dadas, así que abandonar un intento que va mal no sirve
     * para reintentarlo limpio.
     */
    function abandon() {
      var committed = commitLevel(options.fallbackLevel, options);
      persist();
      track('placement_test_abandoned', {
        requested: requestedLevel,
        answered: state.answers.length,
        level: committed,
      });
      close({ reload: true });
    }

    function renderResult(result, committed) {
      progressFill.style.width = '100%';
      topbar.style.display = 'none';
      body.innerHTML = '';
      footer.innerHTML = '';

      var copy = result.passed
        ? 'Confirmado: tu contenido queda ajustado a nivel ' + committed.toUpperCase() +
          '. Los niveles anteriores siguen disponibles para repasar cuando quieras.'
        : 'Esta vez no alcanzó para ' + requestedLevel.toUpperCase() + ', así que sigues en nivel ' +
          committed.toUpperCase() + '. Puedes volver a intentarlo cuando quieras, o elegir otro nivel ' +
          'desde los ajustes — nada de lo que ya completaste se pierde.';

      body.insertAdjacentHTML(
        'beforeend',
        '<div class="placement-result-badge" aria-hidden="true">' + escapeHtml(committed.toUpperCase()) + '</div>' +
          '<h2 id="placementTestTitle">' +
          (result.passed ? 'Tu nivel confirmado: ' : 'Tu nivel sigue en ') +
          escapeHtml(committed.toUpperCase()) + '</h2>' +
          '<p class="placement-body-text">' + copy + '</p>'
      );

      var continueBtn = document.createElement('button');
      continueBtn.type = 'button';
      continueBtn.className = 'lp-btn lp-btn--primary placement-next';
      continueBtn.textContent = 'Continuar';
      continueBtn.addEventListener('click', function () {
        close({ reload: true });
      });
      footer.appendChild(continueBtn);
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
      if (event.key === 'Escape') abandon();
    }
    document.addEventListener('keydown', onKeydown);

    renderQuestion();
  }

  // --- Aviso en el dashboard: petición pendiente sin empezar --------------

  function maybeShowOffer(container, options) {
    if (!container) return;
    var requested = pendingRequest();
    if (!requested) return;
    if (readSnapshot(null)) return; // hay examen a medias: manda el modal de reanudación
    if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return;
    if (document.getElementById('placementOffer')) return;

    track('placement_test_offered', { level: requested });

    var offer = document.createElement('section');
    offer.id = 'placementOffer';
    offer.className = 'placement-offer';
    offer.setAttribute('aria-labelledby', 'placementOfferTitle');
    offer.innerHTML =
      '<h2 class="placement-offer__title" id="placementOfferTitle">Confirma tu nivel ' +
      escapeHtml(requested.toUpperCase()) + '</h2>' +
      '<p class="placement-offer__text">Pediste nivel ' + escapeHtml(requested.toUpperCase()) +
      ' en la encuesta. Toma unos minutos confirmarlo con un examen corto; hasta entonces tu ' +
      'contenido sigue en el nivel que ya tienes.</p>' +
      '<div class="placement-offer__actions"></div>';
    var actions = offer.querySelector('.placement-offer__actions');

    var startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'lp-btn lp-btn--primary';
    startBtn.textContent = 'Hacer el examen';
    startBtn.addEventListener('click', function () {
      offer.remove();
      open(Object.assign({}, options, { requestedLevel: requested }));
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

  // --- Modal de reanudación: examen a medias ------------------------------

  /**
   * Explica un examen dejado a medias y ofrece salida. **Nunca abre el examen
   * solo**: caer directo en un examen al entrar es desconcertante para quien
   * apenas conoce la plataforma, así que el examen solo se retoma con un click
   * explícito. La otra salida es volver a la encuesta y pedir otro nivel.
   */
  function maybeShowResumePrompt(options) {
    var snap = readSnapshot(null);
    if (!snap) return false;
    if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return false;
    if (document.getElementById('lpPlacementResume')) return false;

    var currentLevel = 'a1';
    try {
      currentLevel = localStorage.getItem('lp-level') || 'a1';
    } catch (e) {
      /* localStorage no disponible */
    }

    track('placement_resume_offered', { level: snap.requestedLevel, answered: snap.answeredCount });

    var shell = document.querySelector('.app-shell') || document.body;
    var overlay = document.createElement('div');
    overlay.id = 'lpPlacementResume';
    overlay.className = 'about-overlay';
    overlay.innerHTML =
      '<section class="about-modal" role="dialog" aria-modal="true" ' +
      'aria-labelledby="lpPlacementResumeTitle" aria-describedby="lpPlacementResumeDesc">' +
      '<header class="about-header"><div class="about-header__text">' +
      '<p class="about-eyebrow">Examen sin terminar</p>' +
      '<h2 id="lpPlacementResumeTitle">Dejaste el examen de ' + escapeHtml(snap.requestedLevel.toUpperCase()) + ' a medias</h2>' +
      '</div></header>' +
      '<div class="about-body"><p id="lpPlacementResumeDesc" class="about-description">' +
      'Respondiste ' + Number(snap.answeredCount) + ' de ' + Number(snap.totalCount) + ' preguntas. ' +
      'Como no lo terminaste, tu nivel quedó en ' + escapeHtml(currentLevel.toUpperCase()) + '. ' +
      'Puedes retomarlo donde lo dejaste (se conservan tus respuestas) o elegir otro nivel.' +
      '</p></div>' +
      '<footer class="about-footer" style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">' +
      '<button class="lp-btn lp-btn--ghost" id="lpPlacementResumeSurvey" type="button">Elegir otro nivel</button>' +
      '<button class="lp-btn lp-btn--primary" id="lpPlacementResumeGo" type="button">Retomar el examen</button>' +
      '</footer></section>';

    document.body.appendChild(overlay);
    if (shell) shell.inert = true;

    function close() {
      overlay.remove();
      if (shell) shell.inert = false;
      document.removeEventListener('keydown', onKeydown);
    }

    function dismiss() {
      sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
      close();
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    }

    overlay.querySelector('#lpPlacementResumeGo').addEventListener('click', function () {
      close();
      track('placement_resume_accepted', { level: snap.requestedLevel });
      open(Object.assign({}, options, { requestedLevel: snap.requestedLevel, resumeFrom: snap }));
    });

    overlay.querySelector('#lpPlacementResumeSurvey').addEventListener('click', function () {
      close();
      track('placement_resume_survey', { level: snap.requestedLevel });
      // El intento viejo se descarta: el usuario está pidiendo otro nivel.
      clearSnapshot();
      clearRequest();
      if (typeof options.onChooseAnotherLevel === 'function') options.onChooseAnotherLevel();
    });

    document.addEventListener('keydown', onKeydown);
    overlay.querySelector('#lpPlacementResumeGo').focus();
    return true;
  }

  return {
    open: open,
    isPending: isPending,
    pendingRequest: pendingRequest,
    maybeShowOffer: maybeShowOffer,
    maybeShowResumePrompt: maybeShowResumePrompt,
  };
})();
