// Canonical progress summary helpers — copy to DeskFlow/, HubFlow/js/, LyricFlow/.
// DeskFlow imports this module directly; keep all copies in sync (no build step).

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
    doc.summary.totalContent = ff.totalContent;
    doc.summary.progressPct = ff.progressPct;
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
      totalContent: items.length,
      attemptedContent: items.filter((item) => (item.attempts || 0) > 0).length,
      ...computeHubflowActivitySummary(doc.content),
    };
    return snapshotRecomputeState(doc, app) !== before;
  }

  if (app === 'lyricflow') {
    for (const [contentId, item] of Object.entries(doc.content)) {
      enrichLyricflowSongEntry(contentId, item);
    }
    const catalogTotal = Number.isInteger(doc.summary.totalContent) && doc.summary.totalContent > 0
      ? doc.summary.totalContent
      : items.length;
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
