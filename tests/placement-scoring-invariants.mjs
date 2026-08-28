#!/usr/bin/env node
// Invariantes del motor de scoring del examen de nivel — prueba compartida.
//
// Canónica en Learn/scripts/; copy-shared.sh la distribuye a tests/ de cada app.
// No editar las copias: el chequeo de deriva del build las revierte.
//
// Son pruebas funcionales: importan el módulo real (scoreValidation) y lo
// ejecutan con ítems/respuestas sintéticas — no hacen grep sobre el fuente.
//
// Correr:  node tests/placement-scoring-invariants.mjs

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

const scoringPath = locate(
  '../lp-placement-scoring.js', // DeskFlow
  './lp-placement-scoring.js' // Learn/scripts (canónico)
);

if (!scoringPath) {
  console.error('No se encontró lp-placement-scoring.js');
  process.exit(1);
}

const {
  scoreValidation,
  scoreBlock,
  blocksFor,
  probeTriggerFor,
  pickItems,
  FALLBACK_LEVEL,
  BLOCK_SIZE,
  FLOOR_BLOCK_SIZE,
  PROBE_SIZE,
} = await import(scoringPath);

let failures = 0;
function check(name, condition) {
  if (condition) {
    console.log(`  ok — ${name}`);
  } else {
    console.error(`  FAIL — ${name}`);
    failures++;
  }
}

/** Arma N ítems sintéticos de un nivel, todos con correct = 'A'. */
function levelItems(level, count) {
  return Array.from({ length: count }, () => ({ level, correct: 'A' }));
}

function answersAllCorrect(items) {
  return items.map((item) => item.correct);
}

/** Arma respuestas con exactamente `correctCount` aciertos (no un ratio redondeado). */
function answersWithCount(items, correctCount) {
  return items.map((item, index) => (index < correctCount ? item.correct : 'WRONG'));
}

console.log('blocksFor — qué bloques exige cada nivel solicitado');
{
  check('a1 no se valida', blocksFor('a1').length === 0);
  check('a2 no se valida', blocksFor('a2').length === 0);
  check('b1 rinde solo el bloque b1', JSON.stringify(blocksFor('b1')) === JSON.stringify(['b1']));
  check('b2 rinde piso b1 + bloque b2', JSON.stringify(blocksFor('b2')) === JSON.stringify(['b1', 'b2']));
}

console.log('BLOCK_SIZE / FLOOR_BLOCK_SIZE — el umbral es representable exacto');
{
  check('bloque b1 son 10 ítems', BLOCK_SIZE.b1 === 10);
  check('bloque b2 son 10 ítems', BLOCK_SIZE.b2 === 10);
  check('el piso b1 usa el mismo tamaño que el bloque b1 completo — sin asimetría', FLOOR_BLOCK_SIZE === BLOCK_SIZE.b1);
}

console.log('scoreValidation — pide b1 y lo aprueba con el bloque real (10 ítems)');
{
  const items = levelItems('b1', BLOCK_SIZE.b1);
  const answers = answersAllCorrect(items);
  const result = scoreValidation('b1', items, answers);
  check('otorga b1', result.level === 'b1');
  check('passed es true', result.passed === true);
}

console.log('scoreValidation — pide b1, exactamente 7 de 10 (70% exacto) → aprueba');
{
  const items = levelItems('b1', BLOCK_SIZE.b1);
  const answers = answersWithCount(items, 7);
  const result = scoreValidation('b1', items, answers);
  check('el umbral es inclusivo — otorga b1', result.level === 'b1');
}

console.log('scoreValidation — pide b1, 6 de 10 (justo debajo del 70%) → reprueba');
{
  const items = levelItems('b1', BLOCK_SIZE.b1);
  const answers = answersWithCount(items, 6);
  const result = scoreValidation('b1', items, answers);
  check('NO otorga b1', result.level !== 'b1');
  check('cae al nivel de fallback', result.level === FALLBACK_LEVEL);
  check('passed es false', result.passed === false);
}

console.log('scoreValidation — pide b2, el piso b1 (10 ítems) con 6/10 exacto también aprueba');
{
  // Antes del fix, el piso abreviado (5 ítems) exigía 4/5 = 80% real — más
  // estricto que el bloque b1 completo (11/15 = 73%). Con FLOOR_BLOCK_SIZE
  // igual a BLOCK_SIZE.b1, el mismo 70% (7/10) rige en los dos casos.
  const b1 = levelItems('b1', BLOCK_SIZE.b1);
  const b2 = levelItems('b2', BLOCK_SIZE.b2);
  const items = [...b1, ...b2];
  const answers = [...answersWithCount(b1, 7), ...answersAllCorrect(b2)];
  const result = scoreValidation('b2', items, answers);
  check('7/10 en el piso aprueba, igual que pidiendo b1 directo', result.blocks[0].passed === true);
}

console.log('scoreValidation — pide b2 y reprueba el piso b1 → a1, sin puntuar b2');
{
  const b1 = levelItems('b1', BLOCK_SIZE.b1);
  const b2 = levelItems('b2', BLOCK_SIZE.b2);
  const items = [...b1, ...b2];
  const answers = [...answersWithCount(b1, 4), ...answersAllCorrect(b2)];
  const result = scoreValidation('b2', items, answers);
  check('cae a a1 aunque el bloque b2 esté perfecto', result.level === FALLBACK_LEVEL);
  check('corta en el piso — solo puntúa un bloque', result.blocks.length === 1);
  check('el bloque puntuado es el piso b1', result.blocks[0].level === 'b1');
}

console.log('scoreValidation — pide b2, pasa el piso pero reprueba b2 → a1 (no queda en b1)');
{
  const b1 = levelItems('b1', BLOCK_SIZE.b1);
  const b2 = levelItems('b2', BLOCK_SIZE.b2);
  const items = [...b1, ...b2];
  const answers = [...answersAllCorrect(b1), ...answersWithCount(b2, 4)]; // 4/10 = 40%, bajo el 60%
  const result = scoreValidation('b2', items, answers);
  check('NO otorga b2', result.level !== 'b2');
  check('tampoco otorga b1 de consuelo — el usuario pidió b2', result.level === FALLBACK_LEVEL);
  check('puntúa ambos bloques', result.blocks.length === 2);
  check('el bloque b2 queda como no aprobado', result.blocks[1].passed === false);
}

console.log('scoreValidation — pide b2 y aprueba piso + bloque, 6/10 exacto en b2 (60%) → b2');
{
  const b1 = levelItems('b1', BLOCK_SIZE.b1);
  const b2 = levelItems('b2', BLOCK_SIZE.b2);
  const items = [...b1, ...b2];
  const answers = [...answersAllCorrect(b1), ...answersWithCount(b2, 6)];
  const result = scoreValidation('b2', items, answers);
  check('otorga b2 en el umbral exacto', result.level === 'b2');
  check('passed es true', result.passed === true);
  check('ambos bloques aprobados', result.blocks.every((block) => block.passed));
}

console.log('scoreValidation — examen cortado: bloque sin ítems rendidos no otorga nivel');
{
  const items = levelItems('b1', BLOCK_SIZE.b1); // pidió b2 pero solo rindió el piso
  const answers = answersAllCorrect(items);
  const result = scoreValidation('b2', items, answers);
  check('el bloque b2 vacío reprueba', result.passed === false);
  check('cae a a1', result.level === FALLBACK_LEVEL);
}

console.log('scoreValidation — un nivel no validable nunca otorga nivel');
{
  const result = scoreValidation('a2', [], []);
  check('sin bloques que rendir, passed es false', result.passed === false);
  check('no otorga a2 por la vía del examen', result.level === FALLBACK_LEVEL);
}

console.log('scoreValidation — los ítems de la sonda C1 mezclados no afectan el pass/fail de b2');
{
  const b1 = levelItems('b1', BLOCK_SIZE.b1);
  const b2 = levelItems('b2', BLOCK_SIZE.b2);
  const c1 = levelItems('c1', PROBE_SIZE);
  const items = [...b1, ...b2, ...c1];
  // Sonda toda mal contestada — no debería poder tirar abajo un b2 aprobado.
  const answers = [...answersAllCorrect(b1), ...answersWithCount(b2, 6), ...c1.map(() => 'WRONG')];
  const result = scoreValidation('b2', items, answers);
  check('otorga b2 sin que la sonda participe', result.level === 'b2');
  check('scoreValidation no reporta bloque c1 — no está en blocksFor()', result.blocks.every((b) => b.level !== 'c1'));
}

console.log('scoreBlock — puntúa un bloque aislado (usado para anotar la sonda)');
{
  const c1 = levelItems('c1', PROBE_SIZE);
  const answers = answersWithCount(c1, 3);
  const result = scoreBlock('c1', c1, answers);
  check('correctCount correcto', result.correctCount === 3);
  check('total correcto', result.total === PROBE_SIZE);
  check('ratio correcto', result.ratio === 3 / PROBE_SIZE);
}

console.log('probeTriggerFor — solo dispara si b2 se aprobó, en los dos extremos (6-7 y 9-10 de 10)');
{
  const b2 = (correctCount) => ({ level: 'b2', correctCount, total: BLOCK_SIZE.b2, passed: correctCount >= 6 });
  check('no dispara si b2 reprobó (5/10)', probeTriggerFor(b2(5)) === false);
  check('dispara al borde del corte (6/10)', probeTriggerFor(b2(6)) === true);
  check('dispara al borde del corte (7/10)', probeTriggerFor(b2(7)) === true);
  check('NO dispara en el medio (8/10) — ya es b2 sólido sin evidencia de más', probeTriggerFor(b2(8)) === false);
  check('dispara en el techo (9/10)', probeTriggerFor(b2(9)) === true);
  check('dispara en el techo (10/10)', probeTriggerFor(b2(10)) === true);
  check('no dispara sin resultado', probeTriggerFor(null) === false);
  check('no dispara con un bloque de otro tamaño', probeTriggerFor({ level: 'b2', correctCount: 6, total: 5, passed: true }) === false);
}

console.log('pickItems — determinista (mismo seed, misma selección) y sin repetir ítems');
{
  const pool = Array.from({ length: 20 }, (_, i) => ({ id: i }));
  const a = pickItems(pool, 10, 12345);
  const b = pickItems(pool, 10, 12345);
  const c = pickItems(pool, 10, 999);
  check('mismo seed → misma selección', JSON.stringify(a) === JSON.stringify(b));
  check('seed distinto → selección casi seguro distinta', JSON.stringify(a) !== JSON.stringify(c));
  check('tamaño pedido respetado', a.length === 10);
  check('sin ítems repetidos', new Set(a.map((item) => item.id)).size === 10);
  check('nunca elige más de lo que hay en el pool', pickItems(pool, 999, 1).length === pool.length);
}

if (failures > 0) {
  console.error(`\n${failures} invariante(s) de placement-scoring fallaron.`);
  process.exit(1);
}
console.log('\nTodas las invariantes de placement-scoring pasaron.');
