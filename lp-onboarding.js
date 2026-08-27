/**
 * LP Onboarding — primera visita a DeskFlow (Fases B.0-B.5 del plan de crecimiento).
 * Solo DeskFlow (decisión B.0.2) — no se comparte con FluentFlow/HubFlow/LyricFlow.
 *
 * Disparo: si !localStorage['lp-onboarding-seen'], se monta sobre el shell antes de
 * que el usuario vea el dashboard en cero. Bandera versionada (B.0.1) para poder
 * re-mostrar una versión nueva sin tocar el reset de invitado.
 */
/* eslint-disable no-var */
var lpOnboarding = (function () {
  'use strict';

  var SEEN_KEY = 'lp-onboarding-seen';
  var SEEN_VERSION = 'v1';
  var DAILY_GOAL_KEY = 'lp-daily-goal-minutes';
  var MOTIVE_KEY = 'lp-motive';
  var BODY_TRANSIT_MS = 140;
  var PLACEMENT_REQUEST_KEY = 'lp-placement-request';
  var LEVEL_STEP = 3;

  // Decisión de producto: el self-report solo se acepta tal cual hasta A2. De B1
  // en adelante hay que demostrarlo — FluentFlow vende profundidad real en
  // idioms/phrasal verbs, y alguien puede "sentirse B2" leyendo bien sin conocer
  // ni la mitad del vocabulario específico que le tocaría. Pedir B1 o B2 no
  // escribe `lp-level`: escribe PLACEMENT_REQUEST_KEY y manda al examen, que es
  // quien otorga el nivel. Reprobarlo o abandonarlo deja el nivel ganado, no el
  // pedido (ver lp-placement-test.js § commitLevel).
  var LEVEL_OPTIONS = [
    { value: 'a1', label: 'A1', hint: 'Recién empiezo — nada o casi nada de inglés' },
    { value: 'a2', label: 'A2', hint: 'Puedo presentarme y hacer preguntas simples' },
    {
      value: 'b1',
      label: 'B1',
      hint: 'Entiendo conversaciones cotidianas, me trabo con temas complejos',
      exam: true,
    },
    {
      value: 'b2',
      label: 'B2',
      hint: 'Me manejo con soltura, incluso en temas complejos',
      exam: true,
    },
  ];

  /** B1 y B2 no se auto-reportan: hay que aprobar el examen para que se otorguen. */
  function requiresExam(level) {
    for (var i = 0; i < LEVEL_OPTIONS.length; i++) {
      if (LEVEL_OPTIONS[i].value === level) return !!LEVEL_OPTIONS[i].exam;
    }
    return false;
  }

  var GOAL_OPTIONS = [
    { value: '5', label: 'Casual', hint: '~5 min al día' },
    { value: '15', label: 'Regular', hint: '~15 min al día' },
    { value: '30', label: 'Serio', hint: '~30 min al día' },
  ];

  var MOTIVE_OPTIONS = [
    { value: 'travel', label: 'Viaje' },
    { value: 'work', label: 'Trabajo' },
    { value: 'study', label: 'Estudios' },
    { value: 'fun', label: 'Por gusto' },
  ];

  function hasSeenOnboarding() {
    return localStorage.getItem(SEEN_KEY) === SEEN_VERSION;
  }

  function markSeen() {
    localStorage.setItem(SEEN_KEY, SEEN_VERSION);
  }

  function track(eventName) {
    if (typeof window.lpTrack === 'function') window.lpTrack(eventName);
  }

  function fluentflowHref() {
    if (window.LPPlatformUrls) return window.LPPlatformUrls.appHref('fluentflow');
    return 'https://genilsuarez.github.io/fluentflow/';
  }

  function open(options) {
    options = options || {};
    var forced = !!options.force;
    if (!forced && hasSeenOnboarding()) return;
    track(forced ? 'onboarding_replay_start' : 'onboarding_start');

    // startStep permite reabrir directo en el selector de nivel ("cambiar mi
    // nivel") sin volver a pasar por el carrusel de bienvenida; minStep evita
    // que el botón atrás lleve a pantallas que este flujo no pidió mostrar.
    var minStep = Math.max(0, Math.min(options.startStep || 0, LEVEL_STEP));
    var state = { step: minStep, minStep: minStep, level: null, goal: null, motive: null };

    var overlay = document.createElement('div');
    overlay.id = 'lpOnboarding';
    overlay.className = 'onboarding-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'onboardingTitle');
    document.body.appendChild(overlay);
    document.body.classList.add('onboarding-open');

    var appShell = document.querySelector('.app-shell');
    if (appShell) appShell.inert = true;

    function finish(reason, options) {
      var reload = !options || options.reload !== false;
      track('onboarding_' + reason);
      markSeen();
      overlay.remove();
      document.body.classList.remove('onboarding-open');
      if (appShell) appShell.inert = false;
      // app.js es un módulo — no expone renderAll() a este script, así que si
      // el nivel cambió (pasos 4-5) hace falta recargar para que el dashboard
      // refleje el nuevo lp-level. Se omite cuando el CTA ya navega afuera.
      if (reload && state.level) {
        location.reload();
        return;
      }
      var main = document.getElementById('mainContent');
      if (main) main.focus({ preventScroll: true });
    }

    // Cada paso solo describe su contenido (renderBody) y cómo se comporta
    // la barra de navegación fija del pie (next/skip/click-to-advance).
    var STEPS = [
      { body: renderWelcome1, clickAdvance: true, next: { label: 'Siguiente', onClick: function () { goTo(1); } } },
      { body: renderWelcome2, clickAdvance: true, next: { label: 'Siguiente', onClick: function () { goTo(2); } } },
      { body: renderWelcome3, clickAdvance: true, next: { label: 'Siguiente', onClick: function () { goTo(3); } } },
      { body: renderLevelStep },
      {
        body: renderGoalMotiveStep,
        next: {
          label: 'Siguiente',
          onClick: function () {
            if (state.goal) localStorage.setItem(DAILY_GOAL_KEY, state.goal);
            if (state.motive) localStorage.setItem(MOTIVE_KEY, state.motive);
            track('onboarding_goal_motive_set');
            goTo(5);
          },
        },
      },
      { body: renderFirstValueStep, skip: false, keepFooter: true },
    ];

    var card = document.createElement('section');
    card.className = 'onboarding-card';

    // Cabecera: atrás (opcional) + barra de progreso segmentada.
    var topbar = document.createElement('div');
    topbar.className = 'onboarding-topbar';

    var backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'onboarding-back';
    backBtn.innerHTML = '&larr;';
    backBtn.setAttribute('aria-label', 'Volver a la pantalla anterior');
    backBtn.addEventListener('click', function () {
      goTo(state.step - 1);
    });
    topbar.appendChild(backBtn);

    var dots = document.createElement('div');
    dots.className = 'onboarding-progress';
    dots.setAttribute('aria-hidden', 'true');
    STEPS.forEach(function () {
      var dot = document.createElement('span');
      dot.className = 'onboarding-progress__dot';
      dots.appendChild(dot);
    });
    topbar.appendChild(dots);

    card.appendChild(topbar);

    var body = document.createElement('div');
    body.className = 'onboarding-body';
    card.appendChild(body);

    // Pie: CTA de ancho completo + "Saltar" como texto secundario debajo.
    var footer = document.createElement('div');
    footer.className = 'onboarding-footer';

    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'lp-btn lp-btn--primary onboarding-next';
    footer.appendChild(nextBtn);

    var skipBtn = document.createElement('button');
    skipBtn.type = 'button';
    skipBtn.className = 'onboarding-skip';
    skipBtn.textContent = 'Saltar';
    skipBtn.setAttribute('aria-label', 'Saltar introducción');
    skipBtn.addEventListener('click', function () {
      finish('skip_step_' + state.step);
    });
    footer.appendChild(skipBtn);

    card.appendChild(footer);
    overlay.appendChild(card);

    // Click en cualquier parte del contenido (fuera de botones/links) avanza
    // en los pasos puramente informativos — como un carrusel de historias.
    body.addEventListener('click', function (event) {
      if (!STEPS[state.step].clickAdvance) return;
      if (event.target.closest('button, a')) return;
      goTo(state.step + 1);
    });

    function updateNav() {
      var stepDef = STEPS[state.step];

      backBtn.hidden = state.step <= state.minStep;
      backBtn.disabled = state.step <= state.minStep;

      var showSkip = stepDef.skip !== false;
      skipBtn.style.display = showSkip ? '' : 'none';

      if (stepDef.next) {
        nextBtn.style.display = '';
        nextBtn.innerHTML = stepDef.next.label + ' <span aria-hidden="true">→</span>';
        nextBtn.onclick = stepDef.next.onClick;
      } else {
        nextBtn.style.display = 'none';
        nextBtn.onclick = null;
      }

      // El pie genérico solo se muestra si hay next y/o skip que ofrecer, o si
      // el paso pide mantenerlo para colocar ahí su propio CTA (mismo lugar
      // fijo en todas las pantallas — evita que el botón "salte" de posición).
      footer.hidden = !stepDef.next && !showSkip && !stepDef.keepFooter;

      // Limpia cualquier CTA custom que haya dejado un paso anterior (p.ej. el
      // último paso) antes de reconstruir next/skip para el paso actual.
      Array.prototype.slice.call(footer.children).forEach(function (child) {
        if (child !== nextBtn && child !== skipBtn) child.remove();
      });

      card.classList.toggle('onboarding-card--advance', !!stepDef.clickAdvance);

      // Los segmentos se acumulan: representan pantallas ya vistas + la actual.
      dots.querySelectorAll('.onboarding-progress__dot').forEach(function (dot, i) {
        dot.classList.toggle('is-active', i <= state.step);
      });
    }

    // Navegación con flechas dentro de un grupo de opciones (nivel, chips):
    // mueve el foco entre botones hermanos con prev/next y detiene la
    // propagación para que el handler global de pasos no interprete la
    // misma tecla como "atrás"/"siguiente" de pantalla.
    function attachRoving(container, selector, keys) {
      container.addEventListener('keydown', function (event) {
        if (event.key !== keys.prev && event.key !== keys.next) return;
        var items = Array.prototype.slice.call(container.querySelectorAll(selector));
        var idx = items.indexOf(document.activeElement);
        if (idx === -1) return;
        // En el borde del grupo (primer/último item) no se consume la tecla:
        // se deja subir al handler global para que retroceda/avance de pantalla.
        var atStart = event.key === keys.prev && idx === 0;
        var atEnd = event.key === keys.next && idx === items.length - 1;
        if (atStart || atEnd) return;
        event.preventDefault();
        event.stopPropagation();
        var nextIdx = event.key === keys.next ? idx + 1 : idx - 1;
        items[nextIdx].focus();
      });
    }

    function firstVisibleFocusable(container) {
      var els = container.querySelectorAll('button, a[href]');
      for (var i = 0; i < els.length; i++) {
        if (els[i].offsetParent !== null) return els[i];
      }
      return null;
    }

    function renderBody() {
      body.innerHTML = '';
      STEPS[state.step].body(body);
      var firstFocusable = firstVisibleFocusable(body) || firstVisibleFocusable(footer);
      if (firstFocusable) firstFocusable.focus();
    }

    function render() {
      updateNav();
      renderBody();
    }

    function goTo(step) {
      if (step === state.step) return;
      body.classList.add('onboarding-body--transit');
      window.setTimeout(function () {
        state.step = step;
        render();
        // Fuerza reflow para que la transición de entrada se anime desde el estado "transit".
        void body.offsetHeight;
        body.classList.remove('onboarding-body--transit');
      }, BODY_TRANSIT_MS);
    }

    function renderWelcome1(body) {
      body.insertAdjacentHTML(
        'beforeend',
        '<div class="onboarding-badge" aria-hidden="true">L</div>' +
          '<h2 id="onboardingTitle">Una plataforma, tres formas de aprender idiomas</h2>' +
          '<p class="onboarding-body-text">Estructura, práctica y música, conectadas por tu nivel real — todo gratis, sin registro obligatorio.</p>' +
          '<div class="onboarding-modules">' +
          '<span class="onboarding-module onboarding-module--fluent">FluentFlow</span>' +
          '<span class="onboarding-module onboarding-module--hub">HubFlow</span>' +
          '<span class="onboarding-module onboarding-module--lyric">LyricFlow</span>' +
          '</div>'
      );
    }

    function renderWelcome2(body) {
      body.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">¿Por qué tres módulos y no uno?</h2>' +
          '<p class="onboarding-body-text">Cada una cubre algo distinto: <strong>FluentFlow</strong> te da el curso estructurado, ' +
          '<strong>HubFlow</strong> la práctica flexible de gramática, y <strong>LyricFlow</strong> la inmersión con canciones. ' +
          'Juntas cubren más que cualquiera por separado.</p>'
      );
    }

    function renderWelcome3(body) {
      body.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">Tu nivel se comparte entre las tres</h2>' +
          '<p class="onboarding-body-text">Avanzar en los tres módulos sube tu nivel en conjunto — no hace falta repetir el mismo contenido tres veces. ' +
          '¿Ya sabes algo de inglés? En la próxima pantalla lo ajustamos.</p>'
      );
    }

    function renderLevelStep(body) {
      body.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">¿Cuál es tu nivel de inglés hoy?</h2>' +
          '<p class="onboarding-body-text">Elige el que más se te parezca. ' +
          'De B1 en adelante te pedimos un examen corto para confirmarlo.</p>'
      );
      var list = document.createElement('div');
      list.className = 'onboarding-options onboarding-options--level';
      LEVEL_OPTIONS.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'onboarding-option' + (state.level === opt.value ? ' is-selected' : '');
        btn.innerHTML =
          '<strong>' + opt.label + '</strong><span>' + opt.hint +
          (opt.exam ? ' <em class="onboarding-option__exam">Requiere examen</em>' : '') +
          '</span>';
        btn.addEventListener('click', function () {
          state.level = opt.value;
          track('onboarding_level_' + opt.value);
          goTo(4);
        });
        list.appendChild(btn);
      });
      attachRoving(list, '.onboarding-option', { prev: 'ArrowUp', next: 'ArrowDown' });
      body.appendChild(list);
    }

    function chipGroup(options, selectedValue, onPick) {
      var wrap = document.createElement('div');
      wrap.className = 'onboarding-chips';
      options.forEach(function (opt) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'onboarding-chip' + (selectedValue === opt.value ? ' is-selected' : '');
        chip.innerHTML = '<strong>' + opt.label + '</strong>' + (opt.hint ? '<span>' + opt.hint + '</span>' : '');
        chip.addEventListener('click', function () {
          wrap.querySelectorAll('.onboarding-chip').forEach(function (c) {
            c.classList.remove('is-selected');
          });
          chip.classList.add('is-selected');
          onPick(opt.value);
        });
        wrap.appendChild(chip);
      });
      attachRoving(wrap, '.onboarding-chip', { prev: 'ArrowLeft', next: 'ArrowRight' });
      return wrap;
    }

    function renderGoalMotiveStep(body) {
      body.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">Dos preguntas rápidas (opcional)</h2>' +
          '<p class="onboarding-body-text">Sirven para personalizar tu experiencia más adelante.</p>' +
          '<p class="onboarding-label">Meta diaria</p>'
      );
      body.appendChild(
        chipGroup(GOAL_OPTIONS, state.goal, function (value) {
          state.goal = value;
        })
      );
      body.insertAdjacentHTML('beforeend', '<p class="onboarding-label">Motivo</p>');
      body.appendChild(
        chipGroup(MOTIVE_OPTIONS, state.motive, function (value) {
          state.motive = value;
        })
      );
    }

    function renderFirstValueStep(body) {
      var needsExam = requiresExam(state.level);
      if (state.level && !needsExam) {
        // A1/A2 se otorgan tal cual: son encuesta, no hay nada que demostrar.
        localStorage.setItem('lp-level', state.level);
      }
      if (needsExam) {
        // El nivel pedido NO se escribe en lp-level — lo otorga el examen solo
        // si se aprueba. Hasta entonces queda registrada la petición y el
        // usuario sigue en el nivel que ya tenía ganado.
        localStorage.setItem(PLACEMENT_REQUEST_KEY, state.level);
      }
      var readyCopy = needsExam
        ? 'Pediste nivel ' + state.level.toUpperCase() + '. Para confirmarlo te toca un examen corto: ' +
          'si lo apruebas, tu contenido queda en ' + state.level.toUpperCase() + '; si no, sigues en el nivel ' +
          'que ya tengas y puedes volver a intentarlo cuando quieras.'
        : 'Tu contenido ya está ajustado a nivel ' +
          (state.level || 'a1').toUpperCase() +
          '. Empieza con una primera actividad; tu progreso se guarda automáticamente en este dispositivo.';
      body.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">Listo — empecemos</h2>' +
          '<p class="onboarding-body-text">' + readyCopy + '</p>'
      );

      // El CTA y el link secundario van al pie fijo (mismo sitio que
      // Siguiente/Saltar en el resto de pasos) — no al body — para que no
      // cambien de posición según cuánto texto tenga la pantalla.
      if (needsExam) {
        // Encuesta → examen en la misma sesión: el siguiente paso natural es
        // confirmarlo ya, no diferirlo a una oferta posterior en el dashboard
        // (eso queda como fallback si elige "Prefiero explorar primero").
        var requestedLevel = state.level;
        var placementCta = document.createElement('button');
        placementCta.type = 'button';
        placementCta.className = 'lp-btn lp-btn--primary onboarding-cta';
        placementCta.innerHTML = 'Hacer el examen ahora <span aria-hidden="true">→</span>';
        placementCta.addEventListener('click', function () {
          finish('start_placement', { reload: false });
          if (typeof options.onPlacementReady === 'function') options.onPlacementReady(requestedLevel);
        });
        footer.appendChild(placementCta);
      } else {
        var cta = document.createElement('a');
        cta.className = 'lp-btn lp-btn--primary onboarding-cta';
        cta.href = fluentflowHref();
        cta.rel = 'noopener';
        cta.innerHTML = 'Empezar con FluentFlow <span aria-hidden="true">→</span>';
        cta.addEventListener('click', function () {
          finish('complete', { reload: false });
        });
        footer.appendChild(cta);
      }

      var laterBtn = document.createElement('button');
      laterBtn.type = 'button';
      laterBtn.className = 'onboarding-later';
      laterBtn.textContent = 'Prefiero explorar primero';
      laterBtn.addEventListener('click', function () {
        finish('complete_explore');
      });
      footer.appendChild(laterBtn);
    }

    render();

    document.addEventListener('keydown', function onKeydown(event) {
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', onKeydown);
        finish('skip_escape');
        return;
      }
      if (event.key === 'ArrowLeft') {
        if (state.step > 0) {
          event.preventDefault();
          goTo(state.step - 1);
        }
        return;
      }
      if (event.key === 'ArrowRight') {
        var stepDef = STEPS[state.step];
        if (stepDef.next) {
          event.preventDefault();
          stepDef.next.onClick();
        } else if (stepDef.clickAdvance) {
          event.preventDefault();
          goTo(state.step + 1);
        } else if (document.activeElement && document.activeElement.classList.contains('onboarding-option')) {
          // Paso de nivel: no tiene botón "Siguiente" propio — la opción con
          // foco se selecciona (mismo efecto que un click) y eso ya avanza.
          event.preventDefault();
          document.activeElement.click();
        }
      }
    });
  }

  return {
    open: open,
    hasSeenOnboarding: hasSeenOnboarding,
    requiresExam: requiresExam,
    // Para reabrir directo en el selector de nivel: open({ force: true, startStep: lpOnboarding.LEVEL_STEP }).
    LEVEL_STEP: LEVEL_STEP,
  };
})();

window.lpOnboarding = lpOnboarding; // ESM side-effect import (main.js) does not attach top-level vars to window like a classic <script> did — restore it explicitly.
