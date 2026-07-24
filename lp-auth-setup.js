import * as lpSupabase from './lp-supabase.js';
import {
  downloadOnLogin,
  runFullSync,
  resetDownloadState,
  setupMultiSessionSync,
  markStatsDisplayReady,
} from './sync-engine.js';

window.lpSupabase = lpSupabase;

let authListenerRegistered = false;
let authHandlerInFlight = null;
let lastHandledUserId = null;

async function hydrateFromCloud(onAfterLogin, { forceDownload = false } = {}) {
  const result = await downloadOnLogin({ force: forceDownload });
  if (!result.hydrated) return result;
  onAfterLogin?.();
  await runFullSync({ force: true });
  return result;
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
    if (typeof lpLogin !== 'undefined' && !window.lpGuestReset?.hasLocalSupabaseIdentity?.()) {
      lpLogin.setUserFromSupabase(session.user, profile);
    }
    await hydrateFromCloud(onAfterLogin, { forceDownload });
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

  const oauthReturn = !!lpSupabase.isOAuthReturnUrl?.();
  const forceDownload =
    event === 'SIGNED_IN' ||
    (event === 'INITIAL_SESSION' && oauthReturn) ||
    (event === 'INITIAL_SESSION' && !!window.lpGuestReset?.shouldForceCloudDownload?.());

  if (event === 'SIGNED_IN' || forceDownload) {
    resetDownloadState();
  }

  if (
    event === 'INITIAL_SESSION' &&
    !forceDownload &&
    lastHandledUserId === session.user.id
  ) {
    lpSupabase.cleanAuthParamsFromUrl?.();
    return;
  }

  await handleLogin(session, onAfterLogin, { forceDownload });
}

function setupCrossTabLogoutListener() {
  window.addEventListener('lp-explicit-logout', () => {
    void clearOrphanSupabaseSession();
  });
}

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
