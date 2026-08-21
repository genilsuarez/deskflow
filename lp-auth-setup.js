import * as lpSupabase from './lp-supabase.js';
import {
  downloadOnLogin,
  runFullSync,
  resetDownloadState,
  setupMultiSessionSync,
  markStatsDisplayReady,
  markLocalCacheBootstrapped,
  hasLocalStatsCache,
  checkAndRefresh,
  forceCloudSync,
} from './sync-engine.js';
import { checkLevelAdvancement, LEVEL_ORDER } from './lp-progress-summary.js';

window.lpSupabase = lpSupabase;

let authListenerRegistered = false;
let authHandlerInFlight = null;
let lastHandledUserId = null;

async function hydrateFromCloud(onAfterLogin, { forceDownload = false } = {}) {
  const result = await downloadOnLogin({ force: forceDownload });
  if (!result.hydrated) return result;
  onAfterLogin?.();
  // Push en segundo plano — no bloquear login si el RPC tarda o cuelga.
  void runFullSync({ force: true, skipPull: true }).catch(() => {});
  return result;
}

/**
 * Restaura lp-level desde profiles.cefr_level. Nunca lo BAJA: si el valor
 * en la nube está más atrás que el local (p. ej. otro dispositivo aún no
 * sincronizó), se conserva el local — el nivel nunca retrocede (ver
 * docs/to-do/learnflow-progression-system.md § Reset parcial).
 */
function restoreLevelFromProfile(profile) {
  const cloudLevel = profile?.cefr_level;
  if (!cloudLevel || !LEVEL_ORDER.includes(cloudLevel)) return;
  let localLevel = 'a1';
  try {
    localLevel = localStorage.getItem('lp-level') || 'a1';
  } catch {
    return;
  }
  if (LEVEL_ORDER.indexOf(cloudLevel) <= LEVEL_ORDER.indexOf(localLevel)) return;
  try {
    localStorage.setItem('lp-level', cloudLevel);
  } catch {
    /* localStorage no disponible */
  }
}

/**
 * Reevalúa la condición combinada tras hidratar desde la nube — el progreso
 * de otro dispositivo puede haber completado la parte que faltaba. Si
 * avanza, persiste el nuevo nivel en profiles (best-effort: si falla, se
 * reintenta en la próxima sesión autenticada, igual que el resto del sync).
 */
async function reevaluateLevelAfterSync() {
  let result;
  try {
    result = checkLevelAdvancement();
  } catch {
    return;
  }
  if (!result?.advanced) return;
  try {
    await lpSupabase.updateCefrLevel(result.level);
  } catch {
    /* se reintenta en la próxima sesión autenticada */
  }
}

async function clearOrphanSupabaseSession() {
  try {
    await lpSupabase.signOut();
  } catch {
    /* noop */
  }
}

async function handleLogin(session, onAfterLogin, { forceDownload = false } = {}) {
  if (!session?.user) return;
  while (authHandlerInFlight) {
    await authHandlerInFlight;
  }

  authHandlerInFlight = (async () => {
    let profile = null;
    try {
      profile = await lpSupabase.fetchProfile();
    } catch {
      profile = null;
    }
    if (typeof lpLogin !== 'undefined') {
      const hasLocal = !!window.lpGuestReset?.hasLocalSupabaseIdentity?.();
      if (!hasLocal) {
        // First cloud identity on this device.
        lpLogin.setUserFromSupabase(session.user, profile);
      } else if (profile) {
        // Already logged in — refresh name/email from cloud (other browser edits).
        const current = lpLogin.getUser();
        if (current?.isSupabaseUser && current.id === session.user.id) {
          const fallbackName = (session.user.email || '').split('@')[0];
          const cloudName = profile.name || fallbackName;
          if (current.name !== cloudName || current.email !== session.user.email) {
            lpLogin.setUserFromSupabase(session.user, profile);
          }
        }
      }
    }
    restoreLevelFromProfile(profile);
    await hydrateFromCloud(onAfterLogin, { forceDownload });
    await reevaluateLevelAfterSync();
    lastHandledUserId = session.user.id;
    lpSupabase.cleanAuthParamsFromUrl?.();
  })();

  try {
    return await authHandlerInFlight;
  } finally {
    authHandlerInFlight = null;
  }
}

async function processAuthSession(session, onAfterLogin, onAfterLogout, event) {
  if (!session?.user) return;

  if (window.lpGuestReset?.shouldRejectSession?.()) {
    await clearOrphanSupabaseSession();
    window.lpGuestReset?.clearExplicitLogout?.();
    return;
  }

  // Supabase dispara INITIAL_SESSION y luego SIGNED_IN en cada recarga con sesión
  // persistida. Sin este guard, SIGNED_IN llama resetDownloadState() y vuelve a
  // ejecutar downloadOnLogin completo — minutos de carga redundante.
  if (event === 'SIGNED_IN' && lastHandledUserId === session.user.id) {
    lpSupabase.cleanAuthParamsFromUrl?.();
    return;
  }

  const oauthReturn = !!lpSupabase.isOAuthReturnUrl?.();
  const forceDownload =
    (event === 'SIGNED_IN' && lastHandledUserId !== session.user.id) ||
    (event === 'INITIAL_SESSION' && oauthReturn) ||
    (event === 'INITIAL_SESSION' && !!window.lpGuestReset?.shouldForceCloudDownload?.());

  const shouldResetDownloadState =
    (event === 'SIGNED_IN' && lastHandledUserId !== session.user.id) ||
    (event === 'INITIAL_SESSION' && forceDownload);

  if (shouldResetDownloadState) {
    resetDownloadState();
  }

  if (
    event === 'INITIAL_SESSION' &&
    !forceDownload &&
    (lastHandledUserId === session.user.id || hasLocalStatsCache())
  ) {
    markLocalCacheBootstrapped();
    lastHandledUserId = session.user.id;
    lpSupabase.cleanAuthParamsFromUrl?.();
    // El caché local puede estar desactualizado (progreso hecho en otro
    // dispositivo). markLocalCacheBootstrapped() solo evita bloquear el
    // primer render; el chequeo real ocurre acá, en segundo plano, en vez de
    // esperar al próximo visibilitychange/focus. checkAndRefresh() consulta
    // primero la revisión (migración 026) — si no hay nada nuevo no pullea
    // progress/activity_events completos; si falla el chequeo, cae sola al
    // pull de siempre.
    void checkAndRefresh();
    return;
  }

  await handleLogin(session, onAfterLogin, { forceDownload });
}

function setupCrossTabLogoutListener() {
  window.addEventListener('lp-explicit-logout', () => {
    void clearOrphanSupabaseSession();
  });
}

// Pull-merge-push manual desde #devForceSyncBtn — un solo ciclo con timeout (45s).
window.lpForceSync = () => forceCloudSync();

export function setupSupabaseAuth({ onAfterLogin, onAfterLogout } = {}) {
  if (authListenerRegistered) return;
  authListenerRegistered = true;
  setupCrossTabLogoutListener();
  setupMultiSessionSync();

  lpSupabase.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user) {
      lastHandledUserId = null;
      resetDownloadState();
      markStatsDisplayReady();
      // logout() clears lp-user before signOut resolves, so getUser() is often
      // already null here. Honor the explicit-logout flag set in logout().
      const explicitLogout = !!window.lpGuestReset?.isExplicitLogout?.();
      const cloudUserStillPresent =
        typeof lpLogin !== 'undefined' && !!lpLogin.getUser()?.isSupabaseUser;
      if (explicitLogout || cloudUserStillPresent) {
        window.lpGuestReset?.clearGuestLocalProgress?.();
        if (typeof lpLogin !== 'undefined') lpLogin.setUser(null);
        onAfterLogout?.();
      }
      window.lpGuestReset?.clearExplicitLogout?.();
      return;
    }

    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      return;
    }

    await processAuthSession(session, onAfterLogin, onAfterLogout, event);
  });
}
