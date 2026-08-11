/**
 * LP Settings — shared "Ajustes" modal for vanilla apps. Groups the low-frequency
 * drawer utilities (help, about, privacy, account) that used to be flat items in
 * the sidebar footer into one entry point.
 *
 * Unlike lp-about.js/lp-login.js, this modal does not build its markup from JS —
 * it toggles the static overlay already in index.html (#settingsOverlay), because
 * the rows inside it reuse triggers (#loginTrigger, #aboutTrigger,
 * #replayOnboardingTrigger, #placementTestTrigger) that other modules bind to
 * once at page load.
 *
 *   lpSettings.open(event, { beforeOpen, inertElements, onClose })
 *   lpSettings.close()
 */
/* eslint-disable no-var */
var lpSettings = (function () {
  'use strict';

  var activeClose = null;

  function setInert(elements, inert) {
    if (!elements) return;
    var list = Array.isArray(elements) ? elements : [elements];
    list.forEach(function (el) {
      if (el) el.inert = inert;
    });
  }

  function open(event, options) {
    options = options || {};
    var overlay = document.getElementById('settingsOverlay');
    var closeBtn = overlay && overlay.querySelector('#settingsCloseBtn');
    if (!overlay || !closeBtn) return;

    var opener =
      event && event.currentTarget instanceof HTMLElement
        ? event.currentTarget
        : document.activeElement;
    var inertTargets = options.inertElements || [];
    if (options.beforeOpen) options.beforeOpen();
    setInert(inertTargets, true);

    overlay.hidden = false;

    var focusable = Array.prototype.slice.call(
      overlay.querySelectorAll('button:not([hidden]), a[href]')
    );

    function close() {
      overlay.hidden = true;
      setInert(inertTargets, false);
      document.removeEventListener('keydown', onKeydown);
      overlay.removeEventListener('click', onBackdropClick);
      closeBtn.removeEventListener('click', close);
      activeClose = null;
      if (options.onClose) options.onClose();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    }

    function onKeydown(keyEvent) {
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

    function onBackdropClick(clickEvent) {
      if (clickEvent.target === overlay) close();
    }

    activeClose = close;
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', onBackdropClick);
    document.addEventListener('keydown', onKeydown);
    closeBtn.focus();
  }

  function close() {
    if (activeClose) activeClose();
  }

  return { open: open, close: close };
})();
