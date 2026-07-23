// sync-engine.js — Sincroniza el progreso local (localStorage) de FluentFlow,
// HubFlow y LyricFlow con Supabase cuando el usuario está autenticado. DeskFlow
// actúa como coordinador porque es el único punto donde las 3 apps conviven en
// un mismo origin.
//
// Sube en cada lección completada (debounced, ver sync-hooks en cada app).
// Descarga UNA vez al autenticarse, para poblar el caché local en un
// dispositivo nuevo — no hay polling.
//
// Nota de alcance: el merge de descarga escribe en learnflow:progress:{app}:v1,
// que es la fuente de verdad real para LyricFlow. Para HubFlow y FluentFlow esa
// clave es una vista DERIVADA (HubFlow la recalcula desde sus score-history keys
// en cada carga; FluentFlow la deriva de su store de Zustand) — el merge aquí
// deja el portal de DeskFlow mostrando los datos correctos, pero no reconstruye
// el estado interno de esas dos apps por sí solo. FluentFlow soluciona esto en
// su propio syncEngine.ts, mezclando directo en su store. HubFlow queda
// pendiente: reconstruir sus score-history keys individuales desde progress
// remoto requeriría mapear cada scoreKey por módulo, fuera de alcance por ahora.

import * as lpSupabase from './lp-supabase.js';
import { computeHubflowActivitySummary, computeLyricflowActivitySummary } from './progress-reader.js';

const APPS = ['fluentflow', 'hubflow', 'lyricflow'];
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ACTIVITY_EVENTS = 200;

let lastSyncAt = 0;
let syncing = false;
let downloaded = false;

function readRaw(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function emptyProgressDoc(app) {
  return {
    schemaVersion: 1,
    app,
    updatedAt: new Date().toISOString(),
    catalogVersion: null,
    summary: { progressPct: 0, completedContent: 0, totalContent: 0, attemptedContent: 0 },
    content: {},
  };
}

// Postgres/PostgREST devuelve timestamptz como "2026-07-16T00:00:00+00:00"
// (sin milisegundos, offset en vez de "Z"). progress-reader.js exige match
// exacto con Date#toISOString() para aceptar una fecha — sin normalizar,
// CUALQUIER entrada con completedAt remoto invalida todo el documento.
function normalizeIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Combina una fila remota con la entrada local existente sin retroceder
// progreso ya alcanzado (favorece completado=true, mejor puntaje, más intentos).
function mergeContentEntry(existing, row) {
  return {
    contentId: row.content_id,
    contentType: row.content_type || existing?.contentType || 'module',
    progressPct: Math.max(row.progress_pct ?? 0, existing?.progressPct ?? 0),
    completed: Boolean(row.completed) || Boolean(existing?.completed),
    completedAt: normalizeIsoDate(row.completed_at) || existing?.completedAt || null,
    bestScorePct:
      row.best_score_pct != null || existing?.bestScorePct != null
        ? Math.max(row.best_score_pct ?? 0, existing?.bestScorePct ?? 0)
        : null,
    lastScorePct: row.last_score_pct ?? existing?.lastScorePct ?? null,
    attempts: Math.max(row.attempts ?? 0, existing?.attempts ?? 0),
    activities: existing?.activities || row.activities || {},
  };
}

async function downloadApp(app) {
  const remoteRows = await lpSupabase.fetchProgress(app);
  if (remoteRows === null) return { downloaded: false, reason: 'fetch_error' };
  if (!remoteRows.length) return { downloaded: false, reason: 'no_remote_data' };

  const key = `learnflow:progress:${app}:v1`;
  const doc = readRaw(key) || emptyProgressDoc(app);
  doc.content = doc.content || {};

  let changed = false;
  for (const row of remoteRows) {
    const existing = doc.content[row.content_id];
    const merged = mergeContentEntry(existing, row);
    if (
      !existing ||
      merged.completed !== existing.completed ||
      merged.bestScorePct !== existing.bestScorePct ||
      merged.attempts !== existing.attempts
    ) {
      doc.content[row.content_id] = merged;
      changed = true;
    }
  }

  if (changed) {
    const items = Object.values(doc.content);
    const baseSummary = {
      progressPct: items.length
        ? items.reduce((sum, item) => sum + item.progressPct, 0) / items.length
        : 0,
      completedContent: items.filter((item) => item.completed).length,
      totalContent: items.length,
      attemptedContent: items.filter((item) => item.attempts > 0).length,
    };
    doc.summary = app === 'lyricflow'
      ? { ...baseSummary, ...computeLyricflowActivitySummary(doc.content, items.length) }
      : app === 'hubflow'
        ? { ...baseSummary, ...computeHubflowActivitySummary(doc.content) }
        : baseSummary;
    doc.updatedAt = new Date().toISOString();
    writeRaw(key, doc);
  }

  return { downloaded: changed, count: remoteRows.length };
}

function emptyActivityDoc(app) {
  return {
    schemaVersion: 1,
    app,
    updatedAt: new Date().toISOString(),
    events: [],
  };
}

function rowToActivityEvent(row, app) {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    app: row.app || app,
    contentId: row.content_id,
    title: row.title || row.content_id,
    activity: row.activity,
    eventType: row.event_type || 'attempt_completed',
    occurredAt: normalizeIsoDate(row.occurred_at),
    scorePct: row.score_pct ?? null,
    passed: row.passed ?? null,
    durationMs: row.duration_ms ?? null,
    metrics: row.metrics || {},
  };
}

function mergeActivityEvents(localEvents, remoteRows, app) {
  const byId = new Map();
  for (const event of localEvents || []) {
    if (event?.eventId && event?.occurredAt) byId.set(event.eventId, event);
  }
  for (const row of remoteRows) {
    const event = rowToActivityEvent(row, app);
    if (!event?.eventId || !event.occurredAt || byId.has(event.eventId)) continue;
    byId.set(event.eventId, event);
  }
  return [...byId.values()]
    .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt))
    .slice(0, MAX_ACTIVITY_EVENTS);
}

async function downloadActivityApp(app) {
  const remoteRows = await lpSupabase.fetchActivityEvents(app);
  if (remoteRows === null) return { downloaded: false, reason: 'fetch_error' };
  if (!remoteRows.length) return { downloaded: false, reason: 'no_remote_data' };

  const key = `learnflow:activity:${app}:v1`;
  const doc = readRaw(key) || emptyActivityDoc(app);
  const merged = mergeActivityEvents(doc.events, remoteRows, app);
  const unchanged =
    merged.length === (doc.events?.length || 0) &&
    merged.every((event, index) => event.eventId === doc.events?.[index]?.eventId);
  if (unchanged) return { downloaded: false, reason: 'unchanged', count: remoteRows.length };

  doc.events = merged;
  doc.updatedAt = new Date().toISOString();
  writeRaw(key, doc);
  return { downloaded: true, count: remoteRows.length };
}

// Se llama una sola vez por sesión, justo después de autenticarse.
export function resetDownloadState() {
  downloaded = false;
}

export async function downloadOnLogin() {
  if (downloaded) return { downloaded: false, reason: 'already_downloaded_this_session' };

  const authed = await lpSupabase.isAuthenticated();
  if (!authed) return { downloaded: false, reason: 'not_authenticated' };

  const perApp = {};
  let hadFetchError = false;
  let anyChanged = false;
  for (const app of APPS) {
    const progress = await downloadApp(app);
    const activity = await downloadActivityApp(app);
    perApp[app] = { progress, activity };
    if (progress.reason === 'fetch_error' || activity.reason === 'fetch_error') hadFetchError = true;
    if (progress.downloaded || activity.downloaded) anyChanged = true;
  }

  if (!hadFetchError) downloaded = true;
  return { downloaded: anyChanged, perApp };
}

async function syncApp(app) {
  const progressDoc = readRaw(`learnflow:progress:${app}:v1`);
  const activityDoc = readRaw(`learnflow:activity:${app}:v1`);

  const results = {};

  if (progressDoc && progressDoc.content && Object.keys(progressDoc.content).length) {
    results.progress = await lpSupabase.syncProgress(app, { content: progressDoc.content });
  }
  if (activityDoc && Array.isArray(activityDoc.events) && activityDoc.events.length) {
    results.activity = await lpSupabase.syncActivityEvents(app, activityDoc.events);
  }

  return results;
}

export async function runFullSync({ force = false } = {}) {
  if (syncing) return { synced: false, reason: 'already_syncing' };
  if (!force && Date.now() - lastSyncAt < SYNC_INTERVAL_MS) {
    return { synced: false, reason: 'too_soon' };
  }

  const authed = await lpSupabase.isAuthenticated();
  if (!authed) return { synced: false, reason: 'not_authenticated' };

  syncing = true;
  try {
    const perApp = {};
    for (const app of APPS) {
      perApp[app] = await syncApp(app);
    }
    lastSyncAt = Date.now();
    return { synced: true, perApp };
  } finally {
    syncing = false;
  }
}
