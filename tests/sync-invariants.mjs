#!/usr/bin/env node
// Invariantes del motor de sincronización — prueba compartida.
//
// Canónica en Learn/scripts/; copy-shared.sh la distribuye a tests/ de cada app
// vanilla. No editar las copias: el chequeo de deriva del build las revierte.
//
// Cada caso corresponde a un bug real de sync que llegó a producción y dejó
// dispositivos mostrando progreso distinto entre sí (auditorías de House &
// Rooms, 2026-08-15 y 2026-08-17).
//
// Son pruebas funcionales: importan sync-engine.js de verdad y lo ejecutan con
// localStorage/sessionStorage/window simulados. Lo único falso es
// lp-supabase.js — el vendor de supabase-js es un bundle de navegador que ni
// siquiera carga en Node 20 (pide WebSocket nativo), así que se sustituye por
// un stub controlable copiando el motor a un directorio temporal junto a él.
//
// Correr:  node tests/sync-invariants.mjs

import { existsSync, mkdtempSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Primer candidato existente; cada app guarda los compartidos en otra ruta. */
function locate(...candidates) {
  for (const rel of candidates) {
    const abs = resolve(HERE, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

// `js/` va PRIMERO a propósito. LyricFlow arrastra copias viejas de estos
// mismos archivos en su raíz (restos del layout anterior; index.html carga
// `./js/`), y con el orden inverso esta prueba corría contra un motor muerto
// que nadie despacha — pasando o fallando por razones que no existen en
// producción. DeskFlow es el único que de verdad los tiene en la raíz.
const enginePath = locate(
  '../js/sync-engine.js', // HubFlow, LyricFlow
  '../sync-engine.js', // DeskFlow
  './sync-engine.js' // Learn/scripts (canónico)
);
const summaryPath = locate(
  '../js/lp-progress-summary.js',
  '../lp-progress-summary.js',
  './lp-progress-summary.js'
);
// Dependencia transitiva de lp-progress-summary.js (catálogos de niveles).
const levelMapPath = locate('../js/lp-level-map.js', '../lp-level-map.js', './lp-level-map.js');

if (!enginePath || !summaryPath || !levelMapPath) {
  console.error('❌ No se encontró sync-engine.js / lp-progress-summary.js / lp-level-map.js junto a esta prueba.');
  process.exit(1);
}

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
  if (actual !== expected) {
    throw new Error(`${message} — esperado ${expected}, obtenido ${actual}`);
  }
}

// ── Entorno simulado ────────────────────────────────────────────────────────

/**
 * localStorage simulado. Claves como propiedades enumerables propias y métodos
 * como no enumerables, igual que un Storage real: el motor recorre el storage
 * con Object.keys(localStorage) en clearSyncRevisionCursors(), y con un stub
 * que exponga los métodos como propiedades normales recorrería
 * ['getItem','setItem',...] sin borrar nada — dando por buena una prueba que
 * en realidad no ejecutó nada.
 */
function makeStorage(seed = {}) {
  const ls = {};
  const define = (name, value) =>
    Object.defineProperty(ls, name, { value, enumerable: false, writable: true, configurable: true });

  define('getItem', (key) => (typeof ls[key] === 'string' ? ls[key] : null));
  define('setItem', (key, value) => { ls[key] = String(value); });
  define('removeItem', (key) => { delete ls[key]; });
  define('clear', () => { for (const k of Object.keys(ls)) delete ls[k]; });
  define('key', (i) => Object.keys(ls)[i] ?? null);
  Object.defineProperty(ls, 'length', {
    get: () => Object.keys(ls).length,
    enumerable: false,
    configurable: true,
  });

  for (const [key, value] of Object.entries(seed)) ls[key] = String(value);
  return ls;
}

function installEnvironment(seed = {}) {
  globalThis.localStorage = makeStorage(seed);
  globalThis.sessionStorage = makeStorage();
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    setInterval: (fn, ms) => setInterval(fn, ms),
  };
  globalThis.document = {
    visibilityState: 'visible',
    documentElement: { dataset: {}, removeAttribute() {} },
    addEventListener() {},
  };
  return globalThis.localStorage;
}

// ── Motor real + lp-supabase falso, en un directorio temporal ───────────────

const sandbox = mkdtempSync(join(tmpdir(), 'lp-sync-invariants-'));
copyFileSync(enginePath, join(sandbox, 'sync-engine.js'));
copyFileSync(summaryPath, join(sandbox, 'lp-progress-summary.js'));
copyFileSync(levelMapPath, join(sandbox, 'lp-level-map.js'));
writeFileSync(
  join(sandbox, 'lp-supabase.js'),
  `export const __mock = {};
const call = (name, fallback) => (...args) =>
  (typeof __mock[name] === 'function' ? __mock[name](...args) : fallback);
export const isAuthenticated = async (...a) => call('isAuthenticated', true)(...a);
export const getUserId = async (...a) => call('getUserId', 'user-a')(...a);
export const fetchProgress = async (...a) => call('fetchProgress', [])(...a);
export const fetchActivityEvents = async (...a) => call('fetchActivityEvents', [])(...a);
export const fetchScoreKeyBests = async (...a) => call('fetchScoreKeyBests', [])(...a);
export const fetchInvalidations = async (...a) => call('fetchInvalidations', [])(...a);
export const fetchSyncRevision = async (...a) => call('fetchSyncRevision', 0)(...a);
export const syncProgress = async (...a) => call('syncProgress', { synced: true })(...a);
export const syncActivityEvents = async (...a) => call('syncActivityEvents', { synced: true, count: 0 })(...a);
export const updateUserStreakOnce = async (...a) => call('updateUserStreakOnce', null)(...a);
`
);

const supabaseUrl = pathToFileURL(join(sandbox, 'lp-supabase.js')).href;
const engineUrl = pathToFileURL(join(sandbox, 'sync-engine.js')).href;
const { __mock } = await import(supabaseUrl);

let engineInstance = 0;

/** Documento de progreso mínimo — basta para que hasLocalStatsCache() dé true. */
const SEED_LOCAL_PROGRESS = {
  'learnflow:progress:hubflow:v1': JSON.stringify({
    schemaVersion: 1,
    app: 'hubflow',
    updatedAt: '2026-01-01T00:00:00.000Z',
    content: { 'vocab-house': { contentId: 'vocab-house', progressPct: 10, completed: false } },
  }),
};

/**
 * Instancia fresca del motor. `downloaded` / `cloudHydrated` son estado de
 * módulo, así que sin el query de cache-busting la segunda prueba heredaría
 * el "ya bajé todo" de la primera y no ejecutaría nada.
 *
 * `hydrated:true` deja el motor en el estado en el que de verdad vive el gate
 * de revisión: con caché local ya publicada (markLocalCacheBootstrapped, que
 * es lo que hace lp-auth-setup.js en la rama rápida de INITIAL_SESSION). Sin
 * eso, checkAndRefresh se va por la rama `!cloudHydrated` — que pullea
 * siempre, sin tocar el cursor — y la prueba no ejercitaría nada.
 */
async function freshEngine(seed = {}, { hydrated = false } = {}) {
  installEnvironment(hydrated ? { ...SEED_LOCAL_PROGRESS, ...seed } : seed);
  for (const key of Object.keys(__mock)) delete __mock[key];
  engineInstance += 1;
  const engine = await import(`${engineUrl}?instance=${engineInstance}`);
  if (hydrated) engine.markLocalCacheBootstrapped();
  return engine;
}

const REVISION_KEY = (userId) => `lp-sync-revision:${userId}:vanilla`;

// ── Invariantes ─────────────────────────────────────────────────────────────

// Bug: refreshFromCloudIfNeeded devolvía refreshed:true incluso cuando
// downloadOnLogin cortó con hadFetchError (o con reason:'timeout'), porque
// ambos salen con hydrated:true si hay caché local. checkAndRefresh escribía
// entonces la revisión, el dispositivo pasaba a responder up_to_date, y esa
// escritura del peer no se volvía a pedir NUNCA.
await check('un pull con fetch_error no avanza el cursor de revisión', async () => {
  const engine = await freshEngine({}, { hydrated: true });
  __mock.fetchSyncRevision = () => 7;
  __mock.fetchProgress = () => null; // fetch_error: sesión en carrera / red caída
  __mock.fetchActivityEvents = () => null;

  await engine.checkAndRefresh();

  assertEqual(
    localStorage.getItem(REVISION_KEY('user-a')),
    null,
    'un pull fallido dejó el cursor escrito'
  );

  // Y el próximo intento tiene que volver a pullear, no decir "al día".
  __mock.fetchProgress = () => [];
  __mock.fetchActivityEvents = () => [];
  const retry = await engine.checkAndRefresh();
  assert(retry.reason !== 'up_to_date', 'el reintento se saltó el pull');
});

// Contracara del anterior: un pull limpio sí cierra el ciclo, o cada poll de
// 25s volvería a bajar progress + activity_events de las 3 apps para nada.
await check('un pull completo avanza el cursor y el siguiente check no pullea', async () => {
  const engine = await freshEngine({}, { hydrated: true });
  __mock.fetchSyncRevision = () => 7;
  __mock.fetchProgress = () => [];
  __mock.fetchActivityEvents = () => [];

  await engine.checkAndRefresh();
  assertEqual(
    localStorage.getItem(REVISION_KEY('user-a')),
    '7',
    'un pull completo no registró la revisión'
  );

  const again = await engine.checkAndRefresh();
  assertEqual(again.reason, 'up_to_date', 'volvió a pullear con la revisión al día');
});

// Bug: `lp-sync-revision` era una clave global compartida por los dos motores
// (este y el de FluentFlow) sobre el mismo origin y el mismo localStorage.
// FluentFlow solo pullea `fluentflow`, pero marcaba la revisión como vista y
// dejaba a HubFlow/LyricFlow/DeskFlow en up_to_date sin haber bajado lo suyo.
await check('la clave global vieja no silencia el pull de este motor', async () => {
  const engine = await freshEngine({ 'lp-sync-revision': '99' }, { hydrated: true });
  __mock.fetchSyncRevision = () => 7;
  __mock.fetchProgress = () => [];
  __mock.fetchActivityEvents = () => [];

  const result = await engine.checkAndRefresh();

  assert(result.reason !== 'up_to_date', 'la clave global legacy silenció el pull');
  assertEqual(
    localStorage.getItem('lp-sync-revision'),
    null,
    'la clave global legacy sobrevivió'
  );
});

// Bug: sync_cursor.revision es POR USUARIO. Con la clave global, otra cuenta
// en el mismo navegador con una revisión más baja daba "al día" de arranque y
// ese dispositivo no pulleaba jamás.
await check('el cursor es por usuario: otra cuenta con revisión menor igual pullea', async () => {
  const engine = await freshEngine({ [REVISION_KEY('user-a')]: '99' }, { hydrated: true });
  __mock.getUserId = () => 'user-b';
  __mock.fetchSyncRevision = () => 7;
  __mock.fetchProgress = () => [];
  __mock.fetchActivityEvents = () => [];

  const result = await engine.checkAndRefresh();

  assert(result.reason !== 'up_to_date', 'el cursor de otra cuenta silenció el pull');
  assertEqual(localStorage.getItem(REVISION_KEY('user-b')), '7', 'no registró el cursor de user-b');
  assertEqual(
    localStorage.getItem(REVISION_KEY('user-a')),
    '99',
    'pisó el cursor de la otra cuenta'
  );
});

await check('resetDownloadState borra los cursores de revisión', async () => {
  const engine = await freshEngine({
    [REVISION_KEY('user-a')]: '10',
    [REVISION_KEY('user-b')]: '20',
    'lp-sync-revision': '30',
  });

  engine.resetDownloadState();

  assertEqual(localStorage.getItem(REVISION_KEY('user-a')), null, 'quedó el cursor de user-a');
  assertEqual(localStorage.getItem(REVISION_KEY('user-b')), null, 'quedó el cursor de user-b');
  assertEqual(localStorage.getItem('lp-sync-revision'), null, 'quedó la clave global');
});

// Bug: mergeActivityEvents hacía .slice(0, 200) sobre la unión local+remoto
// ordenada por fecha, y syncApp sube DESPUÉS lo que ese merge dejó escrito.
// Un evento propio que todavía no había llegado a la nube y quedaba fuera del
// top-200 se borraba antes de subirse — y activity_events es el único
// portador de metrics.scoreKey, del que score_key_bests (migración 027)
// deriva la matriz categoría × modo. De ahí "el otro dispositivo muestra
// menos categorías ganadas de las que realmente tiene".
await check('un evento local sin subir sobrevive a 200 eventos remotos más nuevos', async () => {
  const app = 'hubflow';
  const pendingEvent = {
    eventId: 'local-pendiente',
    runId: 'local-pendiente',
    app,
    contentId: 'vocab-house',
    title: 'House & Rooms',
    activity: 'quiz',
    eventType: 'attempt_completed',
    occurredAt: '2020-01-01T00:00:00.000Z', // el más viejo de todos
    scorePct: 100,
    passed: true,
    metrics: { scoreKey: 'vocab-house-quiz' },
  };

  const engine = await freshEngine({
    [`learnflow:activity:${app}:v1`]: JSON.stringify({
      schemaVersion: 1,
      app,
      updatedAt: '2020-01-01T00:00:00.000Z',
      events: [pendingEvent],
    }),
  });

  // 200 eventos remotos, todos más nuevos que el local.
  const remoteRows = Array.from({ length: 200 }, (_, i) => ({
    event_id: `remoto-${i}`,
    run_id: `remoto-${i}`,
    app,
    content_id: 'vocab-house',
    title: 'House & Rooms',
    activity: 'quiz',
    event_type: 'attempt_completed',
    // Un minuto de separación entre eventos: con segundos "00".."199" el
    // String(i).padStart daría fechas inválidas y normalizeIsoDate las
    // descartaría en silencio, dejando la prueba sin los 200 remotos que
    // necesita para empujar al local fuera de la ventana.
    occurred_at: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
    score_pct: 50,
    passed: false,
    duration_ms: null,
    metrics: { scoreKey: 'vocab-house-quiz' },
  }));

  __mock.fetchActivityEvents = (which) => (which === app ? remoteRows : []);
  __mock.fetchProgress = () => [];

  await engine.downloadOnLogin({ force: true });

  const stored = JSON.parse(localStorage.getItem(`learnflow:activity:${app}:v1`));
  const ids = stored.events.map((event) => event.eventId);
  assert(
    ids.includes('local-pendiente'),
    'el evento local sin subir se podó por la ventana de 200 antes de llegar a la nube'
  );
  // La ventana sigue acotada: lo pendiente no la agranda, desplaza al evento
  // ya sincronizado más viejo — ése sí se puede recuperar de la nube.
  assertEqual(ids.length, 200, 'la ventana del ledger dejó de estar acotada');
  assert(!ids.includes('remoto-0'), 'no desplazó al evento sincronizado más viejo');
});

// ── Salida ──────────────────────────────────────────────────────────────────

rmSync(sandbox, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n❌ ${failures.length} invariante(s) de sync rotos:\n`);
  for (const { name, message } of failures) console.error(`  · ${name}\n    ${message}`);
  process.exit(1);
}

console.log(`✅ ${passed} invariantes de sync OK`);
