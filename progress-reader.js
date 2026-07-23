const APPS = Object.freeze(['fluentflow', 'hubflow', 'lyricflow']);
const SCHEMA_VERSION = 1;
const MAX_ACTIVITY_EVENTS = 200;
const LYRICFLOW_ACTIVITY_IDS = Object.freeze(['listen', 'dictation', 'challenge', 'quiz']);

const STATUS = Object.freeze({
  READY: 'ready',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  OUTDATED: 'outdated',
  INVALID: 'invalid'
});

// HubFlow usó :v2 brevemente; la migración a :v1 abandonó los datos sin copiar.
const LEGACY_STORAGE_KEYS = Object.freeze({
  'learnflow:progress:hubflow:v1': 'learnflow:progress:hubflow:v2',
  'learnflow:activity:hubflow:v1': 'learnflow:activity:hubflow:v2',
});

function result(status, data = null, reason = '') {
  return Object.freeze({ status, data, reason });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isPercentage(value) {
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

function isIsoDate(value) {
  if (!isNonEmptyString(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function canonicalIsoDate(value) {
  if (!isNonEmptyString(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Repara fechas Postgres (+00:00, sin ms) que sync-engine.js de LyricFlow/HubFlow
// escribía sin normalizar — progress-reader las rechazaba y el documento entero
// quedaba INVALID ("No se pudo leer el progreso").
function repairStoredDocument(document) {
  if (!isRecord(document)) return false;
  let repaired = false;

  if (isNonEmptyString(document.updatedAt)) {
    const fixed = canonicalIsoDate(document.updatedAt);
    if (fixed && fixed !== document.updatedAt) {
      document.updatedAt = fixed;
      repaired = true;
    }
  }

  if (isRecord(document.content)) {
    for (const item of Object.values(document.content)) {
      if (!isRecord(item) || item.completedAt == null) continue;
      const fixed = canonicalIsoDate(item.completedAt);
      if (fixed && fixed !== item.completedAt) {
        item.completedAt = fixed;
        repaired = true;
      }
    }
  }

  if (Array.isArray(document.events)) {
    for (const event of document.events) {
      if (!isRecord(event) || !isNonEmptyString(event.occurredAt)) continue;
      const fixed = canonicalIsoDate(event.occurredAt);
      if (fixed && fixed !== event.occurredAt) {
        event.occurredAt = fixed;
        repaired = true;
      }
    }
  }

  return repaired;
}

function parseStoredValue(raw) {
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: 'El contenido no es JSON válido.' };
  }
}

function validateVersion(document) {
  if (!isRecord(document)) return result(STATUS.INVALID, null, 'El documento no es un objeto.');
  if (!Number.isInteger(document.schemaVersion)) return result(STATUS.INVALID, null, 'Falta schemaVersion.');
  if (document.schemaVersion !== SCHEMA_VERSION) {
    return result(STATUS.OUTDATED, null, `La versión ${document.schemaVersion} no es compatible con v1.`);
  }
  return null;
}

function normalizeCefr(document, app) {
  if (app !== 'fluentflow') return null;
  const candidate = isRecord(document.cefr) ? document.cefr : document.summary.cefr;
  if (!isRecord(candidate)) return null;

  const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const validStatuses = ['not_started', 'in_progress', 'near_completion', 'completed'];

  if (validLevels.includes(candidate.level) && validStatuses.includes(candidate.status)) {
    if (!isInteger(candidate.completedModules) || !isInteger(candidate.totalModules)) return null;
    if (candidate.completedModules > candidate.totalModules) return null;
    return Object.freeze({
      level: candidate.level,
      status: candidate.status,
      completedModules: candidate.completedModules,
      totalModules: candidate.totalModules
    });
  }

  const levels = [];
  for (const level of validLevels) {
    const entry = candidate[level];
    if (!isRecord(entry)
      || !isPercentage(entry.progressPct)
      || !isInteger(entry.completedModules)
      || !isInteger(entry.totalModules)
      || entry.completedModules > entry.totalModules
      || !validStatuses.includes(entry.status)) return null;
    levels.push(Object.freeze({
      level,
      progressPct: entry.progressPct,
      status: entry.status,
      completedModules: entry.completedModules,
      totalModules: entry.totalModules
    }));
  }

  const activeLevel = levels.find((entry) => entry.status !== 'completed') || levels.at(-1);
  return Object.freeze({
    level: activeLevel.level,
    status: activeLevel.status,
    completedModules: activeLevel.completedModules,
    totalModules: activeLevel.totalModules,
    levels: Object.freeze(levels)
  });
}

function isActivityAttempted(activity) {
  if (!isRecord(activity)) return false;
  if (isInteger(activity.attempts) && activity.attempts > 0) return true;
  if (isInteger(activity.completedKeys) && activity.completedKeys > 0) return true;
  const covered = Number(activity.coveredDurationSec);
  return Number.isFinite(covered) && covered > 0;
}

/** Deriva contadores de actividades desde content crudo (HubFlow: modos/packs por ejercicio). */
export function computeHubflowActivitySummary(content) {
  const items = isRecord(content) ? Object.values(content).filter(isRecord) : [];
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
    if (!itemAttempted && isInteger(item.attempts) && item.attempts > 0) attemptedActivities++;
  }

  return Object.freeze({
    completedActivities,
    totalActivities,
    attemptedActivities,
  });
}

/** Deriva contadores alineados con FluentFlow (solo completados válidos en la ruta CEFR). */
const FLUENTFLOW_LEVELS = Object.freeze(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

function groupFluentflowContentByLevel(content) {
  const byLevel = Object.fromEntries(FLUENTFLOW_LEVELS.map((level) => [level, []]));
  for (const item of Object.values(content)) {
    if (!isRecord(item) || !isNonEmptyString(item.cefrLevel)) continue;
    const level = item.cefrLevel.toUpperCase();
    if (byLevel[level]) byLevel[level].push(item);
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

  const totalContent = Object.values(content).filter(isRecord).length;
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

  return Object.freeze({
    completedContent,
    totalContent,
    progressPct: totalContent > 0 ? (completedContent / totalContent) * 100 : 0,
    cefr,
  });
}

/** Rebuild summary (and FluentFlow cefr) from raw content — used after cloud download merge. */
export function recomputeProgressDocumentSummary(doc, app) {
  if (!isRecord(doc) || !isRecord(doc.content)) return false;
  doc.summary = isRecord(doc.summary) ? doc.summary : {};

  if (app === 'fluentflow') {
    const ff = computeFluentflowProgressSummary(doc.content);
    doc.summary.completedContent = ff.completedContent;
    doc.summary.totalContent = ff.totalContent;
    doc.summary.progressPct = ff.progressPct;
    doc.cefr = ff.cefr;
    return true;
  }

  const items = Object.values(doc.content).filter(isRecord);
  if (app === 'hubflow') {
    const activities = computeHubflowActivitySummary(doc.content);
    doc.summary = {
      ...doc.summary,
      progressPct: items.length
        ? items.reduce((sum, item) => sum + (item.progressPct || 0), 0) / items.length
        : 0,
      completedContent: items.filter((item) => item.completed).length,
      totalContent: items.length,
      attemptedContent: items.filter((item) => (item.attempts || 0) > 0).length,
      ...activities,
    };
    return true;
  }

  if (app === 'lyricflow') {
    const catalogTotal = isInteger(doc.summary.totalContent) && doc.summary.totalContent > 0
      ? doc.summary.totalContent
      : items.length;
    const activities = computeLyricflowActivitySummary(doc.content, catalogTotal);
    doc.summary = {
      ...doc.summary,
      progressPct: items.length
        ? items.reduce((sum, item) => sum + (item.progressPct || 0), 0) / items.length
        : 0,
      completedContent: items.filter((item) => item.completed).length,
      totalContent: catalogTotal,
      attemptedContent: items.filter((item) => (item.attempts || 0) > 0).length,
      ...activities,
    };
    return true;
  }

  return false;
}

/** Deriva contadores de actividades desde content crudo (LyricFlow guarda 4 por canción). */
export function computeLyricflowActivitySummary(content, totalSongs = null) {
  const songs = isRecord(content) ? Object.values(content).filter(isRecord) : [];
  const songCount = isInteger(totalSongs) ? totalSongs : songs.length;
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

  return Object.freeze({
    completedActivities,
    totalActivities: songCount * LYRICFLOW_ACTIVITY_IDS.length,
    attemptedActivities,
  });
}

function repairContentEntry(contentId, item, app) {
  if (!isRecord(item)) return null;
  let repaired = false;

  if (!isNonEmptyString(item.contentId) || item.contentId !== contentId) {
    item.contentId = contentId;
    repaired = true;
  }
  if (!isNonEmptyString(item.contentType)) {
    item.contentType = app === 'lyricflow' ? 'song' : 'exercise';
    repaired = true;
  }
  if (!Number.isFinite(item.progressPct) || item.progressPct < 0 || item.progressPct > 100) {
    const pct = Number(item.progressPct);
    item.progressPct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
    repaired = true;
  }
  if (typeof item.completed !== 'boolean') {
    item.completed = Boolean(item.completed);
    repaired = true;
  }
  if (item.completedAt != null && !isIsoDate(item.completedAt)) {
    item.completedAt = canonicalIsoDate(item.completedAt);
    repaired = true;
  }
  if (item.bestScorePct != null && !isPercentage(item.bestScorePct)) {
    const score = Number(item.bestScorePct);
    item.bestScorePct = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : null;
    repaired = true;
  }
  if (!isInteger(item.attempts)) {
    item.attempts = Math.max(0, Math.round(Number(item.attempts) || 0));
    repaired = true;
  }

  return repaired ? item : item;
}

function repairProgressDocument(document, app) {
  if (!isRecord(document) || !isRecord(document.summary) || !isRecord(document.content)) return false;
  let repaired = false;

  if (isNonEmptyString(document.updatedAt)) {
    const fixed = canonicalIsoDate(document.updatedAt);
    if (fixed && fixed !== document.updatedAt) {
      document.updatedAt = fixed;
      repaired = true;
    }
  }

  const sanitized = {};
  for (const [contentId, item] of Object.entries(document.content)) {
    const repairedItem = repairContentEntry(contentId, item, app);
    if (!repairedItem || !isValidContentEntry(contentId, repairedItem)) continue;
    sanitized[contentId] = repairedItem;
    if (repairedItem !== item) repaired = true;
  }

  if (Object.keys(sanitized).length !== Object.keys(document.content).length) {
    document.content = sanitized;
    repaired = true;
  }

  const contentCount = Object.keys(document.content).length;
  const summary = document.summary;

  if (contentCount > 0 && summary.totalContent !== contentCount) {
    summary.totalContent = contentCount;
    repaired = true;
  }
  if (summary.completedContent > summary.totalContent) {
    summary.completedContent = summary.totalContent;
    repaired = true;
  }
  if (summary.attemptedContent > summary.totalContent) {
    summary.attemptedContent = summary.totalContent;
    repaired = true;
  }
  if (!isPercentage(summary.progressPct)) {
    summary.progressPct = 0;
    repaired = true;
  }

  return repaired;
}

function normalizeLastContent(summary) {
  if (!isRecord(summary.lastContent) || !isNonEmptyString(summary.lastContent.contentId)) return null;
  const item = summary.lastContent;
  const occurredAt = isIsoDate(item.occurredAt) ? item.occurredAt : null;
  const progressPct = isPercentage(item.progressPct) ? item.progressPct : null;
  const scorePct = isPercentage(item.scorePct) ? item.scorePct : null;

  return Object.freeze({
    contentId: item.contentId,
    title: isNonEmptyString(item.title) ? item.title : item.contentId,
    activity: isNonEmptyString(item.activity) ? item.activity : null,
    occurredAt,
    progressPct,
    scorePct
  });
}

function isValidContentEntry(contentId, item) {
  return isRecord(item)
    && item.contentId === contentId
    && isNonEmptyString(item.contentType)
    && isPercentage(item.progressPct)
    && typeof item.completed === 'boolean'
    && (item.completedAt === null || isIsoDate(item.completedAt))
    && (item.bestScorePct === null || isPercentage(item.bestScorePct))
    && isInteger(item.attempts);
}

function validateProgress(document, app) {
  const versionError = validateVersion(document);
  if (versionError) return versionError;
  if (document.app !== app) return result(STATUS.INVALID, null, 'La aplicación no coincide con la clave.');
  if (!isIsoDate(document.updatedAt)) return result(STATUS.INVALID, null, 'updatedAt debe ser una fecha ISO UTC.');
  if (!isRecord(document.summary)) return result(STATUS.INVALID, null, 'Falta el resumen de progreso.');
  if (!isRecord(document.content)) return result(STATUS.INVALID, null, 'content debe ser un objeto.');

  repairProgressDocument(document, app);

  const summary = document.summary;
  const fieldsAreValid = isPercentage(summary.progressPct)
    && isInteger(summary.completedContent)
    && isInteger(summary.totalContent)
    && isInteger(summary.attemptedContent)
    && summary.completedContent <= summary.totalContent
    && summary.attemptedContent <= summary.totalContent;

  if (!fieldsAreValid) return result(STATUS.INVALID, null, 'El resumen contiene valores fuera de rango.');

  const contentEntries = Object.entries(document.content);
  if (!contentEntries.every(([contentId, item]) => isValidContentEntry(contentId, item))) {
    return result(STATUS.INVALID, null, 'content contiene campos inválidos.');
  }

  const normalizedContent = Object.freeze(Object.fromEntries(
    contentEntries.map(([contentId, item]) => [
      contentId,
      Object.freeze({
        title: isNonEmptyString(item.title) ? item.title : null,
      }),
    ]),
  ));

  const lyricflowActivities = app === 'lyricflow'
    ? computeLyricflowActivitySummary(document.content, summary.totalContent)
    : null;
  const hubflowActivities = app === 'hubflow'
    ? computeHubflowActivitySummary(document.content)
    : null;
  const fluentflowSummary = app === 'fluentflow'
    ? computeFluentflowProgressSummary(document.content)
    : null;
  const activitySummary = lyricflowActivities || hubflowActivities;

  const summaryCompleted = fluentflowSummary?.completedContent ?? summary.completedContent;
  const summaryTotal = fluentflowSummary?.totalContent ?? summary.totalContent;
  const summaryProgressPct = fluentflowSummary?.progressPct ?? summary.progressPct;
  const summaryCefr = fluentflowSummary
    ? normalizeCefr({ cefr: fluentflowSummary.cefr, summary: {} }, app)
    : normalizeCefr(document, app);

  const data = Object.freeze({
    app,
    updatedAt: document.updatedAt,
    catalogVersion: isNonEmptyString(document.catalogVersion) ? document.catalogVersion : null,
    summary: Object.freeze({
      progressPct: summaryProgressPct,
      completedContent: summaryCompleted,
      totalContent: summaryTotal,
      attemptedContent: summary.attemptedContent,
      completedActivities: activitySummary?.completedActivities
        ?? (isInteger(summary.completedActivities) ? summary.completedActivities : null),
      totalActivities: activitySummary?.totalActivities
        ?? (isInteger(summary.totalActivities) ? summary.totalActivities : null),
      attemptedActivities: activitySummary?.attemptedActivities
        ?? (isInteger(summary.attemptedActivities) ? summary.attemptedActivities : null),
      lastContent: normalizeLastContent(summary)
    }),
    content: normalizedContent,
    cefr: summaryCefr
  });

  const isEmpty = summary.attemptedContent === 0
    && summaryCompleted === 0
    && summaryProgressPct === 0;
  return result(isEmpty ? STATUS.EMPTY : STATUS.READY, data);
}

function normalizeEvent(event, app) {
  if (!isRecord(event)) return null;
  const requiredStrings = ['eventId', 'runId', 'contentId', 'activity', 'eventType'];
  if (!requiredStrings.every((field) => isNonEmptyString(event[field]))) return null;
  if (event.app !== undefined && event.app !== app) return null;
  if (!isIsoDate(event.occurredAt)) return null;
  if (event.scorePct !== undefined && event.scorePct !== null && !isPercentage(event.scorePct)) return null;
  if (event.passed !== undefined && typeof event.passed !== 'boolean') return null;
  if (event.durationMs !== undefined
    && event.durationMs !== null
    && (!Number.isFinite(event.durationMs) || event.durationMs < 0)) return null;

  return Object.freeze({
    eventId: event.eventId,
    runId: event.runId,
    app,
    contentId: event.contentId,
    title: isNonEmptyString(event.title) ? event.title : event.contentId,
    activity: event.activity,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    scorePct: event.scorePct ?? null,
    passed: event.passed ?? null,
    durationMs: event.durationMs ?? null
  });
}

function validateActivity(document, app) {
  const versionError = validateVersion(document);
  if (versionError) return versionError;
  if (document.app !== app) return result(STATUS.INVALID, null, 'La aplicación no coincide con la clave.');
  if (!isIsoDate(document.updatedAt)) return result(STATUS.INVALID, null, 'updatedAt debe ser una fecha ISO UTC.');
  if (!Array.isArray(document.events)) return result(STATUS.INVALID, null, 'events debe ser una lista.');

  const events = document.events
    .slice(0, MAX_ACTIVITY_EVENTS)
    .map((event) => normalizeEvent(event, app))
    .filter((event) => event !== null);
  events.sort((first, second) => second.occurredAt.localeCompare(first.occurredAt));

  const data = Object.freeze({ app, updatedAt: document.updatedAt, events: Object.freeze(events) });
  return result(events.length === 0 ? STATUS.EMPTY : STATUS.READY, data);
}

function emptyProgressResult(app) {
  const timestamp = new Date().toISOString();
  const data = Object.freeze({
    app,
    updatedAt: timestamp,
    catalogVersion: null,
    summary: Object.freeze({
      progressPct: 0,
      completedContent: 0,
      totalContent: 0,
      attemptedContent: 0,
      completedActivities: null,
      totalActivities: null,
      attemptedActivities: null,
      lastContent: null,
    }),
    content: Object.freeze({}),
    cefr: null,
  });
  return result(STATUS.EMPTY, data);
}

function emptyActivityResult(app) {
  const data = Object.freeze({
    app,
    updatedAt: new Date().toISOString(),
    events: Object.freeze([]),
  });
  return result(STATUS.EMPTY, data);
}

export class ProgressReader {
  constructor(storage = window.localStorage) {
    this.storage = storage;
  }

  readApp(app) {
    if (!APPS.includes(app)) throw new TypeError(`Aplicación no admitida: ${app}`);
    return Object.freeze({
      app,
      progress: this.#readKey(`learnflow:progress:${app}:v1`, (document) => validateProgress(document, app)),
      activity: this.#readKey(`learnflow:activity:${app}:v1`, (document) => validateActivity(document, app))
    });
  }

  readAll() {
    return Object.freeze(APPS.map((app) => this.readApp(app)));
  }

  #readKey(key, validator) {
    let raw;
    try {
      raw = this.storage.getItem(key);
    } catch {
      return result(STATUS.UNAVAILABLE, null, 'El almacenamiento local no está accesible.');
    }

    if (raw === null) {
      const legacyKey = LEGACY_STORAGE_KEYS[key];
      if (legacyKey) {
        raw = this.storage.getItem(legacyKey);
        if (raw !== null) {
          try {
            this.storage.setItem(key, raw);
          } catch {
            /* lectura sigue con el valor legacy */
          }
        }
      }
    }

    if (raw === null) {
      return key.startsWith('learnflow:progress:')
        ? emptyProgressResult(key.split(':')[2])
        : emptyActivityResult(key.split(':')[2]);
    }
    const parsed = parseStoredValue(raw);
    if (parsed.error) return result(STATUS.INVALID, null, parsed.error);
    if (repairStoredDocument(parsed.value) || repairProgressDocument(parsed.value, key.split(':')[2])) {
      try {
        this.storage.setItem(key, JSON.stringify(parsed.value));
      } catch {
        /* lectura sigue con el documento reparado en memoria */
      }
    }
    return validator(parsed.value);
  }
}

export { APPS, STATUS };
