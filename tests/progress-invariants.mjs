#!/usr/bin/env node
// Invariantes del sistema de conteo de progreso — prueba compartida.
//
// Canónica en Learn/scripts/; copy-shared.sh la distribuye a tests/ de cada app.
// No editar las copias: el chequeo de deriva del build las revierte.
//
// Cada caso corresponde a un bug real que llegó a producción y mostró números
// incorrectos al usuario. Historial completo: docs/progress-counting-system.md
//
// Son pruebas funcionales: importan los módulos reales y ejecutan el código con
// un localStorage simulado. No hacen grep sobre el fuente — un refactor que
// preserve el comportamiento sigue pasando, y uno que lo rompa falla aunque
// conserve los nombres.
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

// Solo DeskFlow: es quien lee el progreso de las 3 apps para el portal.
const readerPath = locate('../progress-reader.js');

let passed = 0;
let skipped = 0;
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

/** localStorage simulado; se reinstala en cada prueba para aislarlas. */
function installStorage(seed = {}) {
  const data = { ...seed };
  globalThis.localStorage = {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
    key: (i) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; },
  };
  return data;
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
const reader = readerPath ? await import(readerPath) : null;

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

// ── 7. Modo invitado (solo DeskFlow, que es quien renderiza el portal) ──────
// Bug: clearGuestLocalProgress() borra learnflow:progress:*/activity:* al salir,
// y el portal quedaba en "0 de 0". El catálogo es público y no depende de sesión,
// por eso vive en una clave aparte que sobrevive al borrado.

if (reader) {
  check('sin documento de progreso, el total sale de learnflow:catalog', () => {
    const store = installStorage({
      [catalogKey('fluentflow')]: catalogValue(Array.from({ length: 330 }, (_, i) => `m${i}`)),
      [catalogKey('hubflow')]: catalogValue(Array.from({ length: 150 }, (_, i) => `h${i}`)),
      [catalogKey('lyricflow')]: catalogValue(Array.from({ length: 9 }, (_, i) => `s${i}`)),
    });
    const r = new reader.ProgressReader(globalThis.localStorage);
    assertEqual(r.readApp('fluentflow').progress.data.summary.totalContent, 330, 'fluentflow');
    assertEqual(r.readApp('hubflow').progress.data.summary.totalContent, 150, 'hubflow');
    assert(!Object.keys(store).some((k) => k.startsWith('learnflow:progress:')),
      'la prueba debe correr sin documentos de progreso');
  });

  check('LyricFlow invitado expone totalActivities, no solo canciones', () => {
    installStorage({
      [catalogKey('lyricflow')]: catalogValue(Array.from({ length: 9 }, (_, i) => `s${i}`)),
    });
    const s = new reader.ProgressReader(globalThis.localStorage).readApp('lyricflow').progress.data.summary;
    // El card de LyricFlow se mide por actividades (PRIMARY_PROGRESS_METRICS en
    // app.js). Con totalActivities en null caía al fallback de totalContent y
    // mostraba "0 de 9" (canciones) en vez de "0 de 36".
    assertEqual(s.totalContent, 9, 'totalContent = canciones');
    assertEqual(s.totalActivities, 36, 'totalActivities = canciones x 4 actividades');
  });
} else {
  skipped += 2; // progress-reader.js solo existe en DeskFlow
}

// ── Reporte ─────────────────────────────────────────────────────────────────

const suffix = skipped ? ` (${skipped} omitida(s): sin progress-reader.js)` : '';
console.log('');
if (failures.length === 0) {
  console.log(`✅ Invariantes de progreso — ${passed}/${passed} OK${suffix}`);
  process.exit(0);
}

console.log(`❌ Invariantes de progreso — ${passed} OK, ${failures.length} fallo(s)${suffix}`);
for (const f of failures) {
  console.log(`   ✗ ${f.name}`);
  console.log(`     ${f.message}`);
}
console.log('');
console.log('   Contexto: docs/progress-counting-system.md');
process.exit(1);
