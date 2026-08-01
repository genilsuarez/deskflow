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
  const left = isRecord(existing) ? existing : {};
  const right = isRecord(remote) ? remote : {};
  return {
    ...left,
    ...right,
    completed: Boolean(left.completed) || Boolean(right.completed),
    completedKeys: Math.max(left.completedKeys ?? 0, right.completedKeys ?? 0),
    totalKeys: Math.max(left.totalKeys ?? 0, right.totalKeys ?? 0),
    bestScorePct: mergeNumericMax(left.bestScorePct, right.bestScorePct),
    attempts: Math.max(left.attempts ?? 0, right.attempts ?? 0),
    completedAt: pickLaterIso(left.completedAt, right.completedAt),
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
    practice: {
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

function rederiveHubflowExerciseFromActivities(item) {
  const activityList = Object.values(item.activities || {}).filter(isRecord);
  if (!activityList.length) return;
  const totalKeys = activityList.reduce((sum, activity) => sum + (activity.totalKeys ?? 0), 0);
  const completedKeys = activityList.reduce((sum, activity) => sum + (activity.completedKeys ?? 0), 0);
  const completedActivities = activityList.filter((activity) => activity.completed).length;
  item.progressPct = totalKeys > 0 ? (completedKeys / totalKeys) * 100 : 0;
  item.completed = completedActivities === activityList.length;
  item.attempts = activityList.reduce((sum, activity) => sum + (activity.attempts ?? 0), 0);
  item.bestScorePct = activityList.reduce(
    (best, activity) => mergeNumericMax(best, activity.bestScorePct),
    null,
  );
  const completedAtCandidates = activityList
    .map((activity) => activity.completedAt)
    .filter(Boolean)
    .sort();
  item.completedAt = item.completed ? (completedAtCandidates.at(-1) || item.completedAt || null) : null;
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
    const groupKey = `${event.contentId}\u0000${event.activity}`;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(event);
  }

  let changed = false;
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
    rederiveHubflowExerciseFromActivities(item);
    if (JSON.stringify(item.activities[activityId] ?? null) !== before) changed = true;
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

/** Rebuild summary (and FluentFlow cefr) from raw content after cloud merge. */
export function recomputeProgressDocumentSummary(doc, app) {
  if (!isRecord(doc) || !isRecord(doc.content)) return false;
  doc.summary = isRecord(doc.summary) ? doc.summary : {};
  const before = snapshotRecomputeState(doc, app);
  const items = Object.values(doc.content).filter(isRecord);

  // catalogTotalContent lo estampa la app dueña del catálogo (FluentFlow/
  // HubFlow/LyricFlow) en cada publish propio, fuera de content/summary.
  // El cloud-merge de DeskFlow (downloadApp() en sync-engine.js) solo une
  // content_ids de Supabase sin podar ids huérfanos de catálogos viejos —
  // así que items.length en ese punto puede quedar inflado con contenido
  // que ya no existe. Si está disponible, catalogTotalContent es siempre
  // la fuente de verdad para el total; items.length es el fallback para
  // documentos viejos que todavía no lo tienen.
  const catalogTotal = Number.isInteger(doc.catalogTotalContent) && doc.catalogTotalContent > 0
    ? doc.catalogTotalContent
    : items.length;

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
    for (const item of items) enrichHubflowContentEntry(item);
    doc.summary = {
      ...doc.summary,
      progressPct: items.length
        ? items.reduce((sum, item) => sum + (item.progressPct || 0), 0) / items.length
        : 0,
      completedContent: items.filter((item) => item.completed).length,
      totalContent: catalogTotal,
      attemptedContent: items.filter((item) => (item.attempts || 0) > 0).length,
      ...computeHubflowActivitySummary(doc.content),
    };
    return snapshotRecomputeState(doc, app) !== before;
  }

  if (app === 'lyricflow') {
    for (const [contentId, item] of Object.entries(doc.content)) {
      enrichLyricflowSongEntry(contentId, item);
    }
    doc.summary = {
      ...doc.summary,
      progressPct: items.length
        ? items.reduce((sum, item) => sum + (item.progressPct || 0), 0) / items.length
        : 0,
      completedContent: items.filter((item) => item.completed).length,
      totalContent: catalogTotal,
      attemptedContent: items.filter((item) => (item.attempts || 0) > 0).length,
      ...computeLyricflowActivitySummary(doc.content, catalogTotal),
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
export function computeHubflowLevelSummary(content, levels = HUBFLOW_LEVELS) {
  const byLevel = Object.fromEntries(LEVEL_ORDER.map((level) => [level, { total: 0, completed: 0 }]));
  for (const [moduleId, level] of Object.entries(levels || {})) {
    if (!byLevel[level]) continue;
    byLevel[level].total++;
    if (isRecord(content) && content[moduleId]?.completed === true) byLevel[level].completed++;
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
 * Desglosa el progreso de LyricFlow por nivel CEFR. `levels` ya excluye
 * canciones fuera de la escala CEFR (Dernière Danse, "FR") — ver
 * scripts/generate-level-map.mjs. Un nivel sin canciones cuenta como 100%.
 */
export function computeLyricflowLevelSummary(content, levels = LYRICFLOW_LEVELS) {
  const byLevel = Object.fromEntries(LEVEL_ORDER.map((level) => [level, { total: 0, completed: 0 }]));
  for (const [songId, level] of Object.entries(levels || {})) {
    if (!byLevel[level]) continue;
    byLevel[level].total++;
    if (isRecord(content) && content[songId]?.completed === true) byLevel[level].completed++;
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

function readLocalProgressDoc(app) {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`learnflow:progress:${app}:v1`);
    return raw ? JSON.parse(raw) : null;
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

  const fluentflowSummary = computeFluentflowProgressSummary(fluentflowDoc?.content || {});
  const hubflowSummary = computeHubflowLevelSummary(hubflowDoc?.content || {});
  const lyricflowSummary = computeLyricflowLevelSummary(lyricflowDoc?.content || {});

  const upper = level.toUpperCase();
  return {
    level,
    fluentflow: fluentflowSummary.cefr[upper] ?? { progressPct: 0, completedModules: 0, totalModules: 0 },
    hubflow: hubflowSummary[level] ?? { progressPct: 0, completedModules: 0, totalModules: 0 },
    lyricflow: lyricflowSummary[level] ?? { progressPct: 0, completedSongs: 0, totalSongs: 0 },
  };
}

/**
 * Evalúa si el nivel activo (`lp-level`) debe subir al siguiente y, si
 * corresponde, escribe el nuevo valor en localStorage. No llama a Supabase
 * — el caller decide si persiste (`updateCefrLevel()` en lp-supabase.js),
 * para no acoplar este módulo de cómputo puro a la capa de red.
 *
 * Regla: FluentFlow ≥100% AND LyricFlow ≥100% AND HubFlow ≥50% del nivel
 * activo. C2 es terminal — no se vuelve a evaluar. El nivel nunca baja: si
 * la condición no se cumple, `lp-level` simplemente no avanza (ver
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
  const meetsCondition = breakdown.fluentflow >= 100 && breakdown.lyricflow >= 100 && breakdown.hubflow >= 50;

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
