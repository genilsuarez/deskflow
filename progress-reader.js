const APPS = Object.freeze(['fluentflow', 'hubflow', 'lyricflow']);
const SCHEMA_VERSION = 1;
const MAX_ACTIVITY_EVENTS = 200;

const STATUS = Object.freeze({
  READY: 'ready',
  EMPTY: 'empty',
  UNAVAILABLE: 'unavailable',
  OUTDATED: 'outdated',
  INVALID: 'invalid'
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

  const summary = document.summary;
  const fieldsAreValid = isPercentage(summary.progressPct)
    && isInteger(summary.completedContent)
    && isInteger(summary.totalContent)
    && isInteger(summary.attemptedContent)
    && summary.completedContent <= summary.totalContent
    && summary.attemptedContent <= summary.totalContent;

  if (!fieldsAreValid) return result(STATUS.INVALID, null, 'El resumen contiene valores fuera de rango.');
  if (!isRecord(document.content)) return result(STATUS.INVALID, null, 'content debe ser un objeto.');

  const contentEntries = Object.entries(document.content);
  if (contentEntries.length < summary.totalContent
    || !contentEntries.every(([contentId, item]) => isValidContentEntry(contentId, item))) {
    return result(STATUS.INVALID, null, 'content no coincide con el resumen o contiene campos inválidos.');
  }

  const data = Object.freeze({
    app,
    updatedAt: document.updatedAt,
    catalogVersion: isNonEmptyString(document.catalogVersion) ? document.catalogVersion : null,
    summary: Object.freeze({
      progressPct: summary.progressPct,
      completedContent: summary.completedContent,
      totalContent: summary.totalContent,
      attemptedContent: summary.attemptedContent,
      completedActivities: isInteger(summary.completedActivities) ? summary.completedActivities : null,
      totalActivities: isInteger(summary.totalActivities) ? summary.totalActivities : null,
      lastContent: normalizeLastContent(summary)
    }),
    cefr: normalizeCefr(document, app)
  });

  const isEmpty = summary.attemptedContent === 0
    && summary.completedContent === 0
    && summary.progressPct === 0;
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
    .map((event) => normalizeEvent(event, app));
  if (events.some((event) => event === null)) {
    return result(STATUS.INVALID, null, 'Hay eventos con campos esenciales inválidos.');
  }
  events.sort((first, second) => second.occurredAt.localeCompare(first.occurredAt));

  const data = Object.freeze({ app, updatedAt: document.updatedAt, events: Object.freeze(events) });
  return result(events.length === 0 ? STATUS.EMPTY : STATUS.READY, data);
}

export class ProgressReader {
  constructor(storage = window.localStorage) {
    this.storage = storage;
  }

  readApp(app) {
    if (!APPS.includes(app)) throw new TypeError(`Aplicación no admitida: ${app}`);
    const version = app === 'hubflow' ? 'v2' : 'v1';
    return Object.freeze({
      app,
      progress: this.#readKey(`learnflow:progress:${app}:${version}`, (document) => validateProgress(document, app)),
      activity: this.#readKey(`learnflow:activity:${app}:${version}`, (document) => validateActivity(document, app))
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

    if (raw === null) return result(STATUS.UNAVAILABLE, null, 'La proyección todavía no existe.');
    const parsed = parseStoredValue(raw);
    if (parsed.error) return result(STATUS.INVALID, null, parsed.error);
    return validator(parsed.value);
  }
}

export { APPS, STATUS };
