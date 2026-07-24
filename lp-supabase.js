// lp-supabase.js — Canonical client wrapper for Learn Platform (vanilla apps)
// Copiado tal cual a DeskFlow (root), LyricFlow (root), HubFlow (js/).
// ES module puro, sin build step — igual que lp-theme.js.
//
// SUPABASE_URL y SUPABASE_ANON_KEY son valores públicos por diseño (la seguridad
// vive en RLS, no en ocultar estos valores). Se hardcodean directo: no hay paso
// de build en las apps vanilla que pueda sustituir placeholders.

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

export function signInWithGoogle() {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname + window.location.search,
      skipBrowserRedirect: false,
    },
  });
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

async function upsertProgressBlind(rows) {
  const { error } = await supabase
    .from('progress')
    .upsert(rows, { onConflict: 'user_id,app,content_id' });
  return error;
}

/**
 * Sube progreso con merge monotónico en servidor (RPC upsert_progress_merge).
 * Si el RPC aún no está aplicado, cae a upsert clásico (el cliente ya hace
 * pull-merge-push y filtra filas vacías).
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

  // RPC missing / not yet migrated → blind upsert (still filtered empty rows)
  const message = rpcError.message || '';
  const rpcMissing =
    /could not find the function|function .* does not exist|PGRST202|404/i.test(message);
  if (!rpcMissing) return { synced: false, reason: message };

  const fallbackError = await upsertProgressBlind(rows);
  if (fallbackError) return { synced: false, reason: fallbackError.message };
  return { synced: true, count: rows.length, via: 'upsert_fallback' };
}

export async function fetchProgress(app) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];

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
  if (!session?.user) return [];

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

export { supabase };
