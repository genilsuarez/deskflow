// Stub de lp-supabase.js para las pruebas de sync-engine.
//
// El módulo real importa el SDK desde https://esm.sh/..., que el loader ESM de
// Node no resuelve. supabase-loader.mjs redirige './lp-supabase.js' acá para
// poder ejercitar el ciclo pull-merge-push de verdad, sin red.

/** Filas que "devuelve la nube". Las setea cada prueba. */
export const remote = { progress: {}, activity: {}, scoreKeyBests: {} };

/** Lo que sync-engine intentó subir. Es lo que se verifica. */
export const uploads = { progress: [], activity: [] };

export function reset() {
  remote.progress = {};
  remote.activity = {};
  remote.scoreKeyBests = {};
  uploads.progress = [];
  uploads.activity = [];
}

export async function isAuthenticated() {
  return true;
}

export function getUser() {
  return { id: 'test-user', email: 'test@example.com' };
}

export function getSession() {
  return { user: getUser() };
}

export async function fetchProgress(app) {
  return remote.progress[app] ?? [];
}

export async function fetchActivityEvents(app) {
  return remote.activity[app] ?? [];
}

export async function fetchScoreKeyBests(app) {
  return remote.scoreKeyBests[app] ?? [];
}

export async function fetchInvalidations(_app, _sinceIso) {
  return [];
}

export async function syncProgress(app, doc) {
  uploads.progress.push({ app, contentIds: Object.keys(doc.content ?? {}) });
  return { synced: true, count: Object.keys(doc.content ?? {}).length, via: 'merge_rpc' };
}

export async function syncActivityEvents(app, events) {
  uploads.activity.push({ app, contentIds: events.map((e) => e.contentId) });
  return { synced: true, count: events.length };
}

export async function updateUserStreakOnce() { return { updated: false, reason: 'stub' }; }
export async function syncSettings() { return { synced: true }; }
export async function fetchSettings() { return null; }
export async function fetchStreak() { return null; }
export async function fetchProfile() { return null; }
export async function updateProfile() { return true; }
export async function fetchCefrLevel() { return null; }
export async function updateCefrLevel() { return true; }
export function onAuthStateChange() {}
export function isOAuthReturnUrl() { return false; }
export function cleanAuthParamsFromUrl() {}
export function hasProgressSignal() { return false; }
