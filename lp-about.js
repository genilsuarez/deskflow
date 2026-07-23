/**
 * LP About — shared "About LearnFlow" modal for vanilla apps.
 * Requires lp-about.css and lp-about-content.js (generated from lp-about-content.json).
 *
 *   lpAbout.open(event, { beforeOpen, inertElements, onClose, lang })
 */
/* eslint-disable no-var */
var lpAbout = (function () {
  'use strict';

  function resolveLang(options) {
    if (options && options.lang) return options.lang === 'en' ? 'en' : 'es';
    var docLang = (document.documentElement.lang || '').toLowerCase();
    return docLang.indexOf('en') === 0 ? 'en' : 'es';
  }

  function t(content, lang, key) {
    if (!content || !content[key]) return '';
    var value = content[key];
    if (typeof value === 'string') return value;
    return value[lang] || value.es || value.en || '';
  }

  function appHref(app) {
    if (window.LpNavHelpers && window.LpNavHelpers.themedAppHref) {
      return window.LpNavHelpers.themedAppHref(app);
    }
    if (window.LPPlatformUrls && typeof window.LPPlatformUrls.themingHref === 'function') {
      return window.LPPlatformUrls.themingHref(app);
    }
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      return '/' + app + '/';
    }
    return 'https://genilsuarez.github.io/' + app + '/';
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
      eyebrow: 'LearnFlow · Plataforma',
      title: { es: 'About LearnFlow', en: 'About LearnFlow' },
      description: {
        es: 'Una plataforma para aprender idiomas con estructura, práctica y música.',
        en: 'A platform for learning languages with structure, practice, and music.',
      },
      modules: [
        { id: 'deskflow', mark: 'L', markClass: 'portal', name: 'LearnFlow', subtitle: { es: 'Portal', en: 'Portal' } },
        { id: 'fluentflow', mark: 'F', markClass: 'fluent', name: 'FluentFlow', subtitle: { es: 'Ruta de inglés por niveles CEFR', en: 'English path by CEFR levels' } },
        { id: 'hubflow', mark: 'H', markClass: 'hub', name: 'HubFlow', subtitle: { es: 'Práctica flexible de gramática', en: 'Flexible grammar practice' } },
        { id: 'lyricflow', mark: 'LF', markClass: 'lyric', name: 'LyricFlow', subtitle: { es: 'Aprender con música', en: 'Learn with music' } },
      ],
      author: {
        initials: 'GS',
        name: 'Genil Suárez',
        bio: {
          es: 'Diseñado y desarrollado como proyecto personal',
          en: 'Designed and built as a personal project',
        },
      },
    };
  }

  function renderModules(content, lang) {
    return (content.modules || [])
      .map(function (mod) {
        return (
          '<a href="' +
          appHref(mod.id) +
          '" data-learnflow-app="' +
          mod.id +
          '">' +
          '<span class="about-module__mark about-module__mark--' +
          mod.markClass +
          '" aria-hidden="true">' +
          mod.mark +
          '</span>' +
          '<span class="about-module__text"><strong>' +
          mod.name +
          '</strong><span>' +
          t(mod, lang, 'subtitle') +
          '</span></span></a>'
        );
      })
      .join('');
  }

  function open(event, options) {
    options = options || {};
    var lang = resolveLang(options);
    var content = window.LPAboutContent || fallbackContent();
    document.getElementById('aboutLearnFlow')?.remove();
    var opener =
      event && event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : document.activeElement;
    var inertTargets = options.inertElements || [];
    if (options.beforeOpen) options.beforeOpen();
    setInert(inertTargets, true);

    var overlay = document.createElement('div');
    overlay.id = 'aboutLearnFlow';
    overlay.className = 'about-overlay';
    overlay.innerHTML =
      '<section class="about-modal" role="dialog" aria-modal="true" aria-labelledby="aboutLearnFlowTitle" aria-describedby="aboutLearnFlowDescription">' +
      '<header class="about-header">' +
      '<div class="about-identity" aria-hidden="true">L</div>' +
      '<div class="about-header__text">' +
      '<p class="about-eyebrow">' +
      content.eyebrow +
      '</p>' +
      '<h2 id="aboutLearnFlowTitle">' +
      t(content, lang, 'title') +
      '</h2>' +
      '</div>' +
      '<button class="about-close" id="aboutCloseBtn" type="button" aria-label="Cerrar About LearnFlow">✕</button>' +
      '</header>' +
      '<div class="about-body">' +
      '<p id="aboutLearnFlowDescription" class="about-description">' +
      t(content, lang, 'description') +
      '</p>' +
      '<nav class="about-modules" aria-label="Aplicaciones de LearnFlow">' +
      renderModules(content, lang) +
      '</nav></div>' +
      '<footer class="about-footer">' +
      '<div class="about-author">' +
      '<div class="about-author__avatar" aria-hidden="true">' +
      (content.author && content.author.initials ? content.author.initials : 'GS') +
      '</div>' +
      '<div class="about-author__info">' +
      '<strong>' +
      (content.author && content.author.name ? content.author.name : 'Genil Suárez') +
      '</strong>' +
      '<span>' +
      t(content.author || {}, lang, 'bio') +
      '</span>' +
      '</div></div></footer></section>';

    document.body.appendChild(overlay);

    var focusable = Array.prototype.slice.call(overlay.querySelectorAll('button, a[href]'));
    function close() {
      overlay.remove();
      setInert(inertTargets, false);
      document.removeEventListener('keydown', onAboutKeydown);
      if (options.onClose) options.onClose();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    }
    function onAboutKeydown(keyEvent) {
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

    overlay.querySelector('#aboutCloseBtn').addEventListener('click', close);
    overlay.addEventListener('click', function (clickEvent) {
      if (clickEvent.target === overlay) close();
    });
    document.addEventListener('keydown', onAboutKeydown);
    overlay.querySelector('#aboutCloseBtn').focus();
  }

  return { open: open };
})();
