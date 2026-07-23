import * as lpSupabase from './lp-supabase.js';
import { downloadOnLogin, runFullSync, resetDownloadState } from './sync-engine.js';

window.lpSupabase = lpSupabase;

let authListenerRegistered = false;

async function hydrateFromCloud(onAfterLogin, { forceDownload = false } = {}) {
  const result = await downloadOnLogin({ force: forceDownload });
  if (!result.hydrated) return result;
  await runFullSync({ force: true });
  onAfterLogin?.();
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

  lpSupabase.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' || !session?.user) {
      resetDownloadState();
      window.lpGuestReset?.clearExplicitLogout?.();
      if (typeof lpLogin !== 'undefined' && lpLogin.getUser()?.isSupabaseUser) {
        if (window.lpGuestReset?.clearGuestLocalProgress) {
          window.lpGuestReset.clearGuestLocalProgress();
        }
        lpLogin.setUser(null);
        onAfterLogout?.();
      }
      return;
    }

    if (window.lpGuestReset?.shouldRejectSession?.()) {
      await clearOrphanSupabaseSession();
      window.lpGuestReset?.clearExplicitLogout?.();
      return;
    }

    const forceDownload =
      event === 'SIGNED_IN' || !!window.lpGuestReset?.shouldForceCloudDownload?.();

    if (event === 'SIGNED_IN' || forceDownload) {
      resetDownloadState();
    }

    await handleLogin(session, onAfterLogin, { forceDownload });
  });

  lpSupabase.isAuthenticated().then(async (authed) => {
    if (!authed) return;

    if (window.lpGuestReset?.shouldRejectSession?.()) {
      await clearOrphanSupabaseSession();
      window.lpGuestReset?.clearExplicitLogout?.();
      return;
    }

    const forceDownload = !!window.lpGuestReset?.shouldForceCloudDownload?.();
    if (forceDownload) {
      resetDownloadState();
      const {
        data: { session },
      } = await lpSupabase.getSession();
      if (session?.user) {
        await handleLogin(session, onAfterLogin, { forceDownload: true });
        return;
      }
    }

    await hydrateFromCloud(onAfterLogin);
  });
}
