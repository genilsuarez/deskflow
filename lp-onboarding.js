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
  var PLACEMENT_PENDING_KEY = 'lp-placement-test-pending';

  // Decisión de producto (2026-08-09, no un olvido): la autoevaluación de un solo
  // clic solo llega hasta B1. FluentFlow vende profundidad real en idioms/phrasal
  // verbs — un self-report para B2+ es demasiado poco confiable para eso (alguien
  // puede "sentirse C1" leyendo bien y no conocer ni la mitad del vocabulario
  // específico que le tocaría). B2+ va a tener un examen de verdad — pendiente de
  // diseño en otra sesión — que valide con precisión antes de desbloquear ese
  // contenido. Hasta que exista, quien se ubique por encima de B1 entra con techo
  // B1 y queda marcado en PLACEMENT_PENDING_KEY para poder ofrecerle el examen
  // real en cuanto esté listo, en vez de perderlo silenciosamente en "b1" para
  // siempre.
  var LEVEL_OPTIONS = [
    { value: 'a1', label: 'A1', hint: 'Recién empiezo — nada o casi nada de inglés' },
    { value: 'a2', label: 'A2', hint: 'Puedo presentarme y hacer preguntas simples' },
    { value: 'b1', label: 'B1', hint: 'Entiendo conversaciones cotidianas, me trabo con temas complejos' },
  ];

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
    var forced = !!(options && options.force);
    if (!forced && hasSeenOnboarding()) return;
    track(forced ? 'onboarding_replay_start' : 'onboarding_start');

    var state = { step: 0, level: null, goal: null, motive: null, placementPending: false };

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

      backBtn.hidden = state.step === 0;
      backBtn.disabled = state.step === 0;

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
          '<p class="onboarding-body-text">No es examen — solo evita repetirte lo que ya sabes.</p>'
      );
      var list = document.createElement('div');
      list.className = 'onboarding-options onboarding-options--level';
      LEVEL_OPTIONS.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'onboarding-option' + (state.level === opt.value ? ' is-selected' : '');
        btn.innerHTML =
          '<strong>' + opt.label + '</strong><span>' + opt.hint + '</span>';
        btn.addEventListener('click', function () {
          state.level = opt.value;
          state.placementPending = false;
          track('onboarding_level_' + opt.value);
          goTo(4);
        });
        list.appendChild(btn);
      });
      // No es un descarte silencioso: a quien ya sabe más de B1 no lo mandamos a
      // "b1" sin avisar — lo marcamos para ofrecerle el examen real en cuanto
      // exista (ver nota junto a LEVEL_OPTIONS más arriba).
      var advancedBtn = document.createElement('button');
      advancedBtn.type = 'button';
      advancedBtn.className =
        'onboarding-option' + (state.placementPending ? ' is-selected' : '');
      advancedBtn.innerHTML =
        '<strong>B2 o más</strong><span>Por ahora arrancas en B1 — pronto vas a poder confirmar tu nivel real con un examen</span>';
      advancedBtn.addEventListener('click', function () {
        state.level = 'b1';
        state.placementPending = true;
        track('onboarding_level_placement_pending');
        goTo(4);
      });
      list.appendChild(advancedBtn);
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
      if (state.level) {
        localStorage.setItem('lp-level', state.level);
      }
      if (state.placementPending) {
        localStorage.setItem(PLACEMENT_PENDING_KEY, '1');
      }
      var readyCopy = state.placementPending
        ? 'Arrancas en B1 mientras preparamos un examen real para ubicarte con precisión en niveles más altos — te avisaremos apenas esté listo. Mientras tanto, empieza con una primera actividad; tu progreso se guarda automáticamente en este dispositivo.'
        : 'Tu contenido ya está ajustado a nivel ' +
          (state.level || 'a1').toUpperCase() +
          '. Empieza con una primera actividad; tu progreso se guarda automáticamente en este dispositivo.';
      body.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">Listo — empecemos</h2>' +
          '<p class="onboarding-body-text">' + readyCopy + '</p>'
      );

      // El CTA y el link "explorar" van al pie fijo (mismo sitio que
      // Siguiente/Saltar en el resto de pasos) — no al body — para que no
      // cambien de posición según cuánto texto tenga la pantalla.
      var cta = document.createElement('a');
      cta.className = 'lp-btn lp-btn--primary onboarding-cta';
      cta.href = fluentflowHref();
      cta.rel = 'noopener';
      cta.innerHTML = 'Empezar con FluentFlow <span aria-hidden="true">→</span>';
      cta.addEventListener('click', function () {
        finish('complete', { reload: false });
      });
      footer.appendChild(cta);

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

  return { open: open, hasSeenOnboarding: hasSeenOnboarding };
})();
