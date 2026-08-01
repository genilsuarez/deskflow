#!/usr/bin/env node
// lp-catalog-warmer.js — siembra learnflow:catalog:<app>:v1 desde el catálogo
// público de cada app cuando falta o está incompleta.
//
// Específico de DeskFlow (no lo distribuye copy-shared.sh).
//
// Por qué importa: toda la poda de huérfanos depende de que esa clave traiga
// `ids`. Si el warmer deja de escribirlos, readCatalogIdsFallback() devuelve
// null, la poda hace fail-open y el bug vuelve en silencio — sin que ninguna
// prueba de invariantes lo note, porque todas siembran la clave por su cuenta.
//
// Correr:  node tests/catalog-warmer.mjs

let passed = 0;
const failures = [];

function check(name, fn) {
  return fn().then(
    () => { passed++; },
    (error) => { failures.push({ name, message: error.message }); }
  );
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
  for (const [key, value] of Object.entries(seed)) ls[key] = String(value);
  globalThis.localStorage = ls;
  return ls;
}

const FLUENTFLOW_MODULES = Array.from({ length: 330 }, (_, i) => ({ id: `mod-${i}` }));

/**
 * `fetch` simulado para el catálogo JSON de FluentFlow. Las rutas de HubFlow y
 * LyricFlow usan import() dinámico de rutas absolutas del sitio, que en Node no
 * resuelven: el warmer las captura y devuelve false, que es justo el
 * comportamiento a verificar (un fallo de red no debe romper el arranque).
 */
function installFetch({ ok = true, body = FLUENTFLOW_MODULES } = {}) {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (!ok) return { ok: false, json: async () => { throw new Error('no debería leerse'); } };
    return { ok: true, json: async () => body };
  };
  return () => calls;
}

const { warmAllCatalogTotals } = await import('../lp-catalog-warmer.js');
const KEY = 'learnflow:catalog:fluentflow:v1';

await check('siembra la clave con totalContent Y con ids', async () => {
  const store = installStorage();
  installFetch();
  await warmAllCatalogTotals();
  assert(KEY in store, 'debe escribir la clave de catálogo de fluentflow');
  const parsed = JSON.parse(store[KEY]);
  assertEqual(parsed.totalContent, 330, 'totalContent');
  assert(Array.isArray(parsed.ids), 'debe incluir ids — sin ellos la poda hace fail-open');
  assertEqual(parsed.ids.length, 330, 'cantidad de ids');
  assertEqual(parsed.ids[0], 'mod-0', 'los ids deben ser los del catálogo, no índices');
});

await check('re-siembra una clave vieja que tiene totalContent pero no ids', async () => {
  const store = installStorage({ [KEY]: JSON.stringify({ totalContent: 330 }) });
  installFetch();
  await warmAllCatalogTotals();
  const parsed = JSON.parse(store[KEY]);
  assert(Array.isArray(parsed.ids) && parsed.ids.length === 330,
    'una clave del esquema anterior debe adquirir ids sin esperar a que se abra la app');
});

await check('no rehace trabajo si la clave ya está completa', async () => {
  const store = installStorage({
    [KEY]: JSON.stringify({ totalContent: 330, ids: ['ya-estaba'] }),
  });
  const calls = installFetch();
  await warmAllCatalogTotals();
  assertEqual(calls(), 0, 'no debe hacer fetch si la clave ya tiene totalContent e ids');
  assertEqual(JSON.parse(store[KEY]).ids[0], 'ya-estaba',
    'no debe pisar lo que publicó la app dueña del catálogo');
});

await check('un fetch fallido no escribe una clave inválida', async () => {
  const store = installStorage();
  installFetch({ ok: false });
  await warmAllCatalogTotals();
  assert(!(KEY in store), 'sin datos válidos no debe escribir nada');
});

await check('una respuesta vacía no escribe una clave con total 0', async () => {
  const store = installStorage();
  installFetch({ body: [] });
  await warmAllCatalogTotals();
  assert(!(KEY in store),
    'un catálogo vacío dejaría el portal en "0 de 0"; mejor no escribir la clave');
});

console.log('');
if (failures.length === 0) {
  console.log(`✅ Catalog warmer — ${passed}/${passed} OK`);
  process.exit(0);
}
console.log(`❌ Catalog warmer — ${passed} OK, ${failures.length} fallo(s)`);
for (const f of failures) {
  console.log(`   ✗ ${f.name}`);
  console.log(`     ${f.message}`);
}
console.log('');
console.log('   Contexto: docs/progress-counting-system.md');
process.exit(1);
