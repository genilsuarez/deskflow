#!/usr/bin/env node
// Invariantes de ProgressReader — exclusivas de DeskFlow.
//
// progress-reader.js solo existe en DeskFlow (es el pipeline de lectura del
// portal: repara, poda y valida los documentos antes de mostrárselos al usuario).
// Estas pruebas no forman parte del conjunto canónico compartido
// (lp-progress-invariants.mjs) porque no tienen sentido fuera del portal.
//
// Correr:  node tests/progress-reader-invariants.mjs

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function locate(...candidates) {
  for (const rel of candidates) {
    const abs = resolve(HERE, rel);
    if (existsSync(abs)) return pathToFileURL(abs).href;
  }
  return null;
}

const readerPath = locate('../progress-reader.js');
if (!readerPath) {
  console.error('❌ No se encontró progress-reader.js — esta prueba solo corre en DeskFlow.');
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

const catalogKey = (app) => `learnflow:catalog:${app}:v1`;
const catalogValue = (ids) =>
  JSON.stringify({ totalContent: ids.length, ids, updatedAt: new Date().toISOString() });

const reader = await import(readerPath);

// ── Modo invitado: el total sale de learnflow:catalog, no del content map ───
// Bug (ronda 4): en un dispositivo donde HubFlow o LyricFlow nunca se abrieron,
// la clave de catálogo no existía y el portal mostraba "0 de 0". DeskFlow la
// siembra vía lp-catalog-warmer.js; estas pruebas verifican que ProgressReader
// la lea correctamente cuando no hay documento de progreso.

check('sin documento de progreso, el total sale de learnflow:catalog', () => {
  const store = installStorage({
    [catalogKey('fluentflow')]: catalogValue(Array.from({ length: 330 }, (_, i) => `m${i}`)),
    [catalogKey('hubflow')]:    catalogValue(Array.from({ length: 150 }, (_, i) => `h${i}`)),
    [catalogKey('lyricflow')]:  catalogValue(Array.from({ length: 9 },   (_, i) => `s${i}`)),
  });
  const r = new reader.ProgressReader(globalThis.localStorage);
  assertEqual(r.readApp('fluentflow').progress.data.summary.totalContent, 330, 'fluentflow');
  assertEqual(r.readApp('hubflow').progress.data.summary.totalContent, 150, 'hubflow');
  assert(
    !Object.keys(store).some((k) => k.startsWith('learnflow:progress:')),
    'la prueba debe correr sin documentos de progreso'
  );
});

check('LyricFlow invitado expone totalActivities, no solo canciones', () => {
  installStorage({
    [catalogKey('lyricflow')]: catalogValue(Array.from({ length: 9 }, (_, i) => `s${i}`)),
  });
  const s = new reader.ProgressReader(globalThis.localStorage)
    .readApp('lyricflow').progress.data.summary;
  // El card de LyricFlow se mide por actividades (PRIMARY_PROGRESS_METRICS en
  // app.js). Con totalActivities en null caía al fallback de totalContent y
  // mostraba "0 de 9" (canciones) en vez de "0 de 36".
  assertEqual(s.totalContent, 9, 'totalContent = canciones');
  assertEqual(s.totalActivities, 36, 'totalActivities = canciones × 4 actividades');
});

// ── Reporte ──────────────────────────────────────────────────────────────────

console.log('');
if (failures.length === 0) {
  console.log(`✅ Invariantes de ProgressReader — ${passed}/${passed} OK`);
  process.exit(0);
}

console.log(`❌ Invariantes de ProgressReader — ${passed} OK, ${failures.length} fallo(s)`);
for (const f of failures) {
  console.log(`   ✗ ${f.name}`);
  console.log(`     ${f.message}`);
}
console.log('');
process.exit(1);
