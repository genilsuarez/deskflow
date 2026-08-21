// @ts-check
// sync-engine.js — Sincroniza el progreso local (localStorage) de FluentFlow,
// HubFlow y LyricFlow con Supabase cuando el usuario está autenticado. DeskFlow
// actúa como coordinador porque es el único punto donde las 3 apps conviven en
// un mismo origin.
//
// Modelo multi-sesión (best practices):
// 1. Descarga al autenticarse + refresco al volver a la pestaña (visibility/focus)
// 2. Pull-merge-push antes de cada upload (merge-by-max local)
// 3. Upload vía RPC upsert_progress_merge (merge monotónico en servidor)
// 4. BroadcastChannel entre tabs del mismo origen
// 5. activity_events append-only (ignoreDuplicates)
//
// Nota: el merge de descarga escribe en learnflow:progress:{app}:v1.
// LyricFlow la usa como fuente de verdad. HubFlow reconstruye score-history via
// hydrateHubFlowFromCloud(); FluentFlow importa la proyección en syncEngine.ts.

import * as lpSupabase from './lp-supabase.js';
import {
  applyHubflowActivityEvents,
  applyLyricflowActivityEvents,
  applyProgressInvalidations,
  contentEntryMergeChanged,
  inferFluentflowCefrLevel,
  mergeHubflowActivities,
  mergeLyricflowActivities,
  pruneActivityEventsToCatalog,
  recomputeProgressDocumentSummary,
} from './lp-progress-summary.js';

const APPS = ['fluentflow', 'hubflow', 'lyricflow'];
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ACTIVITY_EVENTS = 200;
const VISIBILITY_REFRESH_MIN_MS = 12_000;
const SYNC_CHANNEL_NAME = 'lp-sync';
const SYNC_REVISION_KEY = 'lp-sync-revision';
const REVISION_POLL_MS = 25_000;

let lastSyncAt = 0;
let syncing = false;
let downloaded = false;
let cloudHydrated = false;
let lastVisibilityRefreshAt = 0;
let multiSessionSetup = false;
let syncChannel = null;
let refreshingFromCloud = false;
let revisionPollTimer = null;
let downloadInFlight = null;

const SESSION_FETCH_RETRY_MS = [150, 350, 600];
const CLOUD_FETCH_TIMEOUT_MS = 8_000;
const DOWNLOAD_LOGIN_TIMEOUT_MS = 25_000;
const FULL_SYNC_TIMEOUT_MS = 25_000;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}_timeout`));
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

const STATS_DEFERRAL_TIMEOUT_MS = 3000;
let statsDisplayReady = !hasStoredSupabaseSession() || hasLocalStatsCache();
let statsDeferralTimer = null;
let statsRevealPending = false;
/** Activity ledger fetched from Supabase once per browser session (per app). */
const activityFetchedThisSession = new Set();
/** In-flight activity downloads — dedupe parallel hydrate + downloadOnLogin. */
const activityFetchInFlight = new Map();

function activityFetchedStorageKey(app) {
  return `lp-activity-fetched:${app}`;
}

function wasActivityFetched(app) {
  if (activityFetchedThisSession.has(app)) return true;
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return sessionStorage.getItem(activityFetchedStorageKey(app)) === '1';
  } catch {
    return false;
  }
}

function markActivityFetched(app) {
  activityFetchedThisSession.add(app);
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(activityFetchedStorageKey(app), '1');
  } catch {
    /* noop */
  }
}

function clearActivityFetched(app) {
  activityFetchedThisSession.delete(app);
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(activityFetchedStorageKey(app));
  } catch {
    /* noop */
  }
}

function clearActivityFetchedFlags() {
  activityFetchedThisSession.clear();
  if (typeof sessionStorage === 'undefined') return;
  try {
    for (const app of APPS) {
      sessionStorage.removeItem(activityFetchedStorageKey(app));
    }
  } catch {
    /* noop */
  }
}

const ACTIVITY_UPLOAD_CURSOR_MAX = 600;

function activityUploadCursorKey(app) {
  return `lp-activity-uploaded-ids:${app}:v1`;
}

function readUploadedActivityIds(app) {
  const doc = readRaw(activityUploadCursorKey(app));
  if (!doc?.ids || !Array.isArray(doc.ids)) return new Set();
  return new Set(doc.ids.filter(Boolean));
}

function noteActivityEventsUploaded(app, eventIds) {
  const incoming = (eventIds || []).filter(Boolean);
  if (!incoming.length) return;
  const set = readUploadedActivityIds(app);
  for (const id of incoming) set.add(id);
  const ids = [...set];
  const trimmed = ids.length > ACTIVITY_UPLOAD_CURSOR_MAX
    ? ids.slice(ids.length - ACTIVITY_UPLOAD_CURSOR_MAX)
    : ids;
  writeRaw(activityUploadCursorKey(app), {
    schemaVersion: 1,
    app,
    ids: trimmed,
    updatedAt: new Date().toISOString(),
  });
}

function clearActivityUploadCursors() {
  for (const app of APPS) {
    try {
      localStorage.removeItem(activityUploadCursorKey(app));
    } catch {
      /* noop */
    }
  }
}

function notifyActivityReady(app) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('lp-activity-ready', { detail: { app } }));
}

function hasStoredSupabaseSession() {
  if (typeof localStorage === 'undefined') return false;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!/^sb-.+-auth-token$/.test(key || '')) continue;
      const parsed = JSON.parse(localStorage.getItem(key) || 'null');
      if (parsed?.access_token || parsed?.currentSession?.access_token) return true;
    }
  } catch {
    /* noop */
  }
  return false;
}

function setStatsSyncingAttribute(syncing) {
  if (typeof document === 'undefined') return;
  if (syncing) document.documentElement.dataset.statsSyncing = 'true';
  else document.documentElement.removeAttribute('data-stats-syncing');
}

function scheduleStatsDeferralTimeout() {
  if (statsDeferralTimer || typeof window === 'undefined') return;
  statsDeferralTimer = window.setTimeout(() => {
    statsDeferralTimer = null;
    markStatsDisplayReady();
  }, STATS_DEFERRAL_TIMEOUT_MS);
}

function beginStatsDeferral() {
  if (!hasStoredSupabaseSession()) return;
  if (hasLocalStatsCache()) {
    statsDisplayReady = true;
    setStatsSyncingAttribute(false);
    return;
  }
  statsDisplayReady = false;
  setStatsSyncingAttribute(true);
  if (statsDeferralTimer) {
    clearTimeout(statsDeferralTimer);
    statsDeferralTimer = null;
  }
  scheduleStatsDeferralTimeout();
}

function hasLocalProgressDoc(app) {
  if (!APPS.includes(app)) return false;
  const doc = readRaw(`learnflow:progress:${app}:v1`);
  return Boolean(doc?.content && Object.keys(doc.content).length > 0);
}

/** HubFlow sets this when score/projection data is published to localStorage. */
export const HUBFLOW_LOCAL_READY_KEY = 'learnflow:hubflow:local-ready:v1';
/** LyricFlow sets this when progress is published to localStorage. */
export const LYRICFLOW_LOCAL_READY_KEY = 'learnflow:lyricflow:local-ready:v1';
/** FluentFlow sets this when publishLearnFlowIntegration runs. */
export const FLUENTFLOW_LOCAL_READY_KEY = 'learnflow:fluentflow:local-ready:v1';

function hasHubflowLocalReadyFlag() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(HUBFLOW_LOCAL_READY_KEY) === '1';
  } catch {
    return false;
  }
}

function hasLyricflowLocalReadyFlag() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(LYRICFLOW_LOCAL_READY_KEY) === '1';
  } catch {
    return false;
  }
}

function hasFluentflowLocalReadyFlag() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(FLUENTFLOW_LOCAL_READY_KEY) === '1';
  } catch {
    return false;
  }
}

/** True when progress or activity is already in localStorage (skip Supabase wait). */
export function hasLocalStatsCache() {
  return hasHubflowLocalReadyFlag()
    || APPS.some((app) => hasLocalProgressDoc(app) || hasLocalActivityLedger(app));
}

/** Unblock stats UI + sync when localStorage already holds progress (skip cloud wait). */
export function markLocalCacheBootstrapped() {
  if (!hasStoredSupabaseSession() && !hasLocalStatsCache()) return;
  downloaded = true;
  cloudHydrated = true;
  markStatsDisplayReady();
}

function bootstrapStatsFromLocalCache() {
  if (!hasStoredSupabaseSession() || !hasLocalStatsCache()) return;
  downloaded = true;
  cloudHydrated = true;
  statsDisplayReady = true;
  if (statsDeferralTimer) {
    clearTimeout(statsDeferralTimer);
    statsDeferralTimer = null;
  }
  setStatsSyncingAttribute(false);
}

/** True while home/header stats should render zeros (logged-in, cloud not ready). */
export function shouldDeferStatsDisplay() {
  return !statsDisplayReady && !hasLocalStatsCache();
}

function activityStorageKey(app) {
  return `learnflow:activity:${app}:v1`;
}

/** True when the activity ledger is already in localStorage (any events). */
export function hasLocalActivityLedger(app) {
  if (!APPS.includes(app)) return false;
  const doc = readRaw(activityStorageKey(app));
  return Boolean(doc && Array.isArray(doc.events) && doc.events.length > 0);
}

/**
 * True while recent-activity UI should wait for the first cloud fetch.
 * If localStorage already has events, show them immediately (no Supabase round-trip).
 */
export function shouldDeferActivityDisplay(app) {
  if (!APPS.includes(app)) return false;
  return shouldDeferStatsDisplay() && !hasLocalActivityLedger(app);
}

/** Read cached activity events for UI — skips deferral when local ledger exists. */
export function readLocalActivityEvents(app) {
  if (shouldDeferActivityDisplay(app)) return [];
  const doc = readRaw(activityStorageKey(app));
  return Array.isArray(doc?.events) ? doc.events : [];
}

/**
 * Fetch activity from Supabase una vez por sesión de pestaña (no-op si ya se
 * pidió en esta pestaña — ver nota en downloadActivityAppOnce: antes esto
 * también se saltaba el fetch para siempre en cuanto había CUALQUIER ledger
 * local, no solo dentro de la misma sesión). Safe to call on app boot.
 */
export async function hydrateActivityFromCloud(app) {
  if (!APPS.includes(app)) return { hydrated: false, reason: 'unknown_app' };
  if (!hasStoredSupabaseSession()) return { hydrated: false, reason: 'guest' };
  if (downloadInFlight) {
    return { hydrated: hasLocalActivityLedger(app), reason: 'download_in_flight' };
  }
  if (hasLocalActivityLedger(app)) {
    markActivityFetched(app);
    notifyActivityReady(app);
    return { hydrated: true, reason: 'local_ledger' };
  }
  if (wasActivityFetched(app)) {
    notifyActivityReady(app);
    return { hydrated: hasLocalActivityLedger(app), reason: 'session_cached' };
  }
  const result = await downloadActivityApp(app);
  return { hydrated: hasLocalActivityLedger(app), ...result };
}

/** One-shot: true on the first render after cloud hydration (enables count-up / bar fill). */
export function consumeStatsRevealAnimation() {
  const animate = statsRevealPending;
  statsRevealPending = false;
  return animate;
}

/** Unblocks stats UI — call after auth resolves (guest) or cloud hydration completes. */
export function markStatsDisplayReady() {
  if (statsDisplayReady) return;
  const wasDeferring = !statsDisplayReady;
  statsDisplayReady = true;
  if (wasDeferring && hasStoredSupabaseSession()) {
    statsRevealPending = true;
  }
  if (statsDeferralTimer) {
    clearTimeout(statsDeferralTimer);
    statsDeferralTimer = null;
  }
  setStatsSyncingAttribute(false);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lp-stats-ready', { detail: { animate: statsRevealPending } }));
  }
}

bootstrapStatsFromLocalCache();

if (shouldDeferStatsDisplay()) {
  setStatsSyncingAttribute(true);
  scheduleStatsDeferralTimeout();
}

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

function mergeActivities(existing, remote, app) {
  if (app === 'lyricflow') return mergeLyricflowActivities(existing, remote);
  if (app === 'hubflow') return mergeHubflowActivities(existing, remote);
  const left = existing && typeof existing === 'object' ? existing : {};
  const right = remote && typeof remote === 'object' ? remote : {};
  return Object.keys(right).length ? { ...left, ...right } : left;
}

function mergeLastScorePct(remote, local) {
  if (remote == null) return local ?? null;
  if (local == null) return remote;
  return Math.max(remote, local);
}

// Combina una fila remota con la entrada local existente sin retroceder
// progreso ya alcanzado (favorece completado=true, mejor puntaje, más intentos).
/**
 * @param {*} existing
 * @param {*} row
 * @param {{ app?: string }} [options]
 */
function mergeContentEntry(existing, row, { app } = {}) {
  const remoteActivities = row.activities && typeof row.activities === 'object' ? row.activities : {};
  const localActivities = existing?.activities && typeof existing.activities === 'object'
    ? existing.activities
    : {};

  const merged = {
    contentId: row.content_id,
    contentType: row.content_type || existing?.contentType || (app === 'lyricflow' ? 'song' : 'module'),
    progressPct: Math.max(row.progress_pct ?? 0, existing?.progressPct ?? 0),
    completed: Boolean(row.completed) || Boolean(existing?.completed),
    completedAt: normalizeIsoDate(row.completed_at) || existing?.completedAt || null,
    bestScorePct:
      row.best_score_pct != null || existing?.bestScorePct != null
        ? Math.max(row.best_score_pct ?? 0, existing?.bestScorePct ?? 0)
        : null,
    lastScorePct: mergeLastScorePct(row.last_score_pct, existing?.lastScorePct),
    attempts: Math.max(row.attempts ?? 0, existing?.attempts ?? 0),
    activities: mergeActivities(localActivities, remoteActivities, app),
    title: existing?.title || null,
    cefrLevel: existing?.cefrLevel || null,
  };

  if (app === 'fluentflow' && !merged.cefrLevel) {
    merged.cefrLevel = inferFluentflowCefrLevel(row.content_id);
  }

  return merged;
}

function notifyCloudHydrated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lp-cloud-hydrated'));
  }
}

function postSyncMessage(payload) {
  try {
    syncChannel?.postMessage({ ...payload, at: Date.now() });
  } catch {
    /* BroadcastChannel unavailable / closed */
  }
}

/** Avisa a otras tabs del mismo origen que el progreso local cambió. */
export function notifyProgressLocalChange(app = null) {
  postSyncMessage({ type: 'progress-local', app });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lp-sync-peer', { detail: { type: 'progress-local', app } }));
  }
}

/** Reconstruye activities de LyricFlow desde el ledger local de eventos. */
export function reconcileLyricflowProgressFromEvents() {
  const progressKey = 'learnflow:progress:lyricflow:v1';
  const activityKey = 'learnflow:activity:lyricflow:v1';
  const doc = readRaw(progressKey);
  const activityDoc = readRaw(activityKey);
  if (!doc || !activityDoc?.events?.length) return false;

  doc.content = doc.content || {};
  const beforeActivities = doc.summary?.completedActivities ?? 0;
  const changed = applyLyricflowActivityEvents(doc.content, activityDoc.events);
  if (!changed) return false;

  recomputeProgressDocumentSummary(doc, 'lyricflow');
  const afterActivities = doc.summary?.completedActivities ?? 0;
  // La proyección publicada por LyricFlow (deriveSummary en vivo) puede tener
  // más actividades completadas que el ledger aislado — no persistir downgrade.
  if (afterActivities < beforeActivities && hasLyricflowLocalReadyFlag()) return false;

  doc.updatedAt = new Date().toISOString();
  writeRaw(progressKey, doc);
  return true;
}

/** Reconstruye activities de HubFlow desde el ledger local de eventos. */
export function reconcileHubflowProgressFromEvents() {
  // HubFlow dueño: no reescribir la proyección desde el ledger en DeskFlow/
  // otras apps — eso re-inflaba item.completed (flags stale) con summary fijo
  // y provocaba 38↔15 en la UI.
  if (hasHubflowLocalReadyFlag()) return false;

  const progressKey = 'learnflow:progress:hubflow:v1';
  const activityKey = 'learnflow:activity:hubflow:v1';
  const doc = readRaw(progressKey);
  const activityDoc = readRaw(activityKey);
  if (!doc || !activityDoc?.events?.length) return false;

  doc.content = doc.content || {};
  const changed = applyHubflowActivityEvents(doc.content, activityDoc.events);
  if (!changed) return false;

  recomputeProgressDocumentSummary(doc, 'hubflow');
  doc.updatedAt = new Date().toISOString();
  writeRaw(progressKey, doc);
  return true;
}

// Purga localmente lo que un admin invalidó server-side (migración 024)
// ANTES de mezclar/reconciliar nada — así ni el merge de descarga ni la
// reconstrucción desde el ledger de eventos pueden resucitar el dato viejo,
// y el próximo push ya sube el estado limpio. Cursor por app en localStorage
// para no re-pedir invalidaciones ya procesadas en cada ciclo de sync.
async function purgeInvalidatedLocal(app) {
  const cursorKey = `lp-invalidations-seen:${app}`;
  const since = localStorage.getItem(cursorKey) || '1970-01-01T00:00:00.000Z';

  const invalidations = await lpSupabase.fetchInvalidations(app, since);
  if (!invalidations || !invalidations.length) return false;

  const progressKey = `learnflow:progress:${app}:v1`;
  const activityKey = `learnflow:activity:${app}:v1`;
  const progressDoc = readRaw(progressKey);
  const activityDoc = readRaw(activityKey);

  const { content, events, changed } = applyProgressInvalidations(
    progressDoc?.content,
    activityDoc?.events,
    invalidations
  );

  if (changed) {
    if (progressDoc) {
      progressDoc.content = content || {};
      recomputeProgressDocumentSummary(progressDoc, app);
      progressDoc.updatedAt = new Date().toISOString();
      writeRaw(progressKey, progressDoc);
    }
    if (activityDoc) {
      activityDoc.events = events || [];
      activityDoc.updatedAt = new Date().toISOString();
      writeRaw(activityKey, activityDoc);
    }
  }

  const latest = invalidations.reduce(
    (max, inv) => (inv.invalidated_at > max ? inv.invalidated_at : max),
    since
  );
  localStorage.setItem(cursorKey, latest);
  return changed;
}

/** Reintenta fetch cuando getSession() aún no restauró el token (arranque en frío). */
async function fetchWithSessionRetry(fetchFn) {
  for (let i = 0; i <= SESSION_FETCH_RETRY_MS.length; i += 1) {
    let result = null;
    try {
      result = await withTimeout(fetchFn(), CLOUD_FETCH_TIMEOUT_MS, 'cloud_fetch');
    } catch (err) {
      if (!(err instanceof Error) || !err.message.endsWith('_timeout')) throw err;
      result = null;
    }
    if (result !== null) return result;
    if (i >= SESSION_FETCH_RETRY_MS.length) return null;
    if (!(await lpSupabase.isAuthenticated().catch(() => false))) return null;
    await new Promise((resolve) => setTimeout(resolve, SESSION_FETCH_RETRY_MS[i]));
  }
  return null;
}

async function downloadApp(app) {
  const remoteRows = await fetchWithSessionRetry(() => lpSupabase.fetchProgress(app));
  if (remoteRows === null) return { downloaded: false, reason: 'fetch_error' };
  if (!remoteRows.length) return { downloaded: false, reason: 'no_remote_data' };

  // HubFlow ya publicó desde score-keys: no fusionar filas cloud que OR-ean
  // completed stale (38 flags / summary 15). HubFlow sube la verdad en el push.
  if (app === 'hubflow' && hasHubflowLocalReadyFlag()) {
    return { downloaded: false, reason: 'hubflow_local_ready_owns_projection' };
  }

  const key = `learnflow:progress:${app}:v1`;
  const doc = readRaw(key) || emptyProgressDoc(app);
  doc.content = doc.content || {};

  let changed = false;
  for (const row of remoteRows) {
    const existing = doc.content[row.content_id];
    const merged = mergeContentEntry(existing, row, { app });
    if (contentEntryMergeChanged(existing, merged, app)) {
      doc.content[row.content_id] = merged;
      changed = true;
    }
  }

  const beforeMetric = app === 'hubflow' || app === 'fluentflow'
    ? (doc.summary?.completedContent ?? 0)
    : app === 'lyricflow'
      ? (doc.summary?.completedActivities ?? 0)
      : 0;
  const summaryChanged = recomputeProgressDocumentSummary(doc, app);
  const afterMetric = app === 'hubflow' || app === 'fluentflow'
    ? (doc.summary?.completedContent ?? 0)
    : app === 'lyricflow'
      ? (doc.summary?.completedActivities ?? 0)
      : 0;
  if (
    app === 'hubflow'
    && hasHubflowLocalReadyFlag()
    && afterMetric < beforeMetric
  ) {
    return { downloaded: false, reason: 'hubflow_downgrade_blocked' };
  }
  if (
    app === 'lyricflow'
    && hasLyricflowLocalReadyFlag()
    && afterMetric < beforeMetric
  ) {
    return { downloaded: false, reason: 'lyricflow_downgrade_blocked' };
  }
  if (
    app === 'fluentflow'
    && hasFluentflowLocalReadyFlag()
    && afterMetric < beforeMetric
  ) {
    return { downloaded: false, reason: 'fluentflow_downgrade_blocked' };
  }
  if (changed || summaryChanged) {
    doc.updatedAt = new Date().toISOString();
    writeRaw(key, doc);
  }

  return { downloaded: changed || summaryChanged, count: remoteRows.length };
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
    if (!event?.eventId || !event?.occurredAt || byId.has(event.eventId)) continue;
    byId.set(event.eventId, event);
  }
  // Poda acá para que el ledger local se auto-limpie: si no, los eventos
  // huérfanos que bajan de Supabase se vuelven a escribir en localStorage y
  // syncApp() los re-sube en el siguiente ciclo.
  return pruneActivityEventsToCatalog([...byId.values()], app)
    .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt))
    .slice(0, MAX_ACTIVITY_EVENTS);
}

async function downloadActivityApp(app) {
  if (activityFetchInFlight.has(app)) {
    return activityFetchInFlight.get(app);
  }

  const fetchPromise = downloadActivityAppOnce(app).finally(() => {
    activityFetchInFlight.delete(app);
  });
  activityFetchInFlight.set(app, fetchPromise);
  return fetchPromise;
}

async function downloadActivityAppOnce(app) {
  // Antes: si YA había ledger local (casi siempre, para cualquier usuario
  // activo) esto se saltaba el fetch remoto para SIEMPRE, incluso en una
  // pestaña/sesión nueva — wasActivityFetched (sessionStorage) nunca
  // alcanzaba a importar porque este segundo check ganaba primero. Resultado:
  // activity_events solo se pedía una vez por dispositivo en toda su vida.
  // Las claves de score por categoría (vocab-<cat>-<modo>:v1, de donde sale
  // el % de la tarjeta vía getModuleMatrixProgress) solo se rellenan
  // reconstruyendo esos eventos — así que categorías hechas en otro
  // dispositivo nunca llegaban acá, aunque learnflow:progress:hubflow:v1 (el
  // agregado) ya estuviera correcto. Ahora el único gate es la sesión: 1
  // fetch real por pestaña/reload, no por dispositivo — y como
  // checkAndRefresh() (migración 026) ya evita llamar a esto seguido sin
  // necesidad, el costo extra en Supabase queda acotado igual.
  if (wasActivityFetched(app)) {
    notifyActivityReady(app);
    return { downloaded: false, reason: 'session_cached' };
  }

  const remoteRows = await fetchWithSessionRetry(() => lpSupabase.fetchActivityEvents(app));
  if (remoteRows === null) return { downloaded: false, reason: 'fetch_error' };

  // Eventos que ya están en la nube no hace falta re-subirlos en el push.
  noteActivityEventsUploaded(app, remoteRows.map((row) => row.event_id));

  const key = activityStorageKey(app);
  const doc = readRaw(key) || emptyActivityDoc(app);

  if (!remoteRows.length) {
    markActivityFetched(app);
    notifyActivityReady(app);
    return { downloaded: false, reason: 'no_remote_data' };
  }

  const merged = mergeActivityEvents(doc.events, remoteRows, app);
  const unchanged =
    merged.length === (doc.events?.length || 0) &&
    merged.every((event, index) => event.eventId === doc.events?.[index]?.eventId);
  if (unchanged) {
    markActivityFetched(app);
    notifyActivityReady(app);
    return { downloaded: false, reason: 'unchanged', count: remoteRows.length };
  }

  doc.events = merged;
  doc.updatedAt = new Date().toISOString();
  writeRaw(key, doc);
  markActivityFetched(app);
  notifyActivityReady(app);
  return { downloaded: true, count: remoteRows.length };
}

/** Caché local del agregado `score_key_bests` (migración 027). */
export function scoreKeyBestsStorageKey(app) {
  return `learnflow:score-key-bests:${app}:v1`;
}

/** Mejores puntajes por scoreKey ya cacheados (mapa scoreKey → pct). */
export function readScoreKeyBests(app) {
  const doc = readRaw(scoreKeyBestsStorageKey(app));
  return doc && typeof doc.bests === 'object' && doc.bests ? doc.bests : {};
}

/**
 * Baja el máximo por scoreKey desde Supabase (migración 027).
 *
 * No está gateado por sesión de pestaña como downloadActivityApp: es lo único
 * que puede reconstruir el detalle categoría × modo de HubFlow en un
 * dispositivo que no fue el que practicó, y es barato (una fila por scoreKey
 * del catálogo, no por intento). El gate real ya lo pone checkAndRefresh()
 * con el cursor de revisión (migración 026): esto solo corre en login o
 * cuando el server dice que algo cambió.
 */
async function downloadScoreKeyBests(app) {
  // try/catch además del null: mientras la migración 027 no esté aplicada
  // esta RPC no existe, y nada de lo que pase acá puede tumbar la hidratación
  // del resto del sync (ver nota en downloadOnLogin).
  const rows = await lpSupabase.fetchScoreKeyBests(app).catch(() => null);
  if (rows === null) return { downloaded: false, reason: 'fetch_error' };
  if (!rows.length) return { downloaded: false, reason: 'no_remote_data' };

  const bests = {};
  for (const row of rows) {
    if (!row?.scoreKey) continue;
    const pct = Number(row.bestScorePct) || 0;
    bests[row.scoreKey] = Math.max(bests[row.scoreKey] ?? 0, pct);
  }

  const key = scoreKeyBestsStorageKey(app);
  const previous = readRaw(key);
  if (previous && JSON.stringify(previous.bests || {}) === JSON.stringify(bests)) {
    return { downloaded: false, reason: 'unchanged', count: rows.length };
  }

  writeRaw(key, { schemaVersion: 1, app, updatedAt: new Date().toISOString(), bests });
  return { downloaded: true, count: rows.length };
}

// Se llama una sola vez por sesión, justo después de autenticarse.
export function resetDownloadState() {
  downloaded = false;
  cloudHydrated = false;
  clearActivityFetchedFlags();
  clearActivityUploadCursors();
  beginStatsDeferral();
}

export function isCloudHydrated() {
  return cloudHydrated;
}

function shouldAbortCloudHydration() {
  return typeof window !== 'undefined' && !!window.lpGuestReset?.isExplicitLogout?.();
}

async function discardHydrationAfterLogout(perApp) {
  // downloadApp may have rewritten local keys while signOut was in flight.
  window.lpGuestReset?.clearGuestLocalProgress?.();
  resetDownloadState();
  return { downloaded: false, reason: 'aborted_logout', hydrated: false, perApp };
}

export async function downloadOnLogin({ force = false } = {}) {
  if (downloadInFlight) return downloadInFlight;

  downloadInFlight = withTimeout((async () => {
  if (downloaded && !force) return { downloaded: false, reason: 'already_downloaded_this_session' };
  if (shouldAbortCloudHydration()) {
    return { downloaded: false, reason: 'explicit_logout', hydrated: false };
  }

  const authed = await lpSupabase.isAuthenticated();
  if (!authed) {
    markStatsDisplayReady();
    return { downloaded: false, reason: 'not_authenticated' };
  }
  if (shouldAbortCloudHydration()) {
    return { downloaded: false, reason: 'explicit_logout', hydrated: false };
  }

  const perApp = {};
  let hadFetchError = false;
  let anyChanged = false;
  const appResults = await Promise.all(APPS.map(async (app) => {
    if (shouldAbortCloudHydration()) return null;
    const [progress, activity] = await Promise.all([
      downloadApp(app),
      downloadActivityApp(app),
    ]);
    const bests = app === 'hubflow'
      ? await downloadScoreKeyBests(app)
      : { downloaded: false, reason: 'not_applicable' };
    return { app, progress, activity, bests };
  }));

  for (const row of appResults) {
    if (!row) return discardHydrationAfterLogout(perApp);
    const { app, progress, activity, bests } = row;
    perApp[app] = { progress, activity, bests };
    // bests NO cuenta como fetch_error a propósito: si la migración 027
    // todavía no está aplicada, la RPC falla y esto degradaría a
    // cloudHydrated=false permanente, rompiendo TODO el sync. Sin el
    // agregado simplemente no se reconstruyen las claves granulares — el
    // mismo estado que había antes de esta migración.
    if (progress.reason === 'fetch_error' || activity.reason === 'fetch_error') hadFetchError = true;
    if (progress.downloaded || activity.downloaded || bests.downloaded) anyChanged = true;
  }

  const anyAppFetched = Object.values(perApp).some(
    (row) => row.progress?.reason !== 'fetch_error' && row.activity?.reason !== 'fetch_error'
  );

  if (shouldAbortCloudHydration() || !(await lpSupabase.isAuthenticated().catch(() => false))) {
    return discardHydrationAfterLogout(perApp);
  }

  if (!hadFetchError) {
    if (reconcileLyricflowProgressFromEvents()) anyChanged = true;
    if (reconcileHubflowProgressFromEvents()) anyChanged = true;
    downloaded = true;
    cloudHydrated = true;
  } else if (hasLocalStatsCache() || anyAppFetched) {
    // Pull parcial o fallido — no bloquear push; downloaded queda false para reintentar pull.
    cloudHydrated = true;
  }

  markStatsDisplayReady();
  if (cloudHydrated) {
    notifyCloudHydrated();
    if (anyChanged) {
      postSyncMessage({ type: 'cloud-refreshed' });
    }
  }
  return { downloaded: anyChanged, hydrated: cloudHydrated, perApp };
  })(), DOWNLOAD_LOGIN_TIMEOUT_MS, 'download_on_login').catch((err) => {
    markStatsDisplayReady();
    if (hasLocalStatsCache()) {
      cloudHydrated = true;
      notifyCloudHydrated();
    }
    if (err instanceof Error && err.message === 'download_on_login_timeout') {
      return { downloaded: false, reason: 'timeout', hydrated: cloudHydrated, perApp: {} };
    }
    throw err;
  });

  try {
    return await downloadInFlight;
  } finally {
    downloadInFlight = null;
  }
}

/**
 * Re-pull cloud when the user returns to a tab/device session.
 * Debounced so focus thrashing doesn't spam Supabase.
 */
export async function refreshFromCloudIfNeeded({ force = false } = {}) {
  if (refreshingFromCloud) return { refreshed: false, reason: 'already_refreshing' };
  if (shouldAbortCloudHydration()) return { refreshed: false, reason: 'explicit_logout' };
  if (!cloudHydrated && !force) return { refreshed: false, reason: 'not_hydrated' };
  if (!force && Date.now() - lastVisibilityRefreshAt < VISIBILITY_REFRESH_MIN_MS) {
    return { refreshed: false, reason: 'too_soon' };
  }

  const authed = await lpSupabase.isAuthenticated();
  if (!authed) return { refreshed: false, reason: 'not_authenticated' };
  if (shouldAbortCloudHydration()) return { refreshed: false, reason: 'explicit_logout' };

  refreshingFromCloud = true;
  lastVisibilityRefreshAt = Date.now();
  try {
    if (force) clearActivityFetchedFlags();
    const result = await downloadOnLogin({ force: true });
    if (result.hydrated) {
      notifyCloudHydrated();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lp-sync-peer', {
          detail: { type: 'cloud-refreshed', changed: result.downloaded },
        }));
      }
    }
    return { refreshed: true, ...result };
  } finally {
    refreshingFromCloud = false;
  }
}

// -1 (no 0) como default: "nunca chequeado" tiene que ser distinguible de
// "la última revisión vista fue 0". Los datos de progreso escritos ANTES de
// que existiera esta migración nunca bumpearon sync_cursor, así que un
// usuario con progreso real en la nube puede perfectamente tener
// revision=0 ahí. Si el sentinel de "nunca chequeado" también fuera 0,
// 0 <= 0 da "ya estoy al día" y el dispositivo no pullea nunca — exactamente
// el bug que esto reemplaza. Con -1, el primer chequeo en cualquier
// dispositivo siempre gatilla un pull real sin importar qué número
// devuelva el server, y de ahí en más las comparaciones ya son correctas.
function readLastSeenRevision() {
  try {
    const raw = localStorage.getItem(SYNC_REVISION_KEY);
    if (raw === null) return -1;
    const n = Number(raw);
    return Number.isFinite(n) ? n : -1;
  } catch {
    return -1;
  }
}

function writeLastSeenRevision(revision) {
  try {
    localStorage.setItem(SYNC_REVISION_KEY, String(revision));
  } catch {
    /* localStorage no disponible */
  }
}

/**
 * Gate barato delante de refreshFromCloudIfNeeded() (migración 026,
 * sync_cursor): en vez de pullear-y-mergear en cada visibility/focus/poll
 * (que era el único mecanismo que decidía "hay algo nuevo" hasta ahora, vía
 * cloudHydrated + throttle de 12s), primero compara un solo entero contra el
 * último visto. Si nadie escribió nada nuevo, no se toca progress ni
 * activity_events para nada — la fuente de los 5-navegadores-5-porcentajes
 * era justamente que ese "hay algo nuevo" se decidía con heurísticas que
 * podían desincronizarse entre sí.
 *
 * force:true (botón manual, reconexión online) se salta la comparación pero
 * de todos modos registra la revisión post-pull, para que el próximo check
 * liviano no vuelva a disparar un pull redundante innecesariamente.
 *
 * Si fetchSyncRevision() falla (sesión en carrera, red, RLS) cae al
 * comportamiento de siempre (refreshFromCloudIfNeeded con su propio
 * throttle) — nunca es peor que antes de esta migración.
 */
export async function checkAndRefresh({ force = false } = {}) {
  if (force) {
    const result = await refreshFromCloudIfNeeded({ force: true });
    const revision = await lpSupabase.fetchSyncRevision();
    if (result.refreshed && revision !== null) writeLastSeenRevision(revision);
    return result;
  }

  // Hidratación fallida en arranque (fetch_error por sesión en carrera) dejaba
  // cloudHydrated=false para siempre si la revisión ya estaba al día — el sync
  // nunca terminaba porque scheduleCloudSync esperaba lp-cloud-hydrated.
  if (!cloudHydrated && (await lpSupabase.isAuthenticated().catch(() => false))) {
    return refreshFromCloudIfNeeded({ force: true });
  }

  const revision = await lpSupabase.fetchSyncRevision();
  if (revision === null) return refreshFromCloudIfNeeded();
  if (revision <= readLastSeenRevision()) {
    return { refreshed: false, reason: 'up_to_date', revision };
  }

  const result = await refreshFromCloudIfNeeded({ force: true });
  if (result.refreshed) writeLastSeenRevision(revision);
  return result;
}

/** Dispara reintento de hidratación si el pull inicial falló (p. ej. desde scheduleCloudSync). */
export function ensureCloudHydrated() {
  if (cloudHydrated) return;
  void checkAndRefresh();
}

/**
 * Cross-tab + multi-device hooks:
 * - BroadcastChannel for same-origin tabs
 * - visibility/focus → re-download (merge-by-max)
 * - polling liviano de la revisión mientras la pestaña está visible (barato:
 *   1 fila indexada, no progress/activity_events completos)
 */
export function setupMultiSessionSync() {
  if (typeof window === 'undefined' || multiSessionSetup) return;
  multiSessionSetup = true;

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      syncChannel.onmessage = (event) => {
        const msg = event?.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.type !== 'progress-local' && msg.type !== 'cloud-refreshed') return;
        window.dispatchEvent(new CustomEvent('lp-sync-peer', { detail: msg }));
      };
    } catch {
      syncChannel = null;
    }
  }

  const onVisible = () => {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    void checkAndRefresh();
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);

  // Online again after offline — pull latest before local writes race.
  window.addEventListener('online', () => {
    void checkAndRefresh({ force: true });
  });

  window.addEventListener('lp-guest-reset', () => {
    resetDownloadState();
  });

  if (!revisionPollTimer) {
    revisionPollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void checkAndRefresh();
    }, REVISION_POLL_MS);
  }
}

function prepareProgressDocForUpload(progressDoc, app, activityDoc) {
  if (!progressDoc?.content) return false;
  let changed = false;

  if (app === 'lyricflow' && activityDoc?.events?.length) {
    if (applyLyricflowActivityEvents(progressDoc.content, activityDoc.events)) changed = true;
  }

  if (app === 'hubflow' && activityDoc?.events?.length) {
    if (applyHubflowActivityEvents(progressDoc.content, activityDoc.events)) changed = true;
  }

  if (recomputeProgressDocumentSummary(progressDoc, app)) changed = true;
  return changed;
}

async function pullMergeLocal(app) {
  await purgeInvalidatedLocal(app);
  const progress = await downloadApp(app);
  const activity = await downloadActivityApp(app);
  let reconciled = false;
  if (app === 'lyricflow') reconciled = reconcileLyricflowProgressFromEvents();
  if (app === 'hubflow') reconciled = reconcileHubflowProgressFromEvents();
  return {
    pulled: Boolean(progress.downloaded || activity.downloaded || reconciled),
    progress,
    activity,
  };
}

async function syncApp(app, { skipPull = false } = {}) {
  // Pull-merge-push: absorb peer/device writes before uploading local deltas.
  if (skipPull) {
    await purgeInvalidatedLocal(app);
  } else {
    await pullMergeLocal(app);
  }

  const progressKey = `learnflow:progress:${app}:v1`;
  const progressDoc = readRaw(progressKey);
  const activityDoc = readRaw(`learnflow:activity:${app}:v1`);

  const results = {};

  if (progressDoc && progressDoc.content && Object.keys(progressDoc.content).length) {
    if (prepareProgressDocForUpload(progressDoc, app, activityDoc)) {
      progressDoc.updatedAt = new Date().toISOString();
      writeRaw(progressKey, progressDoc);
    }
    results.progress = await lpSupabase.syncProgress(app, { content: progressDoc.content });
    notifyProgressLocalChange(app);
  }
  if (activityDoc && Array.isArray(activityDoc.events) && activityDoc.events.length) {
    // Nunca subir eventos de contenido que ya no existe: activity_events es
    // append-only (migración 003), así que una fila huérfana subida solo se
    // puede quitar con una migración server-side.
    const uploadable = pruneActivityEventsToCatalog(activityDoc.events, app);
    if (uploadable.length !== activityDoc.events.length) {
      activityDoc.events = uploadable;
      activityDoc.updatedAt = new Date().toISOString();
      writeRaw(`learnflow:activity:${app}:v1`, activityDoc);
    }
    if (uploadable.length) {
      const uploadedIds = readUploadedActivityIds(app);
      const pending = uploadable.filter((event) => event.eventId && !uploadedIds.has(event.eventId));
      if (pending.length) {
        results.activity = await lpSupabase.syncActivityEvents(app, pending, { updateStreak: false });
        if (results.activity?.synced) {
          noteActivityEventsUploaded(app, pending.map((event) => event.eventId));
        }
      } else {
        results.activity = { synced: true, count: 0, reason: 'already_uploaded' };
      }
    }
  }

  return results;
}

/** Pull-merge-push for a single app (HubFlow / LyricFlow scheduleCloudSync). */
export async function syncSingleApp(app) {
  if (!APPS.includes(app)) return { synced: false, reason: 'unknown_app' };
  if (shouldAbortCloudHydration()) return { synced: false, reason: 'explicit_logout' };
  const authed = await lpSupabase.isAuthenticated();
  if (!authed) return { synced: false, reason: 'not_authenticated' };
  if (!cloudHydrated) return { synced: false, reason: 'not_hydrated' };
  return syncApp(app);
}

export async function runFullSync({ force = false, skipPull = false } = {}) {
  if (syncing) return { synced: false, reason: 'already_syncing' };
  if (shouldAbortCloudHydration()) return { synced: false, reason: 'explicit_logout' };
  if (!force && Date.now() - lastSyncAt < SYNC_INTERVAL_MS) {
    return { synced: false, reason: 'too_soon' };
  }

  const authed = await lpSupabase.isAuthenticated();
  if (!authed) return { synced: false, reason: 'not_authenticated' };
  if (!cloudHydrated) return { synced: false, reason: 'not_hydrated' };

  syncing = true;
  try {
    const entries = await withTimeout(
      Promise.all(APPS.map(async (app) => [app, await syncApp(app, { skipPull })])),
      FULL_SYNC_TIMEOUT_MS,
      'full_sync'
    );
    const perApp = Object.fromEntries(entries);
    await lpSupabase.updateUserStreakOnce().catch(() => {});
    lastSyncAt = Date.now();
    return { synced: true, perApp };
  } catch (err) {
    if (err instanceof Error && err.message === 'full_sync_timeout') {
      return { synced: false, reason: 'timeout' };
    }
    throw err;
  } finally {
    syncing = false;
  }
}

/**
 * Ciclo manual pull→push (botón Dev «Forzar sync»). Un solo pull global y
 * subida sin volver a bajar progress/activity por app — el patrón anterior
 * (refreshFromCloudIfNeeded + runFullSync) duplicaba 3× downloadApp,
 * 3× reconcile y varios round-trips a Supabase.
 */
export async function forceCloudSync() {
  if (syncing || refreshingFromCloud) {
    return { ok: false, reason: 'already_in_progress' };
  }
  if (shouldAbortCloudHydration()) {
    return { ok: false, reason: 'explicit_logout' };
  }

  const authed = await lpSupabase.isAuthenticated();
  if (!authed) return { ok: false, reason: 'not_authenticated' };

  const startedAt = Date.now();
  const timeoutMs = 45000;

  try {
    const result = await Promise.race([
      (async () => {
        clearActivityFetchedFlags();
        const pull = await refreshFromCloudIfNeeded({ force: true });
        const push = await runFullSync({ force: true, skipPull: true });
        const revision = await lpSupabase.fetchSyncRevision();
        if (revision !== null) writeLastSeenRevision(revision);
        return {
          ok: true,
          pull,
          push,
          downloaded: !!(/** @type {any} */ (pull)?.downloaded),
          durationMs: Date.now() - startedAt,
        };
      })(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('force_sync_timeout')), timeoutMs);
      }),
    ]);
    return result;
  } catch (err) {
    if (err instanceof Error && err.message === 'force_sync_timeout') {
      syncing = false;
      refreshingFromCloud = false;
      return { ok: false, reason: 'timeout', durationMs: Date.now() - startedAt };
    }
    throw err;
  }
}
