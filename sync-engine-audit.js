// DeskFlow-only audit/repair helpers — not part of the shared sync-engine base.
import {
  computeLyricflowActivitySummary,
  enrichLyricflowSongEntry,
  recomputeProgressDocumentSummary,
} from './lp-progress-summary.js';
import * as lpSupabase from './lp-supabase.js';

const APPS = ['fluentflow', 'hubflow', 'lyricflow'];

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

/** Recompute stored summaries from raw content — fixes drift after catalog changes. */
export function repairLocalProjections() {
  let repaired = false;
  for (const app of APPS) {
    const key = `learnflow:progress:${app}:v1`;
    const doc = readRaw(key);
    if (!doc?.content) continue;
    if (recomputeProgressDocumentSummary(doc, app)) {
      doc.updatedAt = new Date().toISOString();
      writeRaw(key, doc);
      repaired = true;
    }
  }
  return repaired;
}

/** Compare stored summary vs recomputed values (no network). */
export function auditLocalProjections() {
  const report = {};
  for (const app of APPS) {
    const key = `learnflow:progress:${app}:v1`;
    const doc = readRaw(key);
    if (!doc) {
      report[app] = { status: 'missing' };
      continue;
    }
    const stored = { ...(doc.summary || {}) };
    const clone = JSON.parse(JSON.stringify(doc));
    recomputeProgressDocumentSummary(clone, app);
    report[app] = {
      status: 'ok',
      contentEntries: Object.keys(doc.content || {}).length,
      storedCompleted: stored.completedContent ?? null,
      recomputedCompleted: clone.summary?.completedContent ?? null,
      summaryDrift: stored.completedContent !== clone.summary?.completedContent,
    };
  }
  return report;
}

/** Compare local progress keys with Supabase rows for the signed-in user. */
export async function auditCloudAlignment() {
  const authed = await lpSupabase.isAuthenticated();
  if (!authed) return { ok: false, reason: 'not_authenticated' };

  const report = {};
  for (const app of APPS) {
    const key = `learnflow:progress:${app}:v1`;
    const doc = readRaw(key);
    const localIds = new Set(Object.keys(doc?.content || {}));
    const remoteRows = await lpSupabase.fetchProgress(app);
    if (remoteRows === null) {
      report[app] = { status: 'fetch_error' };
      continue;
    }
    const remoteIds = new Set(remoteRows.map((row) => row.content_id));
    const onlyLocal = [...localIds].filter((id) => !remoteIds.has(id));
    const onlyRemote = [...remoteIds].filter((id) => !localIds.has(id));
    const localCompleted = [...localIds].filter((id) => doc.content[id]?.completed).length;
    const remoteCompleted = remoteRows.filter((row) => row.completed).length;

    let localCompletedActivities = null;
    let remoteCompletedActivities = null;
    if (app === 'lyricflow') {
      const catalogTotal = doc?.summary?.totalContent || localIds.size;
      localCompletedActivities = computeLyricflowActivitySummary(doc.content, catalogTotal).completedActivities;
      const remoteContent = Object.fromEntries(
        remoteRows.map((row) => {
          const item = {
            contentId: row.content_id,
            contentType: row.content_type,
            progressPct: row.progress_pct,
            completed: row.completed,
            completedAt: row.completed_at,
            bestScorePct: row.best_score_pct,
            lastScorePct: row.last_score_pct,
            attempts: row.attempts,
            activities: row.activities || {},
          };
          enrichLyricflowSongEntry(row.content_id, item);
          return [row.content_id, item];
        }),
      );
      remoteCompletedActivities = computeLyricflowActivitySummary(
        remoteContent,
        catalogTotal || remoteRows.length,
      ).completedActivities;
    }

    report[app] = {
      status: 'ok',
      localEntries: localIds.size,
      remoteEntries: remoteIds.size,
      localCompleted,
      remoteCompleted,
      localCompletedActivities,
      remoteCompletedActivities,
      onlyLocal: onlyLocal.slice(0, 10),
      onlyRemote: onlyRemote.slice(0, 10),
      onlyLocalCount: onlyLocal.length,
      onlyRemoteCount: onlyRemote.length,
      pendingUpload: onlyLocal.length > 0,
      pendingDownload: onlyRemote.length > 0,
    };
  }
  return { ok: true, report };
}
