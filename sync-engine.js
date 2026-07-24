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
  contentEntryMergeChanged,
  inferFluentflowCefrLevel,
  mergeHubflowActivities,
  mergeLyricflowActivities,
  recomputeProgressDocumentSummary,
} from './lp-progress-summary.js';

const APPS = ['fluentflow', 'hubflow', 'lyricflow'];
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ACTIVITY_EVENTS = 200;
const VISIBILITY_REFRESH_MIN_MS = 12_000;
const SYNC_CHANNEL_NAME = 'lp-sync';

let lastSyncAt = 0;
let syncing = false;
let downloaded = false;
let cloudHydrated = false;
let lastVisibilityRefreshAt = 0;
let multiSessionSetup = false;
let syncChannel = null;
let refreshingFromCloud = false;

const STATS_DEFERRAL_TIMEOUT_MS = 8000;
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
  scheduleStatsDeferralTimeout();
}

function hasLocalProgressDoc(app) {
  if (!APPS.includes(app)) return false;
  const doc = readRaw(`learnflow:progress:${app}:v1`);
  return Boolean(doc?.content && Object.keys(doc.content).length > 0);
}

/** True when progress or activity is already in localStorage (skip Supabase wait). */
function hasLocalStatsCache() {
  return APPS.some((app) => hasLocalProgressDoc(app) || hasLocalActivityLedger(app));
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
 * Fetch activity from Supabase only when localStorage has no ledger yet.
 * Safe to call on app boot — no-op when cache or session flag exists.
 */
export async function hydrateActivityFromCloud(app) {
  if (!APPS.includes(app)) return { hydrated: false, reason: 'unknown_app' };
  if (!hasStoredSupabaseSession()) return { hydrated: false, reason: 'guest' };
  if (hasLocalActivityLedger(app)) {
    markActivityFetched(app);
    notifyActivityReady(app);
    return { hydrated: true, reason: 'local_cache' };
  }
  if (wasActivityFetched(app)) {
    if (hasLocalActivityLedger(app)) {
      notifyActivityReady(app);
      return { hydrated: true, reason: 'session_cached' };
    }
    clearActivityFetched(app);
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
  const changed = applyLyricflowActivityEvents(doc.content, activityDoc.events);
  if (!changed) return false;

  recomputeProgressDocumentSummary(doc, 'lyricflow');
  doc.updatedAt = new Date().toISOString();
  writeRaw(progressKey, doc);
  return true;
}

/** Reconstruye activities de HubFlow desde el ledger local de eventos. */
export function reconcileHubflowProgressFromEvents() {
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
    const merged = mergeContentEntry(existing, row, { app });
    if (contentEntryMergeChanged(existing, merged, app)) {
      doc.content[row.content_id] = merged;
      changed = true;
    }
  }

  const summaryChanged = recomputeProgressDocumentSummary(doc, app);
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
  return [...byId.values()]
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
  if (wasActivityFetched(app)) {
    if (hasLocalActivityLedger(app)) {
      notifyActivityReady(app);
      return { downloaded: false, reason: 'session_cached' };
    }
    clearActivityFetched(app);
  }
  if (hasLocalActivityLedger(app)) {
    markActivityFetched(app);
    notifyActivityReady(app);
    return { downloaded: false, reason: 'local_cache' };
  }

  const remoteRows = await lpSupabase.fetchActivityEvents(app);
  if (remoteRows === null) return { downloaded: false, reason: 'fetch_error' };

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

// Se llama una sola vez por sesión, justo después de autenticarse.
export function resetDownloadState() {
  downloaded = false;
  cloudHydrated = false;
  clearActivityFetchedFlags();
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
  for (const app of APPS) {
    if (shouldAbortCloudHydration()) return discardHydrationAfterLogout(perApp);
    const progress = await downloadApp(app);
    const activity = await downloadActivityApp(app);
    perApp[app] = { progress, activity };
    if (progress.reason === 'fetch_error' || activity.reason === 'fetch_error') hadFetchError = true;
    if (progress.downloaded || activity.downloaded) anyChanged = true;
  }

  if (shouldAbortCloudHydration() || !(await lpSupabase.isAuthenticated().catch(() => false))) {
    return discardHydrationAfterLogout(perApp);
  }

  if (!hadFetchError) {
    if (reconcileLyricflowProgressFromEvents()) anyChanged = true;
    if (reconcileHubflowProgressFromEvents()) anyChanged = true;
    downloaded = true;
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

/**
 * Cross-tab + multi-device hooks:
 * - BroadcastChannel for same-origin tabs
 * - visibility/focus → re-download (merge-by-max)
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
    void refreshFromCloudIfNeeded();
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);

  // Online again after offline — pull latest before local writes race.
  window.addEventListener('online', () => {
    void refreshFromCloudIfNeeded({ force: true });
  });

  window.addEventListener('lp-guest-reset', () => {
    resetDownloadState();
  });
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

async function syncApp(app) {
  // Pull-merge-push: absorb peer/device writes before uploading local deltas.
  await pullMergeLocal(app);

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
    results.activity = await lpSupabase.syncActivityEvents(app, activityDoc.events);
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

export async function runFullSync({ force = false } = {}) {
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
