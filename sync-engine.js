// sync-engine.js — Sube el progreso local (localStorage) de FluentFlow, HubFlow
// y LyricFlow a Supabase cuando el usuario está autenticado. DeskFlow actúa como
// coordinador porque es el único punto donde las 3 apps conviven en un mismo origin.
//
// Solo sube (local -> remoto). La descarga/merge (remoto -> local, multi-dispositivo)
// queda pendiente: el esquema local actual solo trae updatedAt a nivel de documento,
// no por content_id, así que un merge último-en-escribir real requeriría antes decidir
// esa granularidad — no vale la pena improvisarlo.

import * as lpSupabase from './lp-supabase.js';

const APPS = ['fluentflow', 'hubflow', 'lyricflow'];
const VERSION = { fluentflow: 'v1', hubflow: 'v2', lyricflow: 'v1' };
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

let lastSyncAt = 0;
let syncing = false;

function readRaw(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function syncApp(app) {
  const version = VERSION[app];
  const progressDoc = readRaw(`learnflow:progress:${app}:${version}`);
  const activityDoc = readRaw(`learnflow:activity:${app}:${version}`);

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
