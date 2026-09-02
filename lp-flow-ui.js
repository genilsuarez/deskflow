/**
 * LP Flow UI — piezas visuales compartidas por los flujos de pantalla completa
 * de DeskFlow (onboarding y examen de nivel). Existe para que las dos
 * experiencias se vean como una sola: mismo icono en la misma columna, mismo
 * título con regla de acento, misma franja de cierre.
 *
 * Es un script clásico (sin bundler propio) que expone window.lpFlowUI.
 * Los estilos viven en lp-flow-ui.css.
 */
/* eslint-disable no-var */
var lpFlowUI = (function () {
  'use strict';

  // SVG inline, 24×24, trazo currentColor: no se usa una librería de iconos
  // por una docena de trazos, y así heredan color del tono de su contenedor.
  var ICONS = {
    growth: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/><path d="M15 8h4v4"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
    link: '<path d="M10 13a5 5 0 007 0l2-2a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-2 2a5 5 0 007 7l1-1"/>',
    leaf: '<path d="M4 20c0-8 5-13 15-14 0 10-5 15-13 15H4v-1z"/><path d="M8 16c2-3 4-5 7-6"/>',
    chat: '<path d="M20 15a3 3 0 01-3 3H8l-4 3V6a3 3 0 013-3h10a3 3 0 013 3v9z"/><path d="M8 9h8M8 13h5"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0"/><path d="M16 6a3 3 0 010 6"/><path d="M18 14a6 6 0 013 5"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.8L12 3.5z"/>',
    doc: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z"/><path d="M9.5 12l1.8 1.8 3.4-3.6"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    flag: '<path d="M6 21V4"/><path d="M6 5h11l-2 3.5L17 12H6"/>',
    pen: '<path d="M4 20h4l10-10a2.8 2.8 0 10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.7-1.5 1.2-1.5 2.2"/><path d="M12 17.5h.01"/>',
    trophy: '<path d="M7 4h10v4a5 5 0 01-10 0V4z"/><path d="M7 6H4v1a4 4 0 003 3.9M17 6h3v1a4 4 0 01-3 3.9"/><path d="M9 20h6M12 13v7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };

  function icon(name, cls) {
    if (!ICONS[name]) return '';
    return (
      '<svg class="' + (cls || 'flow-icon') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      ICONS[name] +
      '</svg>'
    );
  }

  /**
   * Cabecera común de todas las pantallas: tolva de icono (columna fija) +
   * título con regla de acento + texto de apoyo alineado con el título, no con
   * el icono — por eso es una rejilla de dos columnas y no un flex.
   *
   * opts: { icon, title, text, tone, titleId }
   */
  function header(opts) {
    return (
      '<div class="flow-head">' +
      '<span class="flow-head__icon' + (opts.tone ? ' flow-head__icon--' + opts.tone : '') + '">' +
      icon(opts.icon, 'flow-icon') +
      '</span>' +
      '<div class="flow-head__text">' +
      '<h2' + (opts.titleId ? ' id="' + opts.titleId + '"' : '') + '>' + opts.title + '</h2>' +
      (opts.text ? '<p class="flow-head__lead">' + opts.text + '</p>' : '') +
      '</div></div>'
    );
  }

  /** Franja de cierre con icono: cierra la rejilla por abajo en cada pantalla. */
  function note(iconName, text) {
    return '<p class="flow-note">' + icon(iconName, 'flow-icon flow-icon--sm') + '<span>' + text + '</span></p>';
  }

  return { icon: icon, header: header, note: note, ICONS: ICONS };
})();

window.lpFlowUI = lpFlowUI; // ESM side-effect import (main.js) does not attach top-level vars to window like a classic <script> did — restore it explicitly.
