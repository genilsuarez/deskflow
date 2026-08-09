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

  var LEVEL_OPTIONS = [
    { value: 'a1', label: 'A1', hint: 'Recién empiezo — nada o casi nada de inglés' },
    { value: 'a2', label: 'A2', hint: 'Puedo presentarme y hacer preguntas simples' },
    { value: 'b1', label: 'B1', hint: 'Entiendo conversaciones cotidianas, me trabo con temas complejos' },
    { value: 'b2', label: 'B2', hint: 'Puedo mantener una conversación fluida sobre casi cualquier tema' },
    { value: 'c1', label: 'C1', hint: 'Me manejo con soltura en contextos académicos o profesionales' },
    { value: 'c2', label: 'C2', hint: 'Nivel casi nativo' },
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

    var state = { step: 0, level: null, goal: null, motive: null };

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

    var STEPS = [
      renderWelcome1,
      renderWelcome2,
      renderWelcome3,
      renderLevelStep,
      renderGoalMotiveStep,
      renderFirstValueStep,
    ];

    function render() {
      overlay.innerHTML = '';
      var card = document.createElement('section');
      card.className = 'onboarding-card';
      STEPS[state.step](card);
      overlay.appendChild(card);
      var firstFocusable = card.querySelector('button, a[href]');
      if (firstFocusable) firstFocusable.focus();
    }

    function goTo(step) {
      state.step = step;
      render();
    }

    function skipButton() {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'onboarding-skip';
      btn.textContent = 'Saltar';
      btn.setAttribute('aria-label', 'Saltar introducción');
      btn.addEventListener('click', function () {
        finish('skip_step_' + state.step);
      });
      return btn;
    }

    function progressDots(card) {
      var dots = document.createElement('div');
      dots.className = 'onboarding-progress';
      dots.setAttribute('aria-hidden', 'true');
      STEPS.forEach(function (_, i) {
        var dot = document.createElement('span');
        dot.className = 'onboarding-progress__dot' + (i === state.step ? ' is-active' : '');
        dots.appendChild(dot);
      });
      card.appendChild(dots);
    }

    function nextButton(label, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lp-btn lp-btn--primary onboarding-next';
      btn.innerHTML = label + ' <span aria-hidden="true">→</span>';
      btn.addEventListener('click', onClick);
      return btn;
    }

    function baseHeader(card) {
      card.appendChild(skipButton());
    }

    function renderWelcome1(card) {
      baseHeader(card);
      progressDots(card);
      card.insertAdjacentHTML(
        'beforeend',
        '<div class="onboarding-badge" aria-hidden="true">L</div>' +
          '<h2 id="onboardingTitle">Una plataforma, tres formas de aprender idiomas</h2>' +
          '<p class="onboarding-body">Estructura, práctica y música, conectadas por tu nivel real — todo gratis, sin registro obligatorio.</p>' +
          '<div class="onboarding-modules">' +
          '<span class="onboarding-module onboarding-module--fluent">FluentFlow</span>' +
          '<span class="onboarding-module onboarding-module--hub">HubFlow</span>' +
          '<span class="onboarding-module onboarding-module--lyric">LyricFlow</span>' +
          '</div>'
      );
      card.appendChild(nextButton('Siguiente', function () {
        goTo(1);
      }));
    }

    function renderWelcome2(card) {
      baseHeader(card);
      progressDots(card);
      card.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">¿Por qué tres módulos y no uno?</h2>' +
          '<p class="onboarding-body">Cada una cubre algo distinto: <strong>FluentFlow</strong> te da el curso estructurado, ' +
          '<strong>HubFlow</strong> la práctica flexible de gramática, y <strong>LyricFlow</strong> la inmersión con canciones. ' +
          'Juntas cubren más que cualquiera por separado.</p>'
      );
      card.appendChild(nextButton('Siguiente', function () {
        goTo(2);
      }));
    }

    function renderWelcome3(card) {
      baseHeader(card);
      progressDots(card);
      card.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">Tu nivel se comparte entre las tres</h2>' +
          '<p class="onboarding-body">Avanzar en los tres módulos sube tu nivel en conjunto — no hace falta repetir el mismo contenido tres veces. ' +
          '¿Ya sabes algo de inglés? En la próxima pantalla lo ajustamos.</p>'
      );
      card.appendChild(nextButton('Siguiente', function () {
        goTo(3);
      }));
    }

    function renderLevelStep(card) {
      baseHeader(card);
      progressDots(card);
      card.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">¿Cuál es tu nivel de inglés hoy?</h2>' +
          '<p class="onboarding-body">No es un examen — es solo para no mostrarte contenido que ya sabes.</p>'
      );
      var list = document.createElement('div');
      list.className = 'onboarding-options onboarding-options--level';
      LEVEL_OPTIONS.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'onboarding-option';
        btn.innerHTML =
          '<strong>' + opt.label + '</strong><span>' + opt.hint + '</span>';
        btn.addEventListener('click', function () {
          state.level = opt.value;
          track('onboarding_level_' + opt.value);
          goTo(4);
        });
        list.appendChild(btn);
      });
      card.appendChild(list);
      var noIdea = document.createElement('button');
      noIdea.type = 'button';
      noIdea.className = 'onboarding-option onboarding-option--muted';
      noIdea.textContent = 'No sé, empezar desde cero';
      noIdea.addEventListener('click', function () {
        state.level = 'a1';
        track('onboarding_level_unknown');
        goTo(4);
      });
      card.appendChild(noIdea);
    }

    function chipGroup(options, onPick) {
      var wrap = document.createElement('div');
      wrap.className = 'onboarding-chips';
      options.forEach(function (opt) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'onboarding-chip';
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
      return wrap;
    }

    function renderGoalMotiveStep(card) {
      baseHeader(card);
      progressDots(card);
      card.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">Dos preguntas rápidas (opcional)</h2>' +
          '<p class="onboarding-body">Sirven para personalizar tu experiencia más adelante — puedes saltarlas.</p>' +
          '<p class="onboarding-label">Meta diaria</p>'
      );
      card.appendChild(
        chipGroup(GOAL_OPTIONS, function (value) {
          state.goal = value;
        })
      );
      card.insertAdjacentHTML('beforeend', '<p class="onboarding-label">Motivo</p>');
      card.appendChild(
        chipGroup(MOTIVE_OPTIONS, function (value) {
          state.motive = value;
        })
      );
      card.appendChild(
        nextButton('Siguiente', function () {
          if (state.goal) localStorage.setItem(DAILY_GOAL_KEY, state.goal);
          if (state.motive) localStorage.setItem(MOTIVE_KEY, state.motive);
          track('onboarding_goal_motive_set');
          goTo(5);
        })
      );
    }

    function renderFirstValueStep(card) {
      progressDots(card);
      if (state.level) {
        localStorage.setItem('lp-level', state.level);
      }
      card.insertAdjacentHTML(
        'beforeend',
        '<h2 id="onboardingTitle">Listo — empecemos</h2>' +
          '<p class="onboarding-body">Tu contenido ya está ajustado a nivel ' +
          (state.level || 'a1').toUpperCase() +
          '. Empieza con una primera actividad; tu progreso se guarda automáticamente.</p>'
      );
      var cta = document.createElement('a');
      cta.className = 'lp-btn lp-btn--primary onboarding-next';
      cta.href = fluentflowHref();
      cta.rel = 'noopener';
      cta.innerHTML = 'Empezar con FluentFlow <span aria-hidden="true">→</span>';
      cta.addEventListener('click', function () {
        finish('complete', { reload: false });
      });
      card.appendChild(cta);
      var laterBtn = document.createElement('button');
      laterBtn.type = 'button';
      laterBtn.className = 'onboarding-later';
      laterBtn.textContent = 'Prefiero explorar primero';
      laterBtn.addEventListener('click', function () {
        finish('complete_explore');
      });
      card.appendChild(laterBtn);
    }

    render();

    document.addEventListener('keydown', function onKeydown(event) {
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', onKeydown);
        finish('skip_escape');
      }
    });
  }

  return { open: open, hasSeenOnboarding: hasSeenOnboarding };
})();
