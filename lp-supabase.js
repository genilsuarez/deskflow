// @ts-check
// lp-supabase.js — Canonical client wrapper for Learn Platform (vanilla apps)
// Copiado tal cual a DeskFlow (root), LyricFlow (root), HubFlow (js/).
// ES module puro, sin build step — igual que lp-theme.js.
//
// SUPABASE_URL y SUPABASE_ANON_KEY son valores públicos por diseño (la seguridad
// vive en RLS, no en ocultar estos valores). Se hardcodean directo: no hay paso
// de build en las apps vanilla que pueda sustituir placeholders.

// @ts-ignore — import por URL (sin build step); tsc no puede resolver tipos remotos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://dfbokwebquvgsjgpnikw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rhGQoQfqjBsBR6fg9RLMig_fnDDP3Rx';

/** True when the URL still carries OAuth callback params (hash or query). */
export function isOAuthReturnUrl(urlLike) {
  const href = typeof urlLike === 'string' ? urlLike : window.location.href;
  return /(^|[#?&])(access_token|refresh_token|code|error_description)=/.test(href);
}

/** Strip OAuth tokens from the address bar after Supabase consumes them. */
export function cleanAuthParamsFromUrl() {
  if (typeof window === 'undefined') return false;
  const url = new URL(window.location.href);
  const hadHashAuth = /(^|&)(access_token|refresh_token|type)=/.test(url.hash.replace(/^#/, ''));
  const hadQueryAuth =
    url.searchParams.has('code') ||
    url.searchParams.has('error') ||
    url.searchParams.has('error_description');
  if (!hadHashAuth && !hadQueryAuth) return false;

  if (hadHashAuth) url.hash = '';
  url.searchParams.delete('code');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  const next = url.pathname + url.search + url.hash;
  window.history.replaceState(window.history.state, '', next);
  return true;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // para OAuth redirects
    // PKCE (default) hace `await` en el code challenge antes de
    // window.location.assign() dentro de signInWithOAuth — ese hueco async
    // entre el tap y la navegación es un patrón asociado a redirects que no
    // ocurren en iOS Safari/Chrome (WebKit). 'implicit' construye la URL de
    // forma síncrona, sin ese hueco. Trade-off: PKCE protege mejor contra
    // interceptación del auth code; implicit es el flujo OAuth clásico,
    // menos robusto en ese aspecto pero ampliamente usado y sin este problema.
    flowType: 'implicit',
  },
});

// === AUTH ===

export function getUser() {
  return supabase.auth.getUser();
}

export function getSession() {
  return supabase.auth.getSession();
}

export async function isAuthenticated() {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session?.user;
}

export function buildGoogleOAuthUrl(redirectTo) {
  const target =
    redirectTo || window.location.origin + window.location.pathname + window.location.search;
  return `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(target)}`;
}

/**
 * Synchronous redirect to Google OAuth. Must run in the same call stack as the
 * user tap — signInWithOAuth() awaits internally before location.assign(), which
 * breaks the user-gesture chain on iOS Safari/Chrome (WebKit).
 */
export function beginGoogleOAuthRedirect(redirectTo) {
  window.location.assign(buildGoogleOAuthUrl(redirectTo));
}

export function signInWithGoogle() {
  beginGoogleOAuthRedirect();
  return Promise.resolve({ data: { provider: 'google' }, error: null });
}

export function signInWithMagicLink(email) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
}

export function signOut() {
  return supabase.auth.signOut();
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

// === PROGRESS ===

/** True if the entry carries real progress (safe to upload). */
export function hasProgressSignal(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.completed) return true;
  if ((item.attempts ?? 0) > 0) return true;
  if ((item.progressPct ?? 0) > 0) return true;
  if ((item.bestScorePct ?? 0) > 0) return true;
  const activities = item.activities;
  if (activities && typeof activities === 'object') {
    for (const activity of Object.values(activities)) {
      if (!activity || typeof activity !== 'object') continue;
      if (activity.completed) return true;
      if ((activity.attempts ?? 0) > 0) return true;
      if ((activity.completedKeys ?? 0) > 0) return true;
      if ((activity.bestScorePct ?? 0) > 0) return true;
    }
  }
  return false;
}

function toProgressRows(userId, app, content) {
  return Object.entries(content || {})
    .filter(([, item]) => hasProgressSignal(item))
    .map(([contentId, item]) => ({
      user_id: userId,
      app,
      content_id: contentId,
      content_type: item.contentType || 'module',
      progress_pct: item.progressPct || 0,
      completed: item.completed || false,
      completed_at: item.completedAt || null,
      best_score_pct: item.bestScorePct ?? null,
      last_score_pct: item.lastScorePct ?? null,
      attempts: item.attempts || 0,
      activities: item.activities || {},
      synced_at: new Date().toISOString(),
    }));
}

/**
 * Sube progreso con merge monotónico en servidor (RPC upsert_progress_merge).
 * Sin fallback a upsert clásico a propósito: ese upsert pisa la fila entera
 * en vez de mergear (greatest()/OR por campo), que es exactamente la
 * condición de carrera multi-dispositivo que la migración 019 vino a
 * eliminar. Si el RPC falla, el ciclo falla limpio y se reintenta solo en
 * el próximo scheduleSync/visibility-refresh del caller.
 */
export async function syncProgress(app, localProgress) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { synced: false, reason: 'not_authenticated' };

  const rows = toProgressRows(user.id, app, localProgress.content);
  if (!rows.length) return { synced: true, count: 0, reason: 'nothing_to_sync' };

  const { data, error: rpcError } = await supabase.rpc('upsert_progress_merge', {
    p_rows: rows,
  });

  if (!rpcError) {
    return { synced: true, count: typeof data === 'number' ? data : rows.length, via: 'merge_rpc' };
  }

  return { synced: false, reason: rpcError.message || 'rpc_failed' };
}

export async function fetchProgress(app) {
  const { data: { session } } = await supabase.auth.getSession();
  // null (no []): sin sesión acá es indistinguible de una carrera de arranque
  // frío (el cliente de Supabase todavía restaurando el token desde storage)
  // — devolver [] hacía que downloadOnLogin() lo confundiera con "sin datos
  // remotos" y marcara cloudHydrated=true sin haber pedido nada realmente,
  // dejando el dispositivo pegado en su copia local vieja (ver auditoría
  // House & Rooms: 5 navegadores, 5 porcentajes distintos, ninguno = nube).
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('progress')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('app', app);

  if (error) return null;
  return data ?? [];
}

export async function fetchActivityEvents(app) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null; // ver nota en fetchProgress()

  const { data, error } = await supabase
    .from('activity_events')
    .select(
      'event_id, run_id, app, content_id, title, activity, event_type, occurred_at, score_pct, passed, duration_ms, metrics'
    )
    .eq('user_id', session.user.id)
    .eq('app', app)
    .order('occurred_at', { ascending: false })
    .limit(200);

  if (error) return null;
  return data ?? [];
}

/**
 * Invalidaciones de progreso más nuevas que `sinceIso` (migración 024).
 * El cliente las usa para purgar su propio localStorage antes de sincronizar,
 * así nunca re-sube un "completado" que un admin acaba de corregir.
 */
export async function fetchInvalidations(app, sinceIso) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null; // ver nota en fetchProgress()

  const { data, error } = await supabase
    .from('progress_invalidations')
    .select('content_id, invalidated_at')
    .eq('user_id', session.user.id)
    .eq('app', app)
    .gt('invalidated_at', sinceIso);

  if (error) return null;
  return data ?? [];
}

/**
 * Revisión monotónica del usuario (migración 026, sync_cursor). Un solo
 * número que sube en cada escritura real a progress/activity_events — el
 * cliente lo compara contra el último que vio para decidir "¿hace falta
 * pull?" sin ambigüedad, en vez de las heurísticas (downloaded, cloudHydrated,
 * hasLocalStatsCache) que hoy deciden eso y se desincronizan entre sí.
 * Todavía no se llama desde ningún lado (fase 2 del plan de sync).
 */
export async function fetchSyncRevision() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('sync_cursor')
    .select('revision')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) return null;
  return data?.revision ?? 0;
}

// === ACTIVITY EVENTS ===

export async function syncActivityEvents(app, events) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { synced: false };

  const rows = events.map(event => ({
    user_id: user.id,
    event_id: event.eventId,
    run_id: event.runId,
    app,
    content_id: event.contentId,
    title: event.title || event.contentId,
    activity: event.activity,
    event_type: event.eventType || 'attempt_completed',
    occurred_at: event.occurredAt,
    score_pct: event.scorePct ?? null,
    passed: event.passed ?? null,
    duration_ms: event.durationMs ?? null,
    metrics: event.metrics || {},
  }));

  const { error } = await supabase
    .from('activity_events')
    .upsert(rows, { onConflict: 'user_id,event_id', ignoreDuplicates: true });

  if (error) return { synced: false, reason: error.message };

  await supabase.rpc('update_streak', { p_user_id: user.id });

  return { synced: true, count: rows.length };
}

// === SETTINGS ===

export async function syncSettings(app, settings, schemaVersion) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { synced: false };

  const { error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: user.id,
      app,
      settings,
      schema_version: schemaVersion,
    }, { onConflict: 'user_id,app' });

  return { synced: !error, reason: error?.message };
}

export async function fetchSettings(app) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('user_settings')
    .select('settings, schema_version')
    .eq('user_id', user.id)
    .eq('app', app)
    .single();

  return data;
}

// === STREAKS ===

export async function fetchStreak() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('streaks')
    .select('*')
    .eq('user_id', user.id)
    .single();

  return data;
}

// === LEADERBOARD ===

export async function fetchLeaderboard(app = null, limit = 20) {
  const { data } = await supabase.rpc('get_weekly_leaderboard', {
    p_app: app,
    p_limit: limit,
  });
  return data || [];
}

// === PROFILE ===

export async function fetchProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return data;
}

export async function updateProfile(updates) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'not_authenticated' };

  const { error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, ...updates }, { onConflict: 'id' });

  return { error: error?.message || null };
}

// === CEFR LEVEL (LearnFlow Progression System) ===
// docs/to-do/learnflow-progression-system.md — el nivel activo vive en
// profiles.cefr_level, igual que cualquier otro dato de perfil. Envoltorios
// delgados sobre fetchProfile()/updateProfile() para no repetir el
// user.id/auth check en cada caller.

export async function fetchCefrLevel() {
  const profile = await fetchProfile();
  return profile?.cefr_level || null;
}

export async function updateCefrLevel(level) {
  return updateProfile({ cefr_level: level });
}

export { supabase };
