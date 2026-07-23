/**
 * LP About — shared "About LearnFlow" modal for vanilla apps.
 * Requires lp-about.css. Optional: LPPlatformUrls for cross-app links.
 *
 *   lpAbout.open(event, { beforeOpen, inertElements, onClose })
 */
/* eslint-disable no-var */
var lpAbout = (function () {
  'use strict';

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

  function open(event, options) {
    options = options || {};
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
      '<p class="about-eyebrow">LearnFlow · Plataforma</p>' +
      '<h2 id="aboutLearnFlowTitle">About LearnFlow</h2>' +
      '</div>' +
      '<button class="about-close" id="aboutCloseBtn" type="button" aria-label="Cerrar About LearnFlow">✕</button>' +
      '</header>' +
      '<div class="about-body">' +
      '<p id="aboutLearnFlowDescription" class="about-description">Una plataforma para aprender idiomas con estructura, práctica y música.</p>' +
      '<nav class="about-modules" aria-label="Aplicaciones de LearnFlow">' +
      '<a href="' +
      appHref('deskflow') +
      '" data-learnflow-app="deskflow">' +
      '<span class="about-module__mark about-module__mark--portal" aria-hidden="true">L</span>' +
      '<span class="about-module__text"><strong>LearnFlow</strong><span>Portal</span></span></a>' +
      '<a href="' +
      appHref('fluentflow') +
      '" data-learnflow-app="fluentflow">' +
      '<span class="about-module__mark about-module__mark--fluent" aria-hidden="true">F</span>' +
      '<span class="about-module__text"><strong>FluentFlow</strong><span>Ruta de inglés por niveles CEFR</span></span></a>' +
      '<a href="' +
      appHref('hubflow') +
      '" data-learnflow-app="hubflow">' +
      '<span class="about-module__mark about-module__mark--hub" aria-hidden="true">H</span>' +
      '<span class="about-module__text"><strong>HubFlow</strong><span>Práctica flexible de gramática</span></span></a>' +
      '<a href="' +
      appHref('lyricflow') +
      '" data-learnflow-app="lyricflow">' +
      '<span class="about-module__mark about-module__mark--lyric" aria-hidden="true">LF</span>' +
      '<span class="about-module__text"><strong>LyricFlow</strong><span>Aprender con música</span></span></a>' +
      '</nav></div>' +
      '<footer class="about-footer">' +
      '<div class="about-author">' +
      '<div class="about-author__avatar" aria-hidden="true">GS</div>' +
      '<div class="about-author__info">' +
      '<strong>Genil Suárez</strong>' +
      '<span>Diseñado y desarrollado como proyecto personal</span>' +
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
