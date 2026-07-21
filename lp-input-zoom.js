/**
 * Learn Platform — prevent mobile browser zoom on text field focus (lp-input-zoom v1)
 * iOS Safari zooms when font-size < 16px; locking maximum-scale on focus avoids layout jumps.
 * Vanilla apps: load in <head> after viewport meta. FluentFlow: public/lp-input-zoom.js.
 */
(function (global) {
  'use strict';

  var locked = false;
  var originalViewport = null;
  var viewportMeta = null;

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
