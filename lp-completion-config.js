// @ts-check
// Canonical completion-threshold config — copy to DeskFlow/, HubFlow/js/,
// LyricFlow/js/, FluentFlow/public/ (scripts/copy-shared.sh).
//
// Umbral de % de completitud por app que la regla de avance de nivel CEFR
// exige (ver meetsLevelCompletion() en lp-progress-summary.js). Editable
// desde DeskFlow → Ajustes → Configuración avanzada (lp-completion-settings.js,
// DeskFlow-only).
//
// Sin imports a propósito: lp-progress-summary.js importa este módulo, y
// FluentFlow carga lp-progress-summary.js vía blob-URL con reescritura de
// imports relativos de un solo nivel (ver levelProgression.ts) — un import
// aquí adentro rompería esa carga.

const STORAGE_KEY = 'lp-completion-config';

/** Regla histórica: FluentFlow y LyricFlow exigen 100% del nivel, HubFlow 50%. */
export const DEFAULT_THRESHOLDS = Object.freeze({ fluentflow: 100, lyricflow: 100, hubflow: 50 });

function clampPct(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Umbrales activos: defaults con overrides guardados en localStorage. */
export function getThresholds() {
  let stored = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch (e) {
    stored = null;
  }
  return {
    fluentflow: clampPct(stored?.fluentflow, DEFAULT_THRESHOLDS.fluentflow),
    lyricflow: clampPct(stored?.lyricflow, DEFAULT_THRESHOLDS.lyricflow),
    hubflow: clampPct(stored?.hubflow, DEFAULT_THRESHOLDS.hubflow),
  };
}

export function getThreshold(app) {
  return getThresholds()[app] ?? 100;
}

/** Aplica un patch parcial (ej. {hubflow: 60}) y persiste. Notifica vía evento + storage. */
export function setThresholds(patch) {
  const next = Object.assign({}, getThresholds(), patch);
  next.fluentflow = clampPct(next.fluentflow, DEFAULT_THRESHOLDS.fluentflow);
  next.lyricflow = clampPct(next.lyricflow, DEFAULT_THRESHOLDS.lyricflow);
  next.hubflow = clampPct(next.hubflow, DEFAULT_THRESHOLDS.hubflow);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    /* noop — storage unavailable */
  }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('lp-completion-config-changed', { detail: next }));
  }
  return next;
}

export { STORAGE_KEY };
