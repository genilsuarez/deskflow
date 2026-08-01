#!/usr/bin/env node
// progress-reader.js — pipeline de lectura del portal: repara, poda, valida y
// arma el resumen que app.js renderiza como "X de Y".
//
// Específico de DeskFlow (no lo distribuye copy-shared.sh).
//
// Las pruebas de invariantes cubren lp-progress-summary.js; acá se cubre lo que
// solo hace el reader: reparación de documentos, migración de claves legacy,
// rechazo de basura, y el contrato de resumen del que depende app.js.
//
// Correr:  node tests/progress-reader.mjs

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
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

const iso = () => new Date().toISOString();
const catalogKey = (app) => `learnflow:catalog:${app}:v1`;
const catalogValue = (ids) => JSON.stringify({ totalContent: ids.length, ids, updatedAt: iso() });

function songEntry(id, completedActivities = []) {
  const done = new Set(completedActivities);
  const activity = (name) => ({
    completed: done.has(name),
    completedAt: done.has(name) ? iso() : null,
    bestScorePct: done.has(name) ? 100 : null,
    lastScorePct: done.has(name) ? 100 : null,
    attempts: done.has(name) ? 1 : 0,
    lastAttemptAt: done.has(name) ? iso() : null,
    lastRunId: null,
  });
  return {
    contentId: id,
    contentType: 'song',
    progressPct: done.size * 25,
    completed: done.size === 4,
    completedAt: done.size === 4 ? iso() : null,
    bestScorePct: done.size ? 100 : null,
    attempts: done.size,
    activities: {
      listen: { ...activity('listen'), coveragePct: 0, eligibleDurationSec: 0, coveredDurationSec: 0, coverageRanges: [] },
      dictation: activity('dictation'),
      challenge: activity('challenge'),
      quiz: activity('quiz'),
    },
  };
}

function contentEntry(id, { completed = false, attempts = 0, completedAt = null } = {}) {
  return {
    contentId: id,
    contentType: 'module',
    progressPct: completed ? 100 : 0,
    completed,
    completedAt: completed ? (completedAt ?? iso()) : null,
    bestScorePct: completed ? 100 : null,
    attempts,
  };
}

function doc(app, content, extra = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    app,
    updatedAt: iso(),
    catalogVersion: 'test',
    summary: { progressPct: 0, completedContent: 0, totalContent: 0, attemptedContent: 0 },
    content,
    ...extra,
  });
}

installStorage();
const { ProgressReader, STATUS } = await import('../progress-reader.js');
const read = (app) => new ProgressReader(globalThis.localStorage).readApp(app);

// ── 1. El contrato del que depende app.js ───────────────────────────────────
// progressDisplayMetrics() usa summary.totalActivities para LyricFlow y, si es
// 0 o null, cae al fallback de totalContent — mostrando canciones (9) en vez de
// actividades (36). El reader debe entregar siempre totalActivities.

check('LyricFlow con progreso real trae totalActivities, no solo totalContent', () => {
  const songs = ['s1', 's2', 's3'];
  installStorage({
    [catalogKey('lyricflow')]: catalogValue(songs),
    'learnflow:progress:lyricflow:v1': doc('lyricflow', {
      s1: songEntry('s1', ['listen', 'quiz']),
      s2: songEntry('s2', ['listen']),
      s3: songEntry('s3'),
    }),
  });
  const s = read('lyricflow').progress.data.summary;
  assertEqual(s.totalActivities, 12, 'totalActivities = 3 canciones x 4');
  assertEqual(s.completedActivities, 3, 'actividades completadas');
  assert(s.totalActivities > 0, 'si es 0, app.js cae al fallback y muestra canciones');
});

check('HubFlow con progreso real trae el resumen de actividades', () => {
  installStorage({
    [catalogKey('hubflow')]: catalogValue(['h1', 'h2']),
    'learnflow:progress:hubflow:v1': doc('hubflow', {
      h1: contentEntry('h1', { completed: true, attempts: 2 }),
      h2: contentEntry('h2', { attempts: 1 }),
    }),
  });
  const s = read('hubflow').progress.data.summary;
  assertEqual(s.totalContent, 2, 'totalContent del catálogo');
  assertEqual(s.completedContent, 1, 'completados');
});

// ── 2. La poda llega hasta el resumen que se renderiza ──────────────────────
// El bug visible era "40 de 84": el portal contaba ids que ya no existen.

check('los huérfanos no llegan al resumen renderizado', () => {
  installStorage({
    [catalogKey('hubflow')]: catalogValue(['h1', 'h2']),
    'learnflow:progress:hubflow:v1': doc('hubflow', {
      h1: contentEntry('h1', { completed: true }),
      h2: contentEntry('h2'),
      'vocab-pack-viejo': contentEntry('vocab-pack-viejo', { completed: true }),
    }),
  });
  const result = read('hubflow');
  assertEqual(result.progress.data.summary.totalContent, 2, 'total = catálogo');
  assertEqual(result.progress.data.summary.completedContent, 1, 'el huérfano completado no cuenta');
  assert(!('vocab-pack-viejo' in result.progress.data.content), 'el huérfano no debe exponerse');
});

check('FluentFlow: el total del catálogo gana sobre el content map inflado', () => {
  // Sin clave de catálogo (así no hay poda) pero con catalogTotalContent: el
  // content map queda en 4 y el total debe seguir siendo 3. Es el único montaje
  // que distingue el total reparado del que fluentflowSummary calcula por su
  // cuenta sobre el content crudo — con poda ambos coinciden y la prueba no
  // verifica nada.
  installStorage({
    'learnflow:progress:fluentflow:v1': doc('fluentflow', {
      'reading-a1': contentEntry('reading-a1', { completed: true }),
      'quiz-a1': contentEntry('quiz-a1', { completed: true }),
      'reading-a2': contentEntry('reading-a2'),
      'modulo-eliminado-a1': contentEntry('modulo-eliminado-a1', { completed: true }),
    }, { catalogTotalContent: 3 }),
  });
  const s = read('fluentflow').progress.data.summary;
  assertEqual(s.totalContent, 3, 'totalContent = catalogTotalContent, no el content map (4)');
  assert(s.completedContent <= s.totalContent, 'completados no puede exceder el total');
});

// ── 3. Reparación de documentos ────────────────────────────────────────────
// sync-engine escribía fechas Postgres (+00:00, sin ms) sin normalizar; el
// reader las rechazaba y el documento entero quedaba INVALID -> el portal
// mostraba "No se pudo leer el progreso".

check('fechas Postgres (+00:00, sin ms) no invalidan el documento', () => {
  // updatedAt del documento: validateProgress lo exige en ISO canónico y solo
  // repairStoredDocument lo normaliza (a completedAt lo reparan dos caminos
  // distintos, así que no sirve para fijar esta conducta).
  installStorage({
    [catalogKey('hubflow')]: catalogValue(['h1']),
    'learnflow:progress:hubflow:v1': JSON.stringify({
      schemaVersion: 1,
      app: 'hubflow',
      updatedAt: '2026-08-01T12:00:00+00:00',
      catalogVersion: 'test',
      summary: { progressPct: 100, completedContent: 1, totalContent: 1, attemptedContent: 1 },
      content: {
        h1: { ...contentEntry('h1', { completed: true }), completedAt: '2026-07-24T01:07:27+00:00' },
      },
    }),
  });
  const result = read('hubflow');
  assert(result.progress.status !== STATUS.INVALID,
    `no debe quedar INVALID (motivo: ${result.progress.reason})`);
  assertEqual(result.progress.data.summary.completedContent, 1, 'debe conservar el progreso');
  assert(result.progress.data.updatedAt.endsWith('Z'),
    'updatedAt debe quedar normalizado a ISO canónico');
});

check('fechas Postgres en los eventos de actividad tampoco invalidan el ledger', () => {
  installStorage({
    [catalogKey('lyricflow')]: catalogValue(['s1']),
    'learnflow:activity:lyricflow:v1': JSON.stringify({
      schemaVersion: 1,
      app: 'lyricflow',
      updatedAt: '2026-08-01T12:00:00+00:00',
      events: [{
        eventId: 'e1', runId: 'r1', app: 'lyricflow', contentId: 's1', title: 's1',
        activity: 'quiz', eventType: 'attempt_completed',
        occurredAt: '2026-07-24T01:07:27+00:00', scorePct: 90, passed: true,
      }],
    }),
  });
  const activity = read('lyricflow').activity;
  assert(activity.status !== STATUS.INVALID, `el ledger no debe quedar INVALID (${activity.reason})`);
  assertEqual(activity.data.events.length, 1, 'el evento debe sobrevivir a la normalización');
});

check('un documento con basura se descarta sin romper el portal', () => {
  installStorage({ 'learnflow:progress:hubflow:v1': 'esto no es json' });
  const result = read('hubflow');
  assertEqual(result.progress.status, STATUS.INVALID, 'debe reportar INVALID');
  assert(result.progress.data === null, 'no debe entregar datos');
});

check('una versión de esquema futura se reporta como OUTDATED, no como válida', () => {
  installStorage({
    'learnflow:progress:hubflow:v1': JSON.stringify({ schemaVersion: 99, app: 'hubflow', content: {}, summary: {} }),
  });
  assertEqual(read('hubflow').progress.status, STATUS.OUTDATED, 'debe ser OUTDATED');
});

check('un documento de otra app se rechaza', () => {
  installStorage({ 'learnflow:progress:hubflow:v1': doc('lyricflow', {}) });
  assertEqual(read('hubflow').progress.status, STATUS.INVALID, 'app cruzada debe ser INVALID');
});

// ── 4. Migración de la clave legacy de HubFlow ──────────────────────────────
// HubFlow usó :v2 brevemente; la migración a :v1 abandonó los datos sin copiar.

check('HubFlow recupera el progreso de la clave legacy :v2', () => {
  const store = installStorage({
    [catalogKey('hubflow')]: catalogValue(['h1']),
    'learnflow:progress:hubflow:v2': doc('hubflow', { h1: contentEntry('h1', { completed: true }) }),
  });
  const s = read('hubflow').progress.data.summary;
  assertEqual(s.completedContent, 1, 'debe leer el progreso legacy');
  assert('learnflow:progress:hubflow:v1' in store, 'debe migrarlo a la clave :v1');
});

// ── 5. Estado vacío / invitado ─────────────────────────────────────────────

check('sin progreso pero con catálogo, el estado es EMPTY con el total correcto', () => {
  installStorage({ [catalogKey('fluentflow')]: catalogValue(Array.from({ length: 330 }, (_, i) => `m${i}`)) });
  const result = read('fluentflow');
  assertEqual(result.progress.status, STATUS.EMPTY, 'debe ser EMPTY');
  assertEqual(result.progress.data.summary.totalContent, 330, 'el total sale del catálogo');
  assertEqual(result.progress.data.summary.completedContent, 0, 'sin completados');
});

check('sin catálogo ni progreso no inventa un total', () => {
  installStorage();
  const s = read('hubflow').progress.data.summary;
  assertEqual(s.totalContent, 0, 'sin fuente de catálogo el total es 0');
});

// ── 6. Invariantes del resumen entregado ───────────────────────────────────

check('completados y en curso nunca exceden el total, en las 3 apps', () => {
  installStorage({
    [catalogKey('fluentflow')]: catalogValue(['a']),
    [catalogKey('hubflow')]: catalogValue(['b']),
    [catalogKey('lyricflow')]: catalogValue(['c']),
    // documentos con resúmenes deliberadamente inconsistentes
    'learnflow:progress:fluentflow:v1': doc('fluentflow', { a: contentEntry('a', { completed: true }) },
      { summary: { progressPct: 100, completedContent: 999, totalContent: 1, attemptedContent: 999 } }),
    'learnflow:progress:hubflow:v1': doc('hubflow', { b: contentEntry('b', { completed: true }) },
      { summary: { progressPct: 100, completedContent: 999, totalContent: 1, attemptedContent: 999 } }),
    'learnflow:progress:lyricflow:v1': doc('lyricflow', { c: songEntry('c', ['listen']) },
      { summary: { progressPct: 100, completedContent: 999, totalContent: 1, attemptedContent: 999 } }),
  });
  for (const app of ['fluentflow', 'hubflow', 'lyricflow']) {
    const s = read(app).progress.data.summary;
    assert(s.completedContent <= s.totalContent,
      `${app}: completados ${s.completedContent} > total ${s.totalContent}`);
    assert(s.attemptedContent <= s.totalContent,
      `${app}: en curso ${s.attemptedContent} > total ${s.totalContent}`);
    assert(s.progressPct >= 0 && s.progressPct <= 100, `${app}: progressPct fuera de rango`);
  }
});

check('el almacenamiento inaccesible se reporta, no revienta', () => {
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() {}, removeItem() {},
  };
  const result = read('hubflow');
  assertEqual(result.progress.status, STATUS.UNAVAILABLE, 'debe ser UNAVAILABLE');
});

// ── Reporte ────────────────────────────────────────────────────────────────

console.log('');
if (failures.length === 0) {
  console.log(`✅ Progress reader — ${passed}/${passed} OK`);
  process.exit(0);
}
console.log(`❌ Progress reader — ${passed} OK, ${failures.length} fallo(s)`);
for (const f of failures) {
  console.log(`   ✗ ${f.name}`);
  console.log(`     ${f.message}`);
}
console.log('');
console.log('   Contexto: docs/progress-counting-system.md');
process.exit(1);
