/**
 * LP Help — "¿Cómo funciona LearnFlow?" modal for DeskFlow.
 * Requires lp-help.css and lp-help-content.js.
 *
 *   lpHelp.open(event, { beforeOpen, inertElements, onClose, lang, thresholds })
 */
/* eslint-disable no-var */
var lpHelp = (function () {
  'use strict';

  function resolveLang(options) {
    if (options && options.lang) return options.lang === 'en' ? 'en' : 'es';
    var docLang = (document.documentElement.lang || '').toLowerCase();
    return docLang.indexOf('en') === 0 ? 'en' : 'es';
  }

  function localize(value, lang) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value[lang] || value.es || value.en || '';
  }

  function t(content, lang, key) {
    if (!content) return '';
    return localize(content[key], lang);
  }

  function fillTokens(text, thresholds) {
    return text.replace(/\{\{(\w+)\}\}/g, function (match, key) {
      return thresholds && thresholds[key] != null ? thresholds[key] : match;
    });
  }

  function setInert(elements, inert) {
    if (!elements) return;
    var list = Array.isArray(elements) ? elements : [elements];
    list.forEach(function (el) {
      if (el) el.inert = inert;
    });
  }

  function fallbackContent() {
    return {
      eyebrow: 'LearnFlow · Ayuda',
      title: { es: '¿Cómo funciona LearnFlow?', en: 'How does LearnFlow work?' },
      intro: { es: 'LearnFlow conecta tres apps de aprendizaje.', en: 'LearnFlow connects three learning apps.' },
      sections: [],
    };
  }

  function renderSection(section, lang, thresholds) {
    var summary =
      '<span class="help-section__mark help-section__mark--' +
      section.markClass +
      '" aria-hidden="true">' +
      section.mark +
      '</span>' +
      '<span class="help-section__heading">' +
      '<strong>' +
      localize(section.name, lang) +
      '</strong>' +
      '<span class="help-section__tag">' +
      t(section, lang, 'tag') +
      '</span></span>';
    var pointsHtml = (section.points || [])
      .map(function (point) {
        return '<li>' + fillTokens(localize(point, lang), thresholds) + '</li>';
      })
      .join('');
    return (
      '<details class="help-section"' +
      (section.open ? ' open' : '') +
      '>' +
      '<summary class="help-section__summary">' +
      summary +
      '<span class="help-section__chev" aria-hidden="true">⌄</span>' +
      '</summary>' +
      '<div class="help-section__body">' +
      '<div class="help-section__body-inner">' +
      '<p class="help-section__desc">' +
      t(section, lang, 'summary') +
      '</p>' +
      '<ul class="help-section__points">' +
      pointsHtml +
      '</ul></div></div></details>'
    );
  }

  function open(event, options) {
    options = options || {};
    var lang = resolveLang(options);
    var content = window.LPHelpContent || fallbackContent();
    var thresholds = options.thresholds || { fluentflow: 100, lyricflow: 100, hubflow: 50 };
    document.getElementById('helpLearnFlow')?.remove();
    var opener =
      event && event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : document.activeElement;
    var inertTargets = options.inertElements || [];
    if (options.beforeOpen) options.beforeOpen();
    setInert(inertTargets, true);

    var overlay = document.createElement('div');
    overlay.id = 'helpLearnFlow';
    overlay.className = 'about-overlay help-overlay';
    overlay.innerHTML =
      '<section class="about-modal help-modal" role="dialog" aria-modal="true" aria-labelledby="helpLearnFlowTitle" aria-describedby="helpLearnFlowIntro">' +
      '<header class="about-header">' +
      '<div class="about-identity" aria-hidden="true">?</div>' +
      '<div class="about-header__text">' +
      '<p class="about-eyebrow">' +
      t(content, lang, 'eyebrow') +
      '</p>' +
      '<h2 id="helpLearnFlowTitle">' +
      t(content, lang, 'title') +
      '</h2>' +
      '</div>' +
      '<button class="about-close" id="helpCloseBtn" type="button" aria-label="Cerrar ayuda">✕</button>' +
      '</header>' +
      '<div class="about-body help-body">' +
      '<p id="helpLearnFlowIntro" class="about-description">' +
      t(content, lang, 'intro') +
      '</p>' +
      '<div class="help-sections">' +
      (content.sections || [])
        .map(function (section) {
          return renderSection(section, lang, thresholds);
        })
        .join('') +
      '</div></div></section>';

    document.body.appendChild(overlay);

    var allDetails = Array.prototype.slice.call(overlay.querySelectorAll('.help-section'));
    allDetails.forEach(function (details) {
      details.addEventListener('toggle', function () {
        if (!details.open) return;
        allDetails.forEach(function (other) {
          if (other !== details) other.open = false;
        });
      });
    });

    var focusable = Array.prototype.slice.call(overlay.querySelectorAll('button, a[href], summary'));
    function close() {
      overlay.remove();
      setInert(inertTargets, false);
      document.removeEventListener('keydown', onHelpKeydown);
      if (options.onClose) options.onClose();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    }
    function onHelpKeydown(keyEvent) {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        close();
        return;
      }
      if (keyEvent.key !== 'Tab' || focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (keyEvent.shiftKey && document.activeElement === first) {
        keyEvent.preventDefault();
        last.focus();
      } else if (!keyEvent.shiftKey && document.activeElement === last) {
        keyEvent.preventDefault();
        first.focus();
      }
    }

    overlay.querySelector('#helpCloseBtn').addEventListener('click', close);
    overlay.addEventListener('click', function (clickEvent) {
      if (clickEvent.target === overlay) close();
    });
    document.addEventListener('keydown', onHelpKeydown);
    overlay.querySelector('#helpCloseBtn').focus();
  }

  return { open: open };
})();

window.lpHelp = lpHelp; // ESM side-effect import (main.js) does not attach top-level vars to window like a classic <script> did — restore it explicitly.
