#!/usr/bin/env node
// Invariantes del sistema de conteo de progreso — prueba compartida.
//
// Canónica en Learn/scripts/; copy-shared.sh la distribuye a tests/ de cada app.
// No editar las copias: el chequeo de deriva del build las revierte.
//
// Cada caso corresponde a un bug real que llegó a producción y mostró números
// incorrectos al usuario. Historial: README.md § Sistema de progreso.
//
// Son pruebas funcionales: importan los módulos reales y ejecutan el código con
// un localStorage simulado. No hacen grep sobre el fuente — un refactor que
// preserve el comportamiento sigue pasando, y uno que lo rompa falla aunque
// conserve los nombres.
//
// Las pruebas que dependen de progress-reader.js (exclusivo de DeskFlow) viven
// en DeskFlow/tests/progress-reader-invariants.mjs — no en este archivo.
//
// Correr:  node tests/progress-invariants.mjs

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Primer candidato existente; cada app guarda los compartidos en otra ruta. */
function locate(...candidates) {
  for (const rel of candidates) {
    const abs = resolve(HERE, rel);
    if (existsSync(abs)) return pathToFileURL(abs).href;
  }
  return null;
}

const summaryPath = locate(
  '../lp-progress-summary.js', // DeskFlow, LyricFlow
  '../js/lp-progress-summary.js', // HubFlow
  '../public/lp-progress-summary.js', // FluentFlow
  './lp-progress-summary.js' // Learn/scripts (canónico)
);

if (!summaryPath) {
  console.error('❌ No se encontró lp-progress-summary.js junto a esta prueba.');
  process.exit(1);
}

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
  if (actual !== expected) {
    throw new Error(`${message} — esperado ${expected}, obtenido ${actual}`);
  }
}

/**
 * localStorage simulado; se reinstala en cada prueba para aislarlas.
 *
 * Las claves se guardan como propiedades enumerables propias y los métodos como
 * no enumerables, igual que un objeto Storage real. Importa: hay código de
 * producción que recorre el storage con Object.keys(localStorage)
 * —clearGuestLocalProgress() -- y con un stub que expone los métodos como
 * propiedades normales recorrería ['getItem','setItem',...] y no borraría nada,
 * dando por buena una prueba que en realidad no ejecutó nada.
 */
function installStorage(seed = {}) {
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
  globalThis.localStorage = ls;
  return ls;
}

/** sessionStorage equivalente; lp-guest-reset.js lo usa para el flag de logout. */
function installSessionStorage() {
  const previous = globalThis.localStorage;
  installStorage();
  globalThis.sessionStorage = globalThis.localStorage;
  globalThis.localStorage = previous;
  return globalThis.sessionStorage;
}

const catalogKey = (app) => `learnflow:catalog:${app}:v1`;
const catalogValue = (ids) =>
  JSON.stringify({ totalContent: ids.length, ids, updatedAt: new Date().toISOString() });

/** Documento de progreso con `completedIds` marcados como completados. */
function progressDoc(app, contentIds, completedIds = []) {
  const completed = new Set(completedIds);
  return {
    schemaVersion: 1,
    app,
    updatedAt: new Date().toISOString(),
    catalogVersion: 'test',
    summary: { progressPct: 0, completedContent: 0, totalContent: 0, attemptedContent: 0 },
    content: Object.fromEntries(contentIds.map((id) => [id, {
      contentId: id,
      contentType: app === 'lyricflow' ? 'song' : 'module',
      progressPct: completed.has(id) ? 100 : 0,
      completed: completed.has(id),
      completedAt: completed.has(id) ? new Date().toISOString() : null,
      bestScorePct: completed.has(id) ? 100 : null,
      attempts: completed.has(id) ? 1 : 0,
    }])),
  };
}

installStorage();
const summary = await import(summaryPath);

// ── 1. El total sale del catálogo, nunca del content map ────────────────────
// Bug: el content map se infla con ids huérfanos que el cloud-merge une desde
// Supabase sin podar, y se usaba su tamaño como total.

check('total = catálogo vigente, aunque el content map traiga huérfanos', () => {
  installStorage({ [catalogKey('hubflow')]: catalogValue(['a', 'b', 'c']) });
  const doc = progressDoc('hubflow', ['a', 'b', 'c', 'huerfano-1', 'huerfano-2']);
  summary.recomputeProgressDocumentSummary(doc, 'hubflow');
  assertEqual(doc.summary.totalContent, 3, 'totalContent debe ser el del catálogo');
});

check('el total NO es un ratchet: baja si el catálogo se recorta', () => {
  installStorage({ [catalogKey('hubflow')]: catalogValue(['a', 'b']) });
  const doc = progressDoc('hubflow', ['a', 'b']);
  doc.summary.totalContent = 150; // valor histórico mayor, de un catálogo anterior
  summary.recomputeProgressDocumentSummary(doc, 'hubflow');
  assertEqual(doc.summary.totalContent, 2, 'un total histórico mayor no debe ganar');
});

check('catalogTotalContent tiene prioridad sobre el tamaño del content map', () => {
  installStorage();
  const doc = progressDoc('fluentflow', ['a', 'b']);
  doc.catalogTotalContent = 330;
  summary.recomputeProgressDocumentSummary(doc, 'fluentflow');
  assertEqual(doc.summary.totalContent, 330, 'debe usar catalogTotalContent');
});

// ── 2. Los huérfanos no cuentan como completados ────────────────────────────
// Bug: el portal mostraba 40 completados en HubFlow (reales: 24) y 97 en
// FluentFlow (reales: 93) por contar ids que ya no existen en el catálogo.

check('completados excluye ids fuera del catálogo', () => {
  installStorage({ [catalogKey('hubflow')]: catalogValue(['a', 'b', 'c']) });
  const doc = progressDoc('hubflow', ['a', 'b', 'c', 'vocab-pack-viejo'], ['a', 'vocab-pack-viejo']);
  summary.recomputeProgressDocumentSummary(doc, 'hubflow');
  assertEqual(doc.summary.completedContent, 1, 'el huérfano completado no debe contar');
});

check('la poda elimina los huérfanos del content map', () => {
  installStorage({ [catalogKey('lyricflow')]: catalogValue(['s1', 's2']) });
  const doc = progressDoc('lyricflow', ['s1', 's2', 'despacito']);
  summary.recomputeProgressDocumentSummary(doc, 'lyricflow');
  assert(!('despacito' in doc.content), 'el huérfano debe salir del content map');
});

// ── 3. Fail-open cuando el catálogo no está disponible ──────────────────────
// Sin esto, un arranque en frío (antes de que la app publique su catálogo)
// borraría progreso legítimo en vez de solo no filtrar.

check('sin clave de catálogo NO se poda (fail-open)', () => {
  installStorage();
  const doc = progressDoc('hubflow', ['a', 'b', 'desconocido'], ['a', 'desconocido']);
  summary.recomputeProgressDocumentSummary(doc, 'hubflow');
  assertEqual(Object.keys(doc.content).length, 3, 'no debe borrar nada sin catálogo');
  assertEqual(doc.summary.completedContent, 2, 'no debe descartar completados sin catálogo');
});

check('una clave de catálogo sin ids tampoco poda (fail-open)', () => {
  installStorage({ [catalogKey('hubflow')]: JSON.stringify({ totalContent: 3 }) });
  const doc = progressDoc('hubflow', ['a', 'b', 'desconocido']);
  summary.recomputeProgressDocumentSummary(doc, 'hubflow');
  assertEqual(Object.keys(doc.content).length, 3, 'sin ids no debe podar');
});

// ── 4. El ledger de actividad es la otra mitad del ciclo ────────────────────
// Bug: se podó todo progress.content pero no learnflow:activity:<app>:v1, y el
// sync subía el ledger completo. activity_events es append-only en Supabase, así
// que cada evento huérfano subido solo se quita con una migración server-side.

check('pruneActivityEventsToCatalog descarta eventos huérfanos', () => {
  installStorage({ [catalogKey('fluentflow')]: catalogValue(['m1', 'm2']) });
  const events = [
    { eventId: '1', contentId: 'm1' },
    { eventId: '2', contentId: 'modulo-eliminado' },
    { eventId: '3', contentId: 'm2' },
  ];
  const kept = summary.pruneActivityEventsToCatalog(events, 'fluentflow');
  assertEqual(kept.length, 2, 'debe quedarse solo con los del catálogo');
  assert(!kept.some((e) => e.contentId === 'modulo-eliminado'), 'el huérfano debe salir');
});

check('pruneActivityEventsToCatalog es fail-open sin catálogo', () => {
  installStorage();
  const events = [{ eventId: '1', contentId: 'lo-que-sea' }];
  assertEqual(summary.pruneActivityEventsToCatalog(events, 'fluentflow').length, 1,
    'sin catálogo debe conservar todo');
});

check('conserva eventos sin contentId en vez de descartarlos', () => {
  installStorage({ [catalogKey('fluentflow')]: catalogValue(['m1']) });
  const events = [{ eventId: '1' }, { eventId: '2', contentId: 'm1' }];
  assertEqual(summary.pruneActivityEventsToCatalog(events, 'fluentflow').length, 2,
    'un evento sin contentId no se puede clasificar; no debe perderse');
});

// ── 5. El avance de nivel CEFR también se calcula sobre datos podados ───────
// Bug: getCombinedLevelProgress() leía localStorage crudo. Un huérfano sin
// completar baja el progressPct del nivel y puede bloquear un ascenso legítimo.

check('el progreso por nivel ignora los huérfanos', () => {
  const ids = ['reading-a1', 'quiz-a1'];
  installStorage({
    [catalogKey('fluentflow')]: catalogValue(ids),
    'learnflow:progress:fluentflow:v1': JSON.stringify(
      progressDoc('fluentflow', [...ids, 'eliminado-a1'], ids)
    ),
  });
  const a1 = summary.getCombinedLevelProgress('a1').fluentflow;
  assertEqual(a1.totalModules, 2, 'el huérfano no debe sumar al total del nivel');
  assertEqual(a1.progressPct, 100, 'nivel completo: un huérfano no debe bloquear el ascenso');
});

// ── 6. Consistencia interna del resumen ─────────────────────────────────────

check('completados nunca supera el total', () => {
  installStorage({ [catalogKey('hubflow')]: catalogValue(['a', 'b']) });
  const doc = progressDoc('hubflow', ['a', 'b'], ['a', 'b']);
  summary.recomputeProgressDocumentSummary(doc, 'hubflow');
  assert(doc.summary.completedContent <= doc.summary.totalContent,
    `completados (${doc.summary.completedContent}) > total (${doc.summary.totalContent})`);
});

check('progressPct concuerda con completados/total', () => {
  installStorage({ [catalogKey('fluentflow')]: catalogValue(['a', 'b', 'c', 'd']) });
  const doc = progressDoc('fluentflow', ['a', 'b', 'c', 'd'], ['a']);
  summary.recomputeProgressDocumentSummary(doc, 'fluentflow');
  const esperado = (doc.summary.completedContent / doc.summary.totalContent) * 100;
  assert(Math.abs(doc.summary.progressPct - esperado) < 0.01,
    `progressPct ${doc.summary.progressPct} no concuerda con ${esperado}`);
});

// ── 7. El logout no debe llevarse la clave de catálogo ─────────────────────
// clearGuestLocalProgress() borra learnflow:progress:* y learnflow:activity:*
// al salir (correcto: no debe filtrarse progreso ajeno en un dispositivo
// compartido). learnflow:catalog:* NO matchea ese borrado a propósito — el
// catálogo es público y no depende de la sesión. Si alguien "ordena" el borrado
// agregando ese prefijo, el modo invitado vuelve a "0 de 0" (ronda 3) y ninguna
// otra prueba lo nota: todas siembran la clave por su cuenta.

const guestResetPath = locate(
  '../lp-guest-reset.js', // DeskFlow, LyricFlow
  '../js/lp-guest-reset.js', // HubFlow
  '../public/lp-guest-reset.js' // FluentFlow
);

if (guestResetPath) {
  const store = installStorage({
    'learnflow:progress:hubflow:v1': '{"content":{}}',
    'learnflow:activity:hubflow:v1': '{"events":[]}',
    'learnflow:catalog:hubflow:v1': JSON.stringify({ totalContent: 150, ids: ['a'] }),
    'learnflow:catalog:fluentflow:v1': JSON.stringify({ totalContent: 330, ids: ['b'] }),
    'lp-theme': 'dark',
  });
  installSessionStorage();
  await import(guestResetPath);
  const guestReset = globalThis.lpGuestReset;

  check('el logout borra progreso y actividad', () => {
    assert(guestReset, 'lp-guest-reset.js debe exponer window.lpGuestReset');
    guestReset.clearGuestLocalProgress();
    assert(!('learnflow:progress:hubflow:v1' in store), 'debe borrar el progreso');
    assert(!('learnflow:activity:hubflow:v1' in store), 'debe borrar la actividad');
  });

  check('el logout PRESERVA learnflow:catalog:* (si no, invitado = "0 de 0")', () => {
    assert('learnflow:catalog:hubflow:v1' in store,
      'la clave de catálogo de hubflow debe sobrevivir al logout');
    assert('learnflow:catalog:fluentflow:v1' in store,
      'la clave de catálogo de fluentflow debe sobrevivir al logout');
    const parsed = JSON.parse(store['learnflow:catalog:hubflow:v1']);
    assertEqual(parsed.totalContent, 150, 'el total del catálogo debe quedar intacto');
    assert(Array.isArray(parsed.ids) && parsed.ids.length > 0, 'los ids deben quedar intactos');
  });
} else {
  // lp-guest-reset.js no encontrado — pruebas de logout no aplican en este contexto
}

// ── Reporte ─────────────────────────────────────────────────────────────────

console.log('');
if (failures.length === 0) {
  console.log(`✅ Invariantes de progreso — ${passed}/${passed} OK`);
  process.exit(0);
}

console.log(`❌ Invariantes de progreso — ${passed} OK, ${failures.length} fallo(s)`);
for (const f of failures) {
  console.log(`   ✗ ${f.name}`);
  console.log(`     ${f.message}`);
}
console.log('');
process.exit(1);
