/**
 * Learn Platform — prevent mobile browser zoom on text field focus (lp-input-zoom v2)
 * iOS Safari auto-zooms when computed font-size < 16px. We enforce 16px via injected CSS
 * and lock viewport maximum-scale on touch/focus as a secondary safeguard.
 * Vanilla apps: load in <head> after viewport meta. FluentFlow: public/lp-input-zoom.js.
 */
(function (global) {
  'use strict';

  var locked = false;
  var originalViewport = null;
  var viewportMeta = null;
  var STYLE_ID = 'lp-input-zoom-style';

  function isMobileTouch() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  }

  function isTextField(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName;
    if (tag === 'INPUT') {
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      return (
        type !== 'checkbox' &&
        type !== 'radio' &&
        type !== 'button' &&
        type !== 'submit' &&
        type !== 'reset' &&
        type !== 'file' &&
        type !== 'hidden' &&
        type !== 'range' &&
        type !== 'color'
      );
    }
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return true;
    if (el.getAttribute('role') === 'textbox' && el.getAttribute('contenteditable') !== 'false') {
      return true;
    }
    return false;
  }

  function resolveTextField(el) {
    if (!el || el.nodeType !== 1) return null;
    if (isTextField(el)) return el;
    if (el.tagName === 'LABEL') {
      var forId = el.htmlFor;
      if (forId) {
        var control = document.getElementById(forId);
        if (isTextField(control)) return control;
      }
      var nested = el.querySelector(
        'input, textarea, select, [contenteditable="true"], [role="textbox"]'
      );
      if (isTextField(nested)) return nested;
    }
    return null;
  }

  function injectMobileInputStyles() {
    if (!isMobileTouch() || document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '@media (hover: none) and (pointer: coarse) {' +
      'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=hidden]):not([type=range]):not([type=color]),' +
      'textarea, select, [contenteditable="true"], [role="textbox"] {' +
      'font-size: 16px !important;' +
      '}' +
      '}';
    var parent = document.head || document.documentElement;
    parent.appendChild(style);
  }

  function getViewportMeta() {
    if (viewportMeta) return viewportMeta;
    viewportMeta = document.querySelector('meta[name="viewport"]');
    return viewportMeta;
  }

  function lockViewport() {
    var meta = getViewportMeta();
    if (!meta || locked) return;
    if (!originalViewport) {
      originalViewport = meta.getAttribute('content') || 'width=device-width, initial-scale=1.0';
    }
    var content = originalViewport
      .replace(/,?\s*maximum-scale\s*=\s*[^,]+/gi, '')
      .replace(/,?\s*minimum-scale\s*=\s*[^,]+/gi, '')
      .replace(/,?\s*user-scalable\s*=\s*[^,]+/gi, '')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*$/g, '')
      .trim();
    if (content) content += ', ';
    else content = 'width=device-width, initial-scale=1.0, ';
    meta.setAttribute('content', content + 'maximum-scale=1, user-scalable=no');
    locked = true;
  }

  function unlockViewport() {
    var meta = getViewportMeta();
    if (!meta || !locked || !originalViewport) return;
    meta.setAttribute('content', originalViewport);
    locked = false;
  }

  function maybeLockFromInteraction(e) {
    if (!isMobileTouch()) return;
    if (resolveTextField(e.target)) lockViewport();
  }

  function onFocusIn(e) {
    if (!isMobileTouch()) return;
    if (isTextField(e.target)) lockViewport();
  }

  function onFocusOut(e) {
    if (!isMobileTouch()) return;
    if (!isTextField(e.target)) return;
    setTimeout(function () {
      if (!isTextField(document.activeElement)) unlockViewport();
    }, 50);
  }

  function init() {
    if (!isMobileTouch()) return;
    injectMobileInputStyles();
    document.addEventListener('touchstart', maybeLockFromInteraction, { capture: true, passive: true });
    document.addEventListener('pointerdown', maybeLockFromInteraction, { capture: true, passive: true });
    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('focusout', onFocusOut, true);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') unlockViewport();
    });
  }

  global.LPInputZoom = {
    init: init,
    lock: lockViewport,
    unlock: unlockViewport,
    isTextField: isTextField,
  };

  injectMobileInputStyles();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
