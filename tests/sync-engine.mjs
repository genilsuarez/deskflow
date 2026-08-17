#!/usr/bin/env node
// sync-engine.js — ciclo pull-merge-push contra Supabase.
//
// Específico de DeskFlow (no lo distribuye copy-shared.sh).
//
// Cubre la ronda 8: la poda del ledger de actividad. Los huérfanos se
// reinstalaban solos porque syncApp() subía learnflow:activity:<app>:v1 entero,
// y activity_events es append-only en Supabase (migración 003) — una fila
// huérfana subida solo se quita con una migración server-side. La regresión
// llegó a producción dos veces antes de detectarse.
//
// lp-supabase.js se sustituye por un stub vía loader (ver helpers/): el módulo
// real importa el SDK por https y Node no lo resuelve.
//
// Correr:  node tests/sync-engine.mjs

import { register } from 'node:module';

register('./helpers/supabase-loader.mjs', import.meta.url);

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (error) {
    failures.push({ name, message: error.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message} — esperado ${expected}, obtenido ${actual}`);
}

function assertSameSet(actual, expected, message) {
  const a = [...new Set(actual)].sort().join(',');
  const b = [...new Set(expected)].sort().join(',');
  if (a !== b) throw new Error(`${message} — esperado [${b}], obtenido [${a}]`);
}

function installStorage(seed = {}) {
  const ls = {};
  const define = (name, value) =>
    Object.defineProperty(ls, name, { value, enumerable: false, writable: true, configurable: true });
  define('getItem', (key) => (typeof ls[key] === 'string' ? ls[key] : null));
  define('setItem', (key, value) => { ls[key] = String(value); });
  define('removeItem', (key) => { delete ls[key]; });
  define('key', (i) => Object.keys(ls)[i] ?? null);
  Object.defineProperty(ls, 'length', { get: () => Object.keys(ls).length, enumerable: false, configurable: true });
  for (const [key, value] of Object.entries(seed)) ls[key] = String(value);
  globalThis.localStorage = ls;
  return ls;
}

// sync-engine toca window/document/BroadcastChannel al cargarse.
globalThis.window = {
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  location: { href: 'https://example.test/deskflow/' },
};
globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
globalThis.BroadcastChannel = class { postMessage() {} close() {} };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
installStorage();

const stub = await import('./helpers/supabase-stub.mjs');
const sync = await import('../sync-engine.js');

const iso = () => new Date().toISOString();
const catalogKey = (app) => `learnflow:catalog:${app}:v1`;
const catalogValue = (ids) => JSON.stringify({ totalContent: ids.length, ids, updatedAt: iso() });

function localEvent(contentId, n) {
  return {
    eventId: `local-${contentId}-${n}`, runId: `run-${contentId}-${n}`, app: 'hubflow',
    contentId, title: contentId, activity: 'practice', eventType: 'attempt_completed',
    occurredAt: iso(), scorePct: 90, passed: true, metrics: {},
  };
}

function remoteEventRow(contentId, n) {
  return {
    event_id: `remote-${contentId}-${n}`, run_id: `rrun-${contentId}-${n}`, app: 'hubflow',
    content_id: contentId, title: contentId, activity: 'practice',
    event_type: 'attempt_completed', occurred_at: '2026-07-24T01:07:27+00:00',
    score_pct: 90, passed: true, duration_ms: null, metrics: {},
  };
}

function contentEntry(id, completed = false) {
  return {
    contentId: id, contentType: 'module', progressPct: completed ? 100 : 0,
    completed, completedAt: completed ? iso() : null,
    bestScorePct: completed ? 100 : null, attempts: completed ? 1 : 0,
  };
}

function progressDoc(app, ids, completedIds = []) {
  return JSON.stringify({
    schemaVersion: 1, app, updatedAt: iso(), catalogVersion: 'test',
    summary: { progressPct: 0, completedContent: 0, totalContent: 0, attemptedContent: 0 },
    content: Object.fromEntries(ids.map((id) => [id, contentEntry(id, completedIds.includes(id))])),
  });
}

function activityDoc(app, events) {
  return JSON.stringify({ schemaVersion: 1, app, updatedAt: iso(), events });
}

/** Deja el motor listo para un runFullSync: hidratado y sin cooldown. */
async function primeSync(seed) {
  stub.reset();
  const store = installStorage(seed);
  sync.resetDownloadState();
  await sync.downloadOnLogin({ force: true });
  return store;
}

// ── El ledger local no debe subir eventos huérfanos ─────────────────────────

await check('no sube eventos de contenido fuera del catálogo', async () => {
  await primeSync({
    [catalogKey('hubflow')]: catalogValue(['h1', 'h2']),
    'learnflow:progress:hubflow:v1': progressDoc('hubflow', ['h1', 'h2'], ['h1']),
    'learnflow:activity:hubflow:v1': activityDoc('hubflow', [
      localEvent('h1', 1),
      localEvent('vocab-pack-viejo', 1),
      localEvent('h2', 1),
    ]),
  });
  await sync.runFullSync({ force: true });

  const uploaded = stub.uploads.activity.filter((u) => u.app === 'hubflow');
  assert(uploaded.length > 0, 'debería haber intentado subir actividad de hubflow');
  const ids = uploaded.flatMap((u) => u.contentIds);
  assert(!ids.includes('vocab-pack-viejo'), 'el evento huérfano no debe subirse');
  assertSameSet(ids, ['h1', 'h2'], 'solo deben subirse eventos del catálogo');
});

await check('el ledger local se auto-limpia de huérfanos', async () => {
  const store = await primeSync({
    [catalogKey('hubflow')]: catalogValue(['h1']),
    'learnflow:progress:hubflow:v1': progressDoc('hubflow', ['h1']),
    'learnflow:activity:hubflow:v1': activityDoc('hubflow', [
      localEvent('h1', 1),
      localEvent('confusing-words', 1),
    ]),
  });
  await sync.runFullSync({ force: true });

  const ledger = JSON.parse(store['learnflow:activity:hubflow:v1']);
  const ids = ledger.events.map((e) => e.contentId);
  assert(!ids.includes('confusing-words'), 'el huérfano debe salir del ledger local');
  assert(ids.includes('h1'), 'el evento válido debe permanecer');
});

await check('los huérfanos que bajan de la nube no se reinstalan en el ledger', async () => {
  const store = await primeSync({
    [catalogKey('hubflow')]: catalogValue(['h1']),
    'learnflow:progress:hubflow:v1': progressDoc('hubflow', ['h1']),
  });
  // Segunda pasada: ahora la nube devuelve eventos, incluido uno huérfano.
  stub.remote.activity.hubflow = [remoteEventRow('h1', 1), remoteEventRow('vocabulary', 1)];
  sync.resetDownloadState();
  await sync.downloadOnLogin({ force: true });

  const raw = store['learnflow:activity:hubflow:v1'];
  const ids = raw ? JSON.parse(raw).events.map((e) => e.contentId) : [];
  assert(!ids.includes('vocabulary'),
    'un huérfano bajado de la nube no debe quedar en el ledger — el próximo sync lo re-subiría');
});

// ── El progreso tampoco debe subir huérfanos ────────────────────────────────

await check('no sube content_ids fuera del catálogo', async () => {
  await primeSync({
    [catalogKey('hubflow')]: catalogValue(['h1', 'h2']),
    'learnflow:progress:hubflow:v1': progressDoc('hubflow', ['h1', 'h2', 'vocab-pack-viejo'], ['h1']),
  });
  await sync.runFullSync({ force: true });

  const uploaded = stub.uploads.progress.filter((u) => u.app === 'hubflow');
  assert(uploaded.length > 0, 'debería haber intentado subir progreso de hubflow');
  const ids = uploaded.flatMap((u) => u.contentIds);
  assert(!ids.includes('vocab-pack-viejo'), 'el content_id huérfano no debe subirse');
});

await check('el merge de la nube no reintroduce huérfanos en el progreso', async () => {
  const store = await primeSync({
    [catalogKey('hubflow')]: catalogValue(['h1']),
    'learnflow:progress:hubflow:v1': progressDoc('hubflow', ['h1']),
  });
  stub.remote.progress.hubflow = [
    { content_id: 'h1', content_type: 'module', progress_pct: 100, completed: true,
      completed_at: '2026-07-24T01:07:27+00:00', best_score_pct: 90, attempts: 1, activities: {} },
    { content_id: 'vocab-pack-viejo', content_type: 'module', progress_pct: 100, completed: true,
      completed_at: '2026-07-24T01:07:27+00:00', best_score_pct: 90, attempts: 1, activities: {} },
  ];
  sync.resetDownloadState();
  await sync.downloadOnLogin({ force: true });

  const doc = JSON.parse(store['learnflow:progress:hubflow:v1']);
  assert(!('vocab-pack-viejo' in doc.content), 'el huérfano de la nube debe podarse al mergear');
  assertEqual(doc.summary.totalContent, 1, 'el total sigue siendo el del catálogo');
  assertEqual(doc.summary.completedContent, 1, 'el huérfano completado no debe contar');
});

// ── Reset por app: borrar en el servidor NO alcanza ────────────────────────

await check('un borrado server-side no sobrevive si queda progreso local', async () => {
  // Caracterización, no aspiración: documenta por qué la migración 022 necesita
  // un script de consola además del SQL. upsert_progress_merge es monotónico
  // (`completed = completed OR excluded.completed`), así que vaciar las filas en
  // Supabase sin limpiar el cliente no resetea nada — el siguiente ciclo las
  // re-sube. Pasó en producción con la 021, dos veces.
  //
  // Si esta prueba falla porque el sync ahora respeta los borrados remotos, es
  // un cambio de diseño deliberado: actualizar también docs/progress-counting-system.md
  // y el encabezado de 022_reset_hubflow_progress_genil.sql.
  await primeSync({
    [catalogKey('hubflow')]: catalogValue(['h1', 'h2']),
    // La nube queda vacía: simula el DELETE ya ejecutado en Supabase.
    'learnflow:progress:hubflow:v1': progressDoc('hubflow', ['h1', 'h2'], ['h1']),
  });
  await sync.runFullSync({ force: true });

  const ids = stub.uploads.progress.filter((u) => u.app === 'hubflow').flatMap((u) => u.contentIds);
  assert(ids.includes('h1'),
    'el cliente re-sube lo que el servidor borró — por eso el reset exige limpiar el localStorage');
});

await check('con el local limpio y la nube vacía el progreso no reaparece', async () => {
  // El estado después del script de consola de la 022: de HubFlow solo sobrevive
  // la clave de catálogo. Nada debe reconstruir progreso a partir de ella.
  //
  // FluentFlow se siembra con progreso a propósito: si el ciclo de sync no
  // corriera, HubFlow daría cero igual y la prueba pasaría sin probar nada.
  // Que FluentFlow sí suba es lo que demuestra que el motor se ejecutó.
  const store = await primeSync({
    [catalogKey('hubflow')]: catalogValue(['h1', 'h2']),
    [catalogKey('fluentflow')]: catalogValue(['f1']),
    'learnflow:progress:fluentflow:v1': progressDoc('fluentflow', ['f1'], ['f1']),
  });
  await sync.runFullSync({ force: true });

  const subioFluent = stub.uploads.progress.filter((u) => u.app === 'fluentflow').flatMap((u) => u.contentIds);
  assertSameSet(subioFluent, ['f1'], 'testigo: el ciclo de sync corrió de verdad');

  const raw = store['learnflow:progress:hubflow:v1'];
  const completados = raw
    ? Object.values(JSON.parse(raw).content ?? {}).filter((c) => c.completed).length
    : 0;
  assertEqual(completados, 0, 'no debe aparecer progreso de la nada');

  const ids = stub.uploads.progress.filter((u) => u.app === 'hubflow').flatMap((u) => u.contentIds);
  assertEqual(ids.length, 0, 'sin progreso local no hay nada que subir');
});

// ── Sin catálogo: fail-open, no borrar datos del usuario ───────────────────

await check('sin clave de catálogo no descarta eventos (fail-open)', async () => {
  await primeSync({
    'learnflow:progress:hubflow:v1': progressDoc('hubflow', ['h1']),
    'learnflow:activity:hubflow:v1': activityDoc('hubflow', [localEvent('h1', 1), localEvent('desconocido', 1)]),
  });
  await sync.runFullSync({ force: true });

  const ids = stub.uploads.activity.filter((u) => u.app === 'hubflow').flatMap((u) => u.contentIds);
  assertSameSet(ids, ['h1', 'desconocido'],
    'sin catálogo debe subir todo: filtrar acá perdería progreso legítimo');
});

// ── score_key_bests: el detalle granular no puede depender de los 200 ──────
//
// Las claves de score-history de HubFlow (vocab-<cat>-<modo>) solo se
// reconstruyen desde activity_events, y fetchActivityEvents está capado a los
// 200 eventos más recientes. Medido 2026-08-17: 686 eventos en la nube, 87
// scoreKeys, 34 reconstruibles → House & Rooms marcaba 2/8 con 8/8 ganado.
// La migración 027 agrega el máximo por scoreKey, acotado por catálogo.

await check('cachea score_key_bests de hubflow al hidratar', async () => {
  stub.reset();
  const store = installStorage({
    [catalogKey('hubflow')]: catalogValue(['h1']),
    'learnflow:progress:hubflow:v1': progressDoc('hubflow', ['h1']),
  });
  stub.remote.scoreKeyBests.hubflow = [
    { contentId: 'h1', scoreKey: 'vocab-kitchen-quiz', bestScorePct: 90, lastOccurredAt: iso() },
    { contentId: 'h1', scoreKey: 'vocab-kitchen-match', bestScorePct: 100, lastOccurredAt: iso() },
  ];
  sync.resetDownloadState();
  await sync.downloadOnLogin({ force: true });

  const bests = sync.readScoreKeyBests('hubflow');
  assertEqual(bests['vocab-kitchen-quiz'], 90, 'debe cachear el mejor puntaje por scoreKey');
  assertEqual(bests['vocab-kitchen-match'], 100, 'debe cachear todas las claves devueltas');
  assert(store['learnflow:score-key-bests:hubflow:v1'], 'debe persistir la caché en localStorage');
});

await check('no pide score_key_bests para apps que no lo usan', async () => {
  stub.reset();
  installStorage({ 'learnflow:progress:lyricflow:v1': progressDoc('lyricflow', ['s1']) });
  stub.remote.scoreKeyBests.lyricflow = [
    { contentId: 's1', scoreKey: 'no-deberia-guardarse', bestScorePct: 100, lastOccurredAt: iso() },
  ];
  sync.resetDownloadState();
  await sync.downloadOnLogin({ force: true });

  assertEqual(Object.keys(sync.readScoreKeyBests('lyricflow')).length, 0,
    'solo HubFlow reconstruye claves de score-history');
});

await check('si la RPC falla, la hidratación igual completa', async () => {
  stub.reset();
  installStorage({
    [catalogKey('hubflow')]: catalogValue(['h1']),
    'learnflow:progress:hubflow:v1': progressDoc('hubflow', ['h1']),
  });
  // Emula la migración 027 sin aplicar: fetchScoreKeyBests devuelve null.
  const original = stub.remote.scoreKeyBests;
  Object.defineProperty(stub.remote, 'scoreKeyBests', {
    get() { throw new Error('rpc missing'); }, configurable: true,
  });
  let result;
  try {
    sync.resetDownloadState();
    result = await sync.downloadOnLogin({ force: true });
  } finally {
    Object.defineProperty(stub.remote, 'scoreKeyBests',
      { value: original, writable: true, configurable: true, enumerable: true });
  }

  assert(result.hydrated,
    'un fallo de score_key_bests no puede dejar cloudHydrated=false — rompería todo el sync');
});

// ── Reporte ────────────────────────────────────────────────────────────────

console.log('');
if (failures.length === 0) {
  console.log(`✅ Sync engine — ${passed}/${passed} OK`);
  process.exit(0);
}
console.log(`❌ Sync engine — ${passed} OK, ${failures.length} fallo(s)`);
for (const f of failures) {
  console.log(`   ✗ ${f.name}`);
  console.log(`     ${f.message}`);
}
console.log('');
console.log('   Contexto: docs/progress-counting-system.md');
process.exit(1);
