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
    options: { redirectTo: window.location.origin + window.location.pathname },
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

export async function syncProgress(app, localProgress) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { synced: false, reason: 'not_authenticated' };

  const localEntries = Object.entries(localProgress.content || {});

  const rows = localEntries.map(([contentId, item]) => ({
    user_id: user.id,
    app,
    content_id: contentId,
    content_type: item.contentType || 'module',
    progress_pct: item.progressPct || 0,
    completed: item.completed || false,
    completed_at: item.completedAt || null,
    best_score_pct: item.bestScorePct || null,
    last_score_pct: item.lastScorePct || null,
    attempts: item.attempts || 0,
    activities: item.activities || {},
    synced_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('progress')
    .upsert(rows, { onConflict: 'user_id,app,content_id' });

  if (error) return { synced: false, reason: error.message };
  return { synced: true, count: rows.length };
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
    .update(updates)
    .eq('id', user.id);

  return { error: error?.message || null };
}

export { supabase };
