// @ts-check
// Canonical progress summary helpers — copy to DeskFlow/, HubFlow/js/, LyricFlow/.
// DeskFlow imports this module directly; keep all copies in sync (no build step).

import { HUBFLOW_LEVELS, LYRICFLOW_LEVELS } from './lp-level-map.js';

/** Nivel CEFR compartido entre las 3 apps de contenido (minúsculas, distinto de FLUENTFLOW_LEVELS). */
export const LEVEL_ORDER = Object.freeze(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);

const FLUENTFLOW_LEVELS = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const FLUENTFLOW_LEVEL_PATTERN = /^(a1|a2|b1|b2|c1|c2)$/i;
const LYRICFLOW_ACTIVITY_IDS = Object.freeze(['listen', 'dictation', 'challenge', 'quiz']);
export { LYRICFLOW_ACTIVITY_IDS };

function isActivityAttempted(activity) {
  if (!activity || typeof activity !== 'object') return false;
  if (Number.isInteger(activity.attempts) && activity.attempts > 0) return true;
  if (Number.isInteger(activity.completedKeys) && activity.completedKeys > 0) return true;
  const covered = Number(activity.coveredDurationSec);
  return Number.isFinite(covered) && covered > 0;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** HubFlow escribe esto al publicar score-keys en vivo — señal de proyección canónica. */
function readHubflowLocalReady() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem('learnflow:hubflow:local-ready:v1') === '1';
  } catch {
    return false;
  }
}

/** LyricFlow escribe esto al publicar progreso en vivo — señal de proyección canónica. */
function readLyricflowLocalReady() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem('learnflow:lyricflow:local-ready:v1') === '1';
  } catch {
    return false;
  }
}

/** FluentFlow escribe esto en publishLearnFlowIntegration — proyección canónica. */
function readFluentflowLocalReady() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem('learnflow:fluentflow:local-ready:v1') === '1';
  } catch {
    return false;
  }
}

/** Conteo HubFlow para recompute cross-app: estricto, con tolerancia anti ping-pong. */
function resolveHubflowCompletedContent(items, previousCompleted) {
  const strict = items.filter((item) => isItemActuallyComplete(item)).length;
  const previous = Number.isInteger(previousCompleted) ? previousCompleted : 0;
  if (strict > previous) return strict;
  // HubFlow puede publicar más completados que el JSON estricto (score-keys en vivo
  // vs activities en doc). Tolerancia pequeña evita 15↔12. Si previous está muy
  // inflado (p. ej. 38 por flags stale del cloud-merge), prevalece el estricto.
  if (readHubflowLocalReady() && previous > strict && previous <= strict + 5) return previous;
  return strict;
}

/** Conteo LyricFlow (actividades) para recompute cross-app: estricto, con tolerancia anti ping-pong. */
function resolveLyricflowCompletedActivities(content, previousCompleted, catalogTotal) {
  const strict = computeLyricflowActivitySummary(content, catalogTotal).completedActivities;
  const previous = Number.isInteger(previousCompleted) ? previousCompleted : 0;
  if (strict > previous) return strict;
  // LyricFlow publica desde deriveSummary en vivo; un recompute cross-app desde
  // el ledger puede quedar corto (p. ej. listen sin evento passed). Tolerancia
  // pequeña evita ping-pong entre pestañas sin congelar inflaciones grandes.
  if (readLyricflowLocalReady() && previous > strict && previous <= strict + 4) return previous;
  return strict;
}

function isLyricflowSongComplete(item) {
  if (!isRecord(item?.activities)) return false;
  const completedCount = LYRICFLOW_ACTIVITY_IDS.filter((id) => item.activities[id]?.completed).length;
  const challengesDone = ['dictation', 'challenge', 'quiz'].every(
    (id) => item.activities[id]?.completed,
  );
  return completedCount === LYRICFLOW_ACTIVITY_IDS.length || challengesDone;
}

/**
 * Recalcula si un item está realmente completo a partir de sus `activities`
 * (completedKeys === totalKeys en las requeridas), en vez de confiar en el
 * flag `item.completed` de la raíz. Ese flag se fusiona en sync-engine.js
 * con `Boolean(row.completed) || Boolean(existing.completed)` — "nunca
 * retrocede" — así que si la regla de completado de la app dueña se volvió
 * más estricta (ej. HubFlow: Study ahora también exige el ✓) después de la
 * última sync de ese item, el flag de raíz puede quedar pegado en `true`
 * aunque ya no lo sea.
 *
 * Solo mira 'quiz' y 'study' — los únicos activityId que HubFlow usa en
 * PROGRESS_RULES (ver catalog.js). `item.activities` puede traer además
 * entradas "match"/"timed" (rastreadas para la matriz de progreso/Maestría,
 * no exigidas para Aprobado — ver resolveScoreActivity en progress-store.js);
 * si se contaran aquí, un módulo con Study+Quiz al 100% pero Match sin jugar
 * nunca se marcaría como completo. Esta función es genérica a propósito (sin
 * importar el catálogo de cada app, que este archivo no tiene) — misma
 * defensa que ya usa HubFlow para su propio resumen (`isStoredItemCompleted`
 * en progress-store.js, que si conoce la regla real), pero disponible
 * también para lectores cross-app (DeskFlow, LyricFlow) que pueden leer el
 * doc de otra app sin haberla abierto para autocorregirlo.
 */
/**
 * El activityId del modo Quiz se llamó 'practice' hasta 2026-08-19. Ese nombre
 * viaja dentro de los eventos del ledger y de los docs de progreso, tanto en
 * localStorage como en Supabase, así que todo lo ya guardado sigue diciendo
 * 'practice'. Se traduce al leer en vez de reescribir el histórico: los
 * registros viejos siguen siendo válidos y un cliente antiguo no se rompe.
 */
export function normalizeLegacyActivityId(activityId) {
  return activityId === 'practice' ? 'quiz' : activityId;
}

/** Aplica normalizeLegacyActivityId a un mapa `activities`, fusionando si ya
 *  hubiera una entrada 'quiz' (dispositivo que grabó antes y después del cambio). */
export function normalizeLegacyActivities(activities) {
  if (!isRecord(activities) || !isRecord(activities.practice)) return activities;
  const { practice, ...rest } = activities;
  const existing = isRecord(rest.quiz) ? rest.quiz : null;
  if (!existing) return { ...rest, quiz: practice };
  return {
    ...rest,
    quiz: {
      ...practice,
      ...existing,
      completedKeys: Math.max(practice.completedKeys ?? 0, existing.completedKeys ?? 0),
      totalKeys: Math.max(practice.totalKeys ?? 0, existing.totalKeys ?? 0),
      bestScorePct: Math.max(practice.bestScorePct ?? 0, existing.bestScorePct ?? 0) || null,
      attempts: (practice.attempts ?? 0) + (existing.attempts ?? 0),
      completed: Boolean(practice.completed || existing.completed),
    },
  };
}

export function isItemActuallyComplete(item) {
  const activities = normalizeLegacyActivities(isRecord(item?.activities) ? item.activities : {});
  const required = ['quiz', 'study']
    .map((id) => activities[id])
    .filter((activity) => isRecord(activity));
  if (!required.length) return Boolean(item?.completed);
  return required.every((activity) =>
    Number.isInteger(activity.totalKeys) && activity.totalKeys > 0
      ? activity.completedKeys === activity.totalKeys
      : Boolean(activity.completed)
  );
}

/** Infiere nivel CEFR desde el id de módulo (p. ej. quiz-greetings-a1 o a1-reading-1). */
export function inferFluentflowCefrLevel(contentId) {
  if (!isNonEmptyString(contentId)) return null;
  const suffix = contentId.match(/-(a1|a2|b1|b2|c1|c2)$/i);
  if (suffix) return suffix[1].toUpperCase();
  const prefix = contentId.match(/^(a1|a2|b1|b2|c1|c2)-/i);
  if (prefix) return prefix[1].toUpperCase();
  return null;
}

function resolveFluentflowCefrLevel(contentId, item) {
  if (isRecord(item) && isNonEmptyString(item.cefrLevel) && FLUENTFLOW_LEVEL_PATTERN.test(item.cefrLevel)) {
    return item.cefrLevel.toUpperCase();
  }
  return inferFluentflowCefrLevel(contentId);
}

function groupFluentflowContentByLevel(content) {
  const byLevel = Object.fromEntries(FLUENTFLOW_LEVELS.map((level) => [level, []]));
  for (const [contentId, item] of Object.entries(content || {})) {
    if (!isRecord(item)) continue;
    const level = resolveFluentflowCefrLevel(contentId, item);
    if (!level || !byLevel[level]) continue;
    byLevel[level].push(item);
  }
  return byLevel;
}

function isFluentflowPreviousLevelComplete(cefrLevel, byLevel) {
  const idx = FLUENTFLOW_LEVELS.indexOf(cefrLevel);
  if (idx <= 0) return true;
  const previousLevel = FLUENTFLOW_LEVELS[idx - 1];
  const previousModules = byLevel[previousLevel] || [];
  if (previousModules.length === 0) return true;
  return previousModules.every((item) => item.completed === true);
}

export function computeFluentflowProgressSummary(content) {
  const byLevel = groupFluentflowContentByLevel(content);
  let completedContent = 0;

  for (const level of FLUENTFLOW_LEVELS) {
    for (const item of byLevel[level]) {
      if (item.completed !== true) continue;
      if (!isFluentflowPreviousLevelComplete(level, byLevel)) continue;
      completedContent++;
    }
  }

  const totalContent = Object.values(content || {}).filter(isRecord).length;
  const cefr = Object.fromEntries(
    FLUENTFLOW_LEVELS.map((level) => {
      const levelModules = byLevel[level];
      const completedModules = levelModules.filter(
        (item) => item.completed === true && isFluentflowPreviousLevelComplete(level, byLevel)
      ).length;
      const totalModules = levelModules.length;
      const progressPct = totalModules > 0 ? (completedModules / totalModules) * 100 : 0;
      const status =
        completedModules === 0
          ? 'not_started'
          : completedModules === totalModules
            ? 'completed'
            : progressPct >= 80
              ? 'near_completion'
              : 'in_progress';
      return [level, { progressPct, completedModules, totalModules, status }];
    })
  );

  return {
    completedContent,
    totalContent,
    progressPct: totalContent > 0 ? (completedContent / totalContent) * 100 : 0,
    cefr,
  };
}

function emptyLyricflowActivity(activityId) {
  const base = {
    completed: false,
    completedAt: null,
    bestScorePct: null,
    lastScorePct: null,
    attempts: 0,
    lastAttemptAt: null,
    lastRunId: null,
    /** @type {number|undefined} */
    coveragePct: undefined,
    /** @type {number|undefined} */
    eligibleDurationSec: undefined,
    /** @type {number|undefined} */
    coveredDurationSec: undefined,
    /** @type {unknown[]|undefined} */
    coverageRanges: undefined,
  };
  if (activityId === 'listen') {
    return {
      ...base,
      coveragePct: 0,
      eligibleDurationSec: 0,
      coveredDurationSec: 0,
      coverageRanges: [],
    };
  }
  return base;
}

function pickLaterIso(first, second) {
  if (!first) return second || null;
  if (!second) return first || null;
  return new Date(first).getTime() >= new Date(second).getTime() ? first : second;
}

function mergeNumericMax(a, b) {
  const values = [a, b].filter((value) => Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

/** Fusiona dos entradas de actividad LyricFlow sin retroceder progreso. */
export function mergeLyricflowActivityEntry(existing, remote, activityId) {
  const base = emptyLyricflowActivity(activityId);
  const left = isRecord(existing) ? existing : {};
  const right = isRecord(remote) ? remote : {};
  const completed = Boolean(left.completed) || Boolean(right.completed);
  const attempts = Math.max(left.attempts ?? 0, right.attempts ?? 0);
  const bestScorePct = mergeNumericMax(left.bestScorePct, right.bestScorePct);
  const lastAttemptAt = pickLaterIso(left.lastAttemptAt, right.lastAttemptAt);
  const leftIsNewer = lastAttemptAt && left.lastAttemptAt === lastAttemptAt;
  const lastScorePct = leftIsNewer
    ? (left.lastScorePct ?? bestScorePct)
    : (right.lastScorePct ?? bestScorePct);
  const completedAt = completed ? pickLaterIso(left.completedAt, right.completedAt) : null;
  const lastRunId = leftIsNewer ? (left.lastRunId || right.lastRunId) : (right.lastRunId || left.lastRunId);

  const merged = {
    ...base,
    completed,
    attempts,
    bestScorePct,
    lastScorePct,
    lastAttemptAt,
    completedAt,
    lastRunId,
    /** @type {number|undefined} */
    coveragePct: undefined,
    /** @type {number|undefined} */
    eligibleDurationSec: undefined,
    /** @type {number|undefined} */
    coveredDurationSec: undefined,
    /** @type {unknown[]|undefined} */
    coverageRanges: undefined,
  };

  if (activityId === 'listen') {
    merged.coveragePct = Math.max(left.coveragePct ?? 0, right.coveragePct ?? 0);
    merged.eligibleDurationSec = Math.max(left.eligibleDurationSec ?? 0, right.eligibleDurationSec ?? 0);
    merged.coveredDurationSec = Math.max(left.coveredDurationSec ?? 0, right.coveredDurationSec ?? 0);
    merged.coverageRanges = (left.coveredDurationSec ?? 0) >= (right.coveredDurationSec ?? 0)
      ? (left.coverageRanges || [])
      : (right.coverageRanges || []);
  }

  return merged;
}

/** Fusiona mapas activities de LyricFlow actividad por actividad. */
export function mergeLyricflowActivities(existing, remote) {
  const left = isRecord(existing) ? existing : {};
  const right = isRecord(remote) ? remote : {};
  return Object.fromEntries(
    LYRICFLOW_ACTIVITY_IDS.map((activityId) => [
      activityId,
      mergeLyricflowActivityEntry(left[activityId], right[activityId], activityId),
    ]),
  );
}

function mergeHubflowActivityEntry(existing, remote) {
  if (!isRecord(existing)) return isRecord(remote) ? { ...remote } : existing;
  if (!isRecord(remote)) return { ...existing };

  const left = existing;
  const right = remote;
  const leftTotal = left.totalKeys ?? 0;
  const rightTotal = right.totalKeys ?? 0;
  // Misma defensa que mergeHubflowProgressItem en HubFlow: si el catálogo
  // creció (p. ej. 2 → 6 scoreKeys), un Math.max ciego de totalKeys +
  // completedKeys reconstruye un "completo" fantasma (viejo 2/2 + total 6
  // → completed=true con 2/6). Solo se puede heredar completedKeys entre
  // formas iguales; si no, gana la forma con más totalKeys (catálogo actual).
  const sameShape = leftTotal > 0 && leftTotal === rightTotal;
  let totalKeys;
  let completedKeys;
  if (sameShape) {
    totalKeys = leftTotal;
    completedKeys = Math.max(left.completedKeys ?? 0, right.completedKeys ?? 0);
  } else if (rightTotal > leftTotal) {
    totalKeys = rightTotal;
    completedKeys = right.completedKeys ?? 0;
  } else if (leftTotal > rightTotal) {
    totalKeys = leftTotal;
    completedKeys = left.completedKeys ?? 0;
  } else {
    totalKeys = 0;
    completedKeys = Math.max(left.completedKeys ?? 0, right.completedKeys ?? 0);
  }
  const completed = totalKeys > 0
    ? completedKeys === totalKeys
    : Boolean(left.completed || right.completed);

  return {
    ...left,
    ...right,
    completed,
    completedKeys,
    totalKeys,
    bestScorePct: mergeNumericMax(left.bestScorePct, right.bestScorePct),
    attempts: Math.max(left.attempts ?? 0, right.attempts ?? 0),
    completedAt: completed
      ? (pickLaterIso(left.completedAt, right.completedAt) || left.completedAt || right.completedAt || null)
      : null,
    lastAttemptAt: pickLaterIso(left.lastAttemptAt, right.lastAttemptAt),
  };
}

/** Fusiona mapas activities de HubFlow por clave de modo. */
export function mergeHubflowActivities(existing, remote) {
  const left = isRecord(existing) ? existing : {};
  const right = isRecord(remote) ? remote : {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const merged = {};
  keys.forEach((key) => {
    merged[key] = mergeHubflowActivityEntry(left[key], right[key]);
  });
  return merged;
}

/** Snapshot estable para detectar cambios en activities de LyricFlow. */
export function lyricflowActivitiesSnapshot(activities) {
  if (!isRecord(activities)) return '';
  return LYRICFLOW_ACTIVITY_IDS.map((activityId) => {
    const activity = activities[activityId];
    if (!isRecord(activity)) return `${activityId}:0`;
    return [
      activityId,
      activity.completed ? 1 : 0,
      activity.attempts ?? 0,
      activity.bestScorePct ?? '',
      activity.coveredDurationSec ?? 0,
    ].join(':');
  }).join('|');
}

/** Indica si una fusión local/remota cambió datos relevantes. */
export function contentEntryMergeChanged(existing, merged, app) {
  if (!existing) return true;
  if (merged.completed !== existing.completed) return true;
  if (merged.bestScorePct !== existing.bestScorePct) return true;
  if (merged.attempts !== existing.attempts) return true;
  if (merged.progressPct !== existing.progressPct) return true;
  if (app === 'lyricflow') {
    return lyricflowActivitiesSnapshot(merged.activities)
      !== lyricflowActivitiesSnapshot(existing.activities);
  }
  if (app === 'hubflow') {
    return JSON.stringify(merged.activities || {}) !== JSON.stringify(existing.activities || {});
  }
  return false;
}

function lyricflowActivityFromEvents(events, activityId) {
  if (!Array.isArray(events) || !events.length) return null;
  const passed = events.some((event) => event.passed === true);
  const scores = events.map((event) => event.scorePct).filter((value) => Number.isFinite(value));
  const bestScorePct = scores.length ? Math.max(...scores) : null;
  const lastEvent = events.reduce((latest, event) => {
    if (!event?.occurredAt) return latest;
    if (!latest?.occurredAt) return event;
    return new Date(event.occurredAt) > new Date(latest.occurredAt) ? event : latest;
  }, null);
  const completed = passed || (activityId === 'listen' && events.some((event) => event.passed === true));
  const derived = {
    ...emptyLyricflowActivity(activityId),
    completed,
    attempts: events.length,
    bestScorePct,
    lastScorePct: lastEvent?.scorePct ?? bestScorePct,
    lastAttemptAt: lastEvent?.occurredAt ?? null,
    completedAt: completed ? (lastEvent?.occurredAt ?? null) : null,
    lastRunId: lastEvent?.runId ?? null,
  };
  if (activityId === 'listen' && completed) {
    derived.coveragePct = 100;
    derived.coveredDurationSec = Math.max(derived.coveredDurationSec, 1);
  }
  return derived;
}

/**
 * Refuerza progress.activities desde el ledger de eventos cuando el JSON en
 * Supabase quedó vacío o incompleto (events sí sincronizan).
 */
export function applyLyricflowActivityEvents(content, events) {
  if (!isRecord(content) || !Array.isArray(events) || !events.length) return false;

  const grouped = new Map();
  for (const event of events) {
    if (!event?.contentId || !event?.activity) continue;
    if (!grouped.has(event.contentId)) grouped.set(event.contentId, new Map());
    const byActivity = grouped.get(event.contentId);
    if (!byActivity.has(event.activity)) byActivity.set(event.activity, []);
    byActivity.get(event.activity).push(event);
  }

  let changed = false;
  for (const [contentId, byActivity] of grouped.entries()) {
    if (!isRecord(content[contentId])) {
      content[contentId] = {
        contentId,
        contentType: 'song',
        progressPct: 0,
        completed: false,
        completedAt: null,
        bestScorePct: null,
        lastScorePct: null,
        attempts: 0,
        activities: {},
      };
      changed = true;
    }

    const song = content[contentId];
    const before = lyricflowActivitiesSnapshot(song.activities);
    enrichLyricflowSongEntry(contentId, song);

    for (const [activityId, activityEvents] of byActivity.entries()) {
      if (!LYRICFLOW_ACTIVITY_IDS.includes(activityId)) continue;
      const fromEvents = lyricflowActivityFromEvents(activityEvents, activityId);
      if (!fromEvents) continue;
      song.activities[activityId] = mergeLyricflowActivityEntry(
        song.activities[activityId],
        fromEvents,
        activityId,
      );
    }

    enrichLyricflowSongEntry(contentId, song);
    if (lyricflowActivitiesSnapshot(song.activities) !== before) changed = true;
  }

  return changed;
}

/** Cuenta actividades completadas en una fila LyricFlow (con enrich opcional). */
export function countLyricflowCompletedActivities(item, { enrich = true } = {}) {
  if (!isRecord(item)) return 0;
  const clone = enrich
    ? JSON.parse(JSON.stringify(item))
    : item;
  if (enrich) enrichLyricflowSongEntry(item.contentId || clone.contentId || '', clone);
  const activities = isRecord(clone.activities) ? clone.activities : {};
  return LYRICFLOW_ACTIVITY_IDS.filter((activityId) => activities[activityId]?.completed).length;
}

/** Rellena activities cuando la fila remota solo trae flags agregados (sin detalle por modo). */
export function enrichLyricflowSongEntry(contentId, item) {
  if (!isRecord(item)) return;
  if (!item.activities || typeof item.activities !== 'object') item.activities = {};
  for (const activityId of LYRICFLOW_ACTIVITY_IDS) {
    item.activities[activityId] = {
      ...emptyLyricflowActivity(activityId),
      ...(item.activities[activityId] || {}),
    };
  }

  const hasActivitySignal = LYRICFLOW_ACTIVITY_IDS.some((id) => {
    const activity = item.activities[id];
    return activity?.completed || (activity?.attempts ?? 0) > 0 || (activity?.coveredDurationSec ?? 0) > 0;
  });

  if (!hasActivitySignal && (item.completed || (item.attempts ?? 0) > 0 || (item.bestScorePct ?? 0) > 0)) {
    const score = item.bestScorePct ?? item.lastScorePct ?? null;
    const completedAt = item.completedAt || null;
    for (const activityId of ['dictation', 'challenge', 'quiz']) {
      item.activities[activityId] = {
        ...item.activities[activityId],
        completed: Boolean(item.completed),
        attempts: Math.max(item.activities[activityId]?.attempts ?? 0, item.attempts ?? 0, item.completed ? 1 : 0),
        bestScorePct: score,
        lastScorePct: item.lastScorePct ?? score,
        completedAt: item.completed ? completedAt : item.activities[activityId]?.completedAt ?? null,
      };
    }
    if (item.completed || (item.progressPct ?? 0) >= 75) {
      item.activities.listen = {
        ...item.activities.listen,
        completed: Boolean(item.completed),
        coveragePct: item.completed ? 100 : item.activities.listen?.coveragePct ?? 0,
        attempts: Math.max(item.activities.listen?.attempts ?? 0, item.completed ? 1 : 0),
      };
    }
  }

  const completedCount = LYRICFLOW_ACTIVITY_IDS.filter((id) => item.activities[id]?.completed).length;
  item.progressPct = completedCount * 25;
  const challengesDone = ['dictation', 'challenge', 'quiz'].every((id) => item.activities[id]?.completed);
  item.completed = completedCount === LYRICFLOW_ACTIVITY_IDS.length || challengesDone;
  if (!item.contentId) item.contentId = contentId;
  if (!item.contentType) item.contentType = 'song';
}

/** Fallback cuando Supabase no devolvió el mapa activities (solo agregados del ejercicio). */
export function enrichHubflowContentEntry(item) {
  if (!isRecord(item)) return;
  const hasActivities = item.activities && Object.keys(item.activities).length > 0;
  if (hasActivities) return;
  if (!item.completed && !(item.attempts > 0) && !(item.bestScorePct > 0) && !(item.progressPct > 0)) return;

  const pct = Math.max(item.bestScorePct ?? 0, item.lastScorePct ?? 0, item.progressPct ?? 0, item.completed ? 70 : 0);
  item.activities = {
    quiz: {
      completed: Boolean(item.completed),
      completedKeys: item.completed ? 1 : 0,
      totalKeys: 1,
      bestScorePct: pct || null,
      attempts: Math.max(item.attempts ?? 0, item.completed ? 1 : 0),
      completedAt: item.completed ? item.completedAt || null : null,
      lastAttemptAt: item.completedAt || null,
    },
  };
}

function hubflowActivityFromEvents(events) {
  if (!Array.isArray(events) || !events.length) return null;
  const scores = events.map((event) => event.scorePct).filter(Number.isFinite);
  const bestScorePct = scores.length ? Math.max(...scores) : null;
  const passedKeys = new Set(
    events
      .filter((event) => event.passed === true && event.metrics?.scoreKey)
      .map((event) => event.metrics.scoreKey),
  );
  const hasPassed = events.some((event) => event.passed === true);
  const lastEvent = events.reduce((latest, event) => {
    if (!event?.occurredAt) return latest;
    if (!latest?.occurredAt) return event;
    return new Date(event.occurredAt) > new Date(latest.occurredAt) ? event : latest;
  }, null);
  const completedKeys = passedKeys.size > 0 ? passedKeys.size : (hasPassed ? 1 : 0);
  const totalKeys = Math.max(completedKeys, 1);
  const completed = hasPassed && (passedKeys.size === 0 || completedKeys >= totalKeys);
  return {
    completed,
    completedKeys,
    totalKeys,
    bestScorePct,
    attempts: events.length,
    completedAt: completed ? (lastEvent?.occurredAt ?? null) : null,
    lastAttemptAt: lastEvent?.occurredAt ?? null,
  };
}

/** Deriva flags agregados del ejercicio solo desde quiz/study (Aprobado). */
function syncHubflowItemFromActivities(item) {
  if (!isRecord(item)) return;
  const activities = normalizeLegacyActivities(isRecord(item.activities) ? item.activities : {});
  const required = ['quiz', 'study'].map((id) => activities[id]).filter(isRecord);
  if (!required.length) return;

  const totalKeys = required.reduce((sum, activity) => sum + (activity.totalKeys ?? 0), 0);
  const completedKeys = required.reduce((sum, activity) => sum + (activity.completedKeys ?? 0), 0);
  if (totalKeys > 0) item.progressPct = (completedKeys / totalKeys) * 100;
  item.attempts = required.reduce((sum, activity) => sum + (activity.attempts ?? 0), 0);
  item.bestScorePct = required.reduce(
    (best, activity) => mergeNumericMax(best, activity.bestScorePct),
    null,
  );
  const completed = isItemActuallyComplete(item);
  if (completed) item.completed = true;
  const completedAtCandidates = required
    .map((activity) => activity.completedAt)
    .filter(Boolean)
    .sort();
  if (completed) {
    item.completedAt = completedAtCandidates.at(-1) || item.completedAt || null;
  } else if (!item.completed) {
    item.completedAt = null;
  }
}

function rederiveHubflowExerciseFromActivities(item) {
  syncHubflowItemFromActivities(item);
}

/**
 * Refuerza progress.activities desde el ledger de eventos cuando el JSON en
 * Supabase quedó vacío o incompleto (mismo patrón que LyricFlow).
 */
export function applyHubflowActivityEvents(content, events) {
  if (!isRecord(content) || !Array.isArray(events) || !events.length) return false;

  const grouped = new Map();
  for (const event of events) {
    if (!event?.contentId || !event?.activity) continue;
    const groupKey = `${event.contentId}\u0000${normalizeLegacyActivityId(event.activity)}`;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(event);
  }

  let changed = false;
  const touchedItems = new Set();
  for (const [groupKey, activityEvents] of grouped.entries()) {
    const [contentId, activityId] = groupKey.split('\u0000');
    const fromEvents = hubflowActivityFromEvents(activityEvents);
    if (!fromEvents) continue;

    if (!isRecord(content[contentId])) {
      content[contentId] = {
        contentId,
        contentType: 'exercise',
        progressPct: 0,
        completed: false,
        completedAt: null,
        bestScorePct: null,
        attempts: 0,
        activities: {},
      };
      changed = true;
    }

    const item = content[contentId];
    if (!isRecord(item.activities)) item.activities = {};
    const before = JSON.stringify(item.activities[activityId] ?? null);
    item.activities[activityId] = mergeHubflowActivityEntry(item.activities[activityId], fromEvents);
    if (JSON.stringify(item.activities[activityId] ?? null) !== before) {
      changed = true;
      touchedItems.add(contentId);
    }
  }

  for (const contentId of touchedItems) {
    const item = content[contentId];
    const beforeItem = JSON.stringify({
      completed: item.completed,
      completedAt: item.completedAt,
      progressPct: item.progressPct,
    });
    syncHubflowItemFromActivities(item);
    if (JSON.stringify({
      completed: item.completed,
      completedAt: item.completedAt,
      progressPct: item.progressPct,
    }) !== beforeItem) changed = true;
  }

  return changed;
}

export function computeHubflowActivitySummary(content) {
  const items = content && typeof content === 'object' ? Object.values(content).filter(isRecord) : [];
  let completedActivities = 0;
  let totalActivities = 0;
  let attemptedActivities = 0;

  for (const item of items) {
    if (!isRecord(item.activities)) continue;
    const activities = Object.values(item.activities).filter(isRecord);
    totalActivities += activities.length;
    let itemAttempted = false;
    for (const activity of activities) {
      if (activity.completed) completedActivities++;
      if (isActivityAttempted(activity)) {
        attemptedActivities++;
        itemAttempted = true;
      }
    }
    // Tras sync remoto a veces quedan attempts a nivel de ejercicio pero no en cada actividad.
    if (!itemAttempted && Number.isInteger(item.attempts) && item.attempts > 0) attemptedActivities++;
  }

  return { completedActivities, totalActivities, attemptedActivities };
}

export function computeLyricflowActivitySummary(content, totalSongs = null) {
  const songs = content && typeof content === 'object' ? Object.values(content).filter(isRecord) : [];
  const songCount = Number.isInteger(totalSongs) && totalSongs >= 0 ? totalSongs : songs.length;
  let completedActivities = 0;
  let attemptedActivities = 0;

  for (const song of songs) {
    const activities = isRecord(song.activities) ? song.activities : {};
    for (const activityId of LYRICFLOW_ACTIVITY_IDS) {
      const activity = activities[activityId];
      if (isRecord(activity) && activity.completed) completedActivities++;
      if (isActivityAttempted(activity)) attemptedActivities++;
    }
  }

  return {
    completedActivities,
    totalActivities: songCount * LYRICFLOW_ACTIVITY_IDS.length,
    attemptedActivities,
  };
}

/** Snapshot summary + content (+ cefr for FluentFlow) for change detection. */
function snapshotRecomputeState(doc, app) {
  return JSON.stringify({
    summary: doc.summary,
    cefr: app === 'fluentflow' ? doc.cefr : undefined,
    content: doc.content,
  });
}

// learnflow:catalog:<app>:v1 — tamaño de catálogo público, sembrado por el
// publish propio de cada app o por DeskFlow/lp-catalog-warmer.js cuando esa
// app nunca corrió en este dispositivo. Fallback intermedio entre
// doc.catalogTotalContent (mejor fuente, pero puede faltar en documentos
// viejos sincronizados desde la nube antes de abrir la app dueña) e
// items.length (peor fuente: el tamaño crudo del content map, que solo
// refleja cuántos ids distintos tiene el usuario, no el catálogo real).
function readCatalogTotalFallback(app) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`learnflow:catalog:${app}:v1`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Number.isInteger(parsed?.totalContent) && parsed.totalContent > 0 ? parsed.totalContent : null;
  } catch {
    return null;
  }
}

// Mismo learnflow:catalog:<app>:v1, pero el set de ids en vez del total —
// permite podar del content map los content_ids que el cloud-merge
// (downloadApp() en sync-engine.js) unió desde Supabase pero que ya no
// existen en el catálogo vigente (contenido renombrado/reestructurado).
// Sin podar, esos ids huérfanos con completed:true inflan tanto
// completedContent como (para FluentFlow) el gating CEFR secuencial, que
// depende de saber con certeza si TODOS los módulos reales del nivel
// anterior están completos.
function readCatalogIdsFallback(app) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`learnflow:catalog:${app}:v1`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.ids) && parsed.ids.length > 0 ? new Set(parsed.ids) : null;
  } catch {
    return null;
  }
}

// Poda eventos de actividad cuyo contentId ya no existe en el catálogo vigente.
// El ledger (learnflow:activity:<app>:v1) es la otra mitad del ciclo de
// huérfanos: aunque el content map de progreso quede limpio, sync-engine sube
// el ledger completo en cada sync (syncActivityEvents), así que los eventos
// huérfanos se reinstalan en Supabase y vuelven a inflar total_score /
// total_attempts del dashboard admin.
//
// Fail-open igual que readCatalogIdsFallback: si el catálogo no cargó, no
// filtra. Los eventos sin contentId se conservan — no se pueden clasificar y
// descartarlos perdería datos.
export function pruneActivityEventsToCatalog(events, app) {
  if (!Array.isArray(events)) return events;
  const catalogIds = readCatalogIdsFallback(app);
  if (!catalogIds) return events;
  return events.filter((event) => {
    const contentId = event?.contentId;
    return !contentId || catalogIds.has(contentId);
  });
}

// Aplica invalidaciones (migración 024: progress_invalidations) a un content
// map y a un array de eventos, en el local. Cada invalidación es
// { content_id, invalidated_at } — content_id null significa "toda la app".
// Pura, sin IO: sync-engine.js hace el fetch/readRaw/writeRaw alrededor.
// Devuelve { content, events, changed } — content/events son las mismas
// referencias sin tocar si changed es false.
export function applyProgressInvalidations(content, events, invalidations) {
  if (!Array.isArray(invalidations) || !invalidations.length) {
    return { content, events, changed: false };
  }

  const wholeApp = invalidations.some((inv) => !inv?.content_id);
  const ids = new Set(invalidations.map((inv) => inv?.content_id).filter(Boolean));

  let changed = false;
  let nextContent = content;
  let nextEvents = events;

  if (wholeApp) {
    if (isRecord(content) && Object.keys(content).length) {
      nextContent = {};
      changed = true;
    }
    if (Array.isArray(events) && events.length) {
      nextEvents = [];
      changed = true;
    }
    return { content: nextContent, events: nextEvents, changed };
  }

  if (ids.size) {
    if (isRecord(content)) {
      const filteredEntries = Object.entries(content).filter(([id]) => !ids.has(id));
      if (filteredEntries.length !== Object.keys(content).length) {
        nextContent = Object.fromEntries(filteredEntries);
        changed = true;
      }
    }
    if (Array.isArray(events)) {
      const filtered = events.filter((event) => !ids.has(event?.contentId));
      if (filtered.length !== events.length) {
        nextEvents = filtered;
        changed = true;
      }
    }
  }

  return { content: nextContent, events: nextEvents, changed };
}

/** Rebuild summary (and FluentFlow cefr) from raw content after cloud merge. */
export function recomputeProgressDocumentSummary(doc, app) {
  if (!isRecord(doc) || !isRecord(doc.content)) return false;
  doc.summary = isRecord(doc.summary) ? doc.summary : {};
  const before = snapshotRecomputeState(doc, app);

  const catalogIds = readCatalogIdsFallback(app);
  if (catalogIds) {
    for (const contentId of Object.keys(doc.content)) {
      if (!catalogIds.has(contentId)) delete doc.content[contentId];
    }
  }

  const items = Object.values(doc.content).filter(isRecord);

  // catalogTotalContent lo estampa la app dueña del catálogo (FluentFlow/
  // HubFlow/LyricFlow) en cada publish propio, fuera de content/summary.
  // El cloud-merge de DeskFlow (downloadApp() en sync-engine.js) solo une
  // content_ids de Supabase sin podar ids huérfanos de catálogos viejos —
  // así que items.length en ese punto puede quedar inflado (o, si el
  // usuario nunca abrió esa app con el schema nuevo, simplemente reflejar
  // solo los ids con los que interactuó, no el catálogo completo). Si
  // catalogTotalContent falta, learnflow:catalog:<app>:v1 (público, no
  // depende de sesión) es la fuente de verdad; items.length es el último
  // fallback para cuando ni siquiera esa clave existe todavía.
  const catalogTotal = Number.isInteger(doc.catalogTotalContent) && doc.catalogTotalContent > 0
    ? doc.catalogTotalContent
    : readCatalogTotalFallback(app) ?? items.length;

  if (app === 'fluentflow') {
    for (const [contentId, item] of Object.entries(doc.content)) {
      if (!isRecord(item)) continue;
      if (!item.cefrLevel) {
        const inferred = inferFluentflowCefrLevel(contentId);
        if (inferred) item.cefrLevel = inferred;
      }
    }
    const ff = computeFluentflowProgressSummary(doc.content);
    doc.summary.completedContent = ff.completedContent;
    doc.summary.totalContent = catalogTotal;
    doc.summary.progressPct = catalogTotal > 0 ? (ff.completedContent / catalogTotal) * 100 : 0;
    doc.cefr = ff.cefr;
    return snapshotRecomputeState(doc, app) !== before;
  }

  if (app === 'hubflow') {
    // Con local-ready, HubFlow es dueño de la proyección (score-keys en vivo).
    // Un recompute cross-app aquí dejaba summary=15 con flags completed=38
    // (promote-only + cloud OR) y DeskFlow/otras pestañas veían el ping-pong.
    if (readHubflowLocalReady()) {
      if (doc.summary.totalContent !== catalogTotal) {
        doc.summary.totalContent = catalogTotal;
        return snapshotRecomputeState(doc, app) !== before;
      }
      return false;
    }
    for (const item of items) {
      enrichHubflowContentEntry(item);
      // Sin local-ready aún: alinear flag con activities (sí puede bajar).
      // No hay publish de HubFlow que corrija, así que el doc debe ser coherente.
      item.completed = isItemActuallyComplete(item);
      if (!item.completed) item.completedAt = null;
    }
    doc.summary = {
      ...doc.summary,
      progressPct: items.length
        ? items.reduce((sum, item) => sum + (item.progressPct || 0), 0) / items.length
        : 0,
      completedContent: resolveHubflowCompletedContent(items, doc.summary?.completedContent),
      totalContent: catalogTotal,
      attemptedContent: items.filter((item) => (item.attempts || 0) > 0).length,
      ...computeHubflowActivitySummary(doc.content),
    };
    return snapshotRecomputeState(doc, app) !== before;
  }

  if (app === 'lyricflow') {
    for (const [contentId, item] of Object.entries(doc.content)) {
      enrichLyricflowSongEntry(contentId, item);
      // Solo promover a completado — LyricFlow publica desde deriveSong en vivo;
      // un recompute cross-app que bajaba flags era ping-pong con DeskFlow/sync.
      if (isLyricflowSongComplete(item)) item.completed = true;
    }
    const activitySummary = computeLyricflowActivitySummary(doc.content, catalogTotal);
    const resolvedActivities = resolveLyricflowCompletedActivities(
      doc.content,
      doc.summary?.completedActivities,
      catalogTotal,
    );
    doc.summary = {
      ...doc.summary,
      progressPct: items.length
        ? items.reduce((sum, item) => sum + (item.progressPct || 0), 0) / items.length
        : 0,
      completedContent: items.filter((item) => item.completed).length,
      totalContent: catalogTotal,
      attemptedContent: items.filter((item) => (item.attempts || 0) > 0).length,
      ...activitySummary,
      completedActivities: resolvedActivities,
    };
    return snapshotRecomputeState(doc, app) !== before;
  }

  return false;
}

/* ═══════════════════════════════════════════════════════
   LearnFlow Progression System — condición combinada entre 3 apps
   docs/to-do/learnflow-progression-system.md
   ═══════════════════════════════════════════════════════ */

/**
 * Desglosa el progreso de HubFlow por nivel CEFR, usando el campo `cefr:`
 * (no `cefrByCategory`): el progreso se registra por módulo completo
 * (contentId = id del módulo en progress-store.js), no por categoría
 * interna, así que esa es la única granularidad que se puede contar.
 * Un nivel sin módulos en el catálogo (hoy: C2) cuenta como 100% —
 * "nivel sin contenido en una app → condición satisfecha por vacío".
 */
function isHubflowModuleCompleteForLevel(item) {
  if (!isRecord(item)) return false;
  // HubFlow publica item.completed desde score-keys en vivo; isItemActuallyComplete
  // solo mira activities del JSON — subcontaba en el widget CEFR (p. ej. 47% vs 50%).
  if (readHubflowLocalReady()) return item.completed === true;
  return isItemActuallyComplete(item);
}

export function computeHubflowLevelSummary(content, levels = HUBFLOW_LEVELS) {
  const byLevel = Object.fromEntries(LEVEL_ORDER.map((level) => [level, { total: 0, completed: 0 }]));
  for (const [moduleId, level] of Object.entries(levels || {})) {
    if (!byLevel[level]) continue;
    byLevel[level].total++;
    if (isHubflowModuleCompleteForLevel(isRecord(content) ? content[moduleId] : null)) {
      byLevel[level].completed++;
    }
  }
  return Object.fromEntries(
    LEVEL_ORDER.map((level) => {
      const { total, completed } = byLevel[level];
      return [level, {
        completedModules: completed,
        totalModules: total,
        progressPct: total > 0 ? (completed / total) * 100 : 100,
      }];
    }),
  );
}

/**
 * Recalcula si una canción está realmente completa desde `activities`, en
 * vez de confiar en `item.completed` — mismo motivo que isItemActuallyComplete
 * para HubFlow, pero con la regla propia de LyricFlow (ver enrichLyricflowSongEntry):
 * las 4 actividades completas, o las 3 "challenges" (dictation/challenge/quiz)
 * sin exigir listen.
 */
function isLyricflowSongActuallyComplete(item) {
  const activities = isRecord(item?.activities) ? item.activities : {};
  if (!Object.keys(activities).length) return Boolean(item?.completed);
  const completedCount = LYRICFLOW_ACTIVITY_IDS.filter((id) => activities[id]?.completed).length;
  const challengesDone = ['dictation', 'challenge', 'quiz'].every((id) => activities[id]?.completed);
  return completedCount === LYRICFLOW_ACTIVITY_IDS.length || challengesDone;
}

function isLyricflowSongCompleteForLevel(item) {
  if (!isRecord(item)) return false;
  if (readLyricflowLocalReady()) return item.completed === true;
  return isLyricflowSongActuallyComplete(item);
}

/**
 * Desglosa el progreso de LyricFlow por nivel CEFR. `levels` ya excluye
 * canciones fuera de la escala CEFR (Dernière Danse, "FR") — ver
 * scripts/generate-level-map.mjs. Un nivel sin canciones cuenta como 100%.
 */
export function computeLyricflowLevelSummary(content, levels = LYRICFLOW_LEVELS) {
  const byLevel = Object.fromEntries(LEVEL_ORDER.map((level) => [level, { total: 0, completed: 0 }]));
  for (const [songId, level] of Object.entries(levels || {})) {
    if (!byLevel[level]) continue;
    byLevel[level].total++;
    if (isLyricflowSongCompleteForLevel(isRecord(content) ? content[songId] : null)) {
      byLevel[level].completed++;
    }
  }
  return Object.fromEntries(
    LEVEL_ORDER.map((level) => {
      const { total, completed } = byLevel[level];
      return [level, {
        completedSongs: completed,
        totalSongs: total,
        progressPct: total > 0 ? (completed / total) * 100 : 100,
      }];
    }),
  );
}

// Lee el documento crudo y lo poda contra el catálogo vigente. La poda importa
// acá aparte de en recomputeProgressDocumentSummary(): esta ruta lee
// localStorage directo, sin pasar por progress-reader ni por el recompute, así
// que sin podar los ids huérfanos que el cloud-merge trae de Supabase entran
// al cálculo de nivel. Distorsionan el gate: un huérfano no completado baja el
// progressPct del nivel y puede bloquear un ascenso legítimo (ej. A2 pasaría de
// 43/55 a 44/59), y uno completado infla el numerador.
function readLocalProgressDoc(app) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`learnflow:progress:${app}:v1`);
    if (!raw) return null;
    const doc = JSON.parse(raw);
    const catalogIds = readCatalogIdsFallback(app);
    if (catalogIds && isRecord(doc?.content)) {
      for (const contentId of Object.keys(doc.content)) {
        if (!catalogIds.has(contentId)) delete doc.content[contentId];
      }
    }
    return doc;
  } catch {
    return null;
  }
}

function readLpLevel() {
  try {
    if (typeof localStorage === 'undefined') return 'a1';
    return localStorage.getItem('lp-level') || 'a1';
  } catch {
    return 'a1';
  }
}

/** Nivel activo actual, con el default 'a1' ya resuelto — para filtrar catálogos en HubFlow/LyricFlow. */
export function getActiveLevel() {
  return readLpLevel();
}

/** `true` si un módulo de nivel `moduleLevel` está desbloqueado cuando el nivel activo es `activeLevel` (mismo nivel o anterior). */
export function levelUnlocks(moduleLevel, activeLevel) {
  const moduleIdx = LEVEL_ORDER.indexOf(moduleLevel);
  const activeIdx = LEVEL_ORDER.indexOf(activeLevel);
  if (moduleIdx === -1 || activeIdx === -1) return true;
  return moduleIdx <= activeIdx;
}

/**
 * Progreso combinado de las 3 apps en el nivel activo — sin decidir ni
 * escribir nada. Lo usa DeskFlow para el widget y checkLevelAdvancement()
 * para decidir el ascenso; separarlos permite mostrar el desglose aunque
 * la condición no se cumpla todavía.
 */
export function getCombinedLevelProgress(level = readLpLevel()) {
  const fluentflowDoc = readLocalProgressDoc('fluentflow');
  const hubflowDoc = readLocalProgressDoc('hubflow');
  const lyricflowDoc = readLocalProgressDoc('lyricflow');

  const upper = level.toUpperCase();
  const fluentflowComputed = computeFluentflowProgressSummary(fluentflowDoc?.content || {});
  const hubflowSummary = computeHubflowLevelSummary(hubflowDoc?.content || {});
  const lyricflowSummary = computeLyricflowLevelSummary(lyricflowDoc?.content || {});

  // FluentFlow estampa cefr en cada publish — preferirlo cuando la app dueña
  // ya publicó, para alinear el widget con la app (mismo criterio que Hub/Lyric).
  const fluentflowLevel = readFluentflowLocalReady() && isRecord(fluentflowDoc?.cefr?.[upper])
    ? fluentflowDoc.cefr[upper]
    : (fluentflowComputed.cefr[upper] ?? { progressPct: 0, completedModules: 0, totalModules: 0 });

  return {
    level,
    fluentflow: fluentflowLevel,
    hubflow: hubflowSummary[level] ?? { progressPct: 0, completedModules: 0, totalModules: 0 },
    lyricflow: lyricflowSummary[level] ?? { progressPct: 0, completedSongs: 0, totalSongs: 0 },
  };
}

/** Regla compartida de avance: FluentFlow ≥100% AND LyricFlow ≥100% AND HubFlow ≥50% del nivel dado. */
function meetsLevelCompletion(progress) {
  return progress.fluentflow.progressPct >= 100 && progress.lyricflow.progressPct >= 100 && progress.hubflow.progressPct >= 50;
}

/**
 * `true` cuando el track CEFR completo terminó: nivel activo es 'c2' (el
 * terminal) y cumple la misma condición que dispara el ascenso en niveles
 * no terminales. Como C2 nunca avanza a un nivel siguiente, esta es la
 * señal de "graduación" — se usa para desbloquear contenido fuera de la
 * escala CEFR (canciones "FR" en LyricFlow).
 */
export function isCefrTrackComplete() {
  const current = readLpLevel();
  if (current !== 'c2') return false;
  return meetsLevelCompletion(getCombinedLevelProgress(current));
}

/**
 * Nivel más alto que el usuario tiene **ganado con trabajo real** — el más alto
 * cuyos niveles anteriores cumplen todos la condición de avance. Se deriva del
 * progreso, no de `lp-level`: un nivel auto-reportado (o confirmado por examen)
 * no cuenta acá, solo el contenido efectivamente completado.
 *
 * Lo usa DeskFlow como piso al reprobar o abandonar el examen de nivel: fallar
 * un intento de B2 nunca puede borrar un B1 que ya se ganó completando módulos
 * (ver el invariante "el nivel nunca baja" en checkLevelAdvancement más abajo).
 */
export function getEarnedLevelFloor() {
  let floor = LEVEL_ORDER[0];
  for (let index = 0; index < LEVEL_ORDER.length - 1; index++) {
    if (!meetsLevelCompletion(getCombinedLevelProgress(LEVEL_ORDER[index]))) break;
    floor = LEVEL_ORDER[index + 1];
  }
  return floor;
}

/**
 * Evalúa si el nivel activo (`lp-level`) debe subir al siguiente y, si
 * corresponde, escribe el nuevo valor en localStorage. No llama a Supabase
 * — el caller decide si persiste (`updateCefrLevel()` en lp-supabase.js),
 * para no acoplar este módulo de cómputo puro a la capa de red.
 *
 * Regla: FluentFlow ≥100% AND LyricFlow ≥100% AND HubFlow ≥50% del nivel
 * activo. C2 es terminal — no se vuelve a evaluar (ver isCefrTrackComplete
 * para detectar la finalización de C2). El nivel nunca baja: si la
 * condición no se cumple, `lp-level` simplemente no avanza (ver
 * docs/to-do/learnflow-progression-system.md § Reset parcial).
 */
export function checkLevelAdvancement() {
  const current = readLpLevel();
  const idx = LEVEL_ORDER.indexOf(current);
  if (idx === -1 || idx === LEVEL_ORDER.length - 1) {
    return { advanced: false, level: current, terminal: idx === LEVEL_ORDER.length - 1 };
  }
  const nextLevel = LEVEL_ORDER[idx + 1];

  const progress = getCombinedLevelProgress(current);
  const breakdown = {
    fluentflow: progress.fluentflow.progressPct,
    hubflow: progress.hubflow.progressPct,
    lyricflow: progress.lyricflow.progressPct,
  };
  const meetsCondition = meetsLevelCompletion(progress);

  if (!meetsCondition) {
    return { advanced: false, level: current, breakdown };
  }

  // Idempotencia: releer lp-level justo antes de escribir, por si otra
  // pestaña/app ya disparó el ascenso mientras se calculaba esto.
  const stillCurrent = readLpLevel();
  if (LEVEL_ORDER.indexOf(stillCurrent) >= LEVEL_ORDER.indexOf(nextLevel)) {
    return { advanced: false, level: stillCurrent, breakdown };
  }

  try {
    localStorage.setItem('lp-level', nextLevel);
  } catch {
    return { advanced: false, level: current, breakdown, error: 'localStorage_unavailable' };
  }
  // 'storage' es nativo y solo llega a OTRAS pestañas; para que la propia
  // pestaña reaccione sin recargar, se dispara un CustomEvent (mismo
  // patrón que lp-cloud-hydrated / lp-guest-reset en este módulo canónico).
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lp-level-changed', { detail: { level: nextLevel, previousLevel: current } }));
  }

  return { advanced: true, level: nextLevel, previousLevel: current, breakdown };
}
