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

const { scoreValidation, blocksFor, FALLBACK_LEVEL } = await import(scoringPath);

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

function answersRatio(items, ratio) {
  const correctCount = Math.round(items.length * ratio);
  return items.map((item, index) => (index < correctCount ? item.correct : 'WRONG'));
}

console.log('blocksFor — qué bloques exige cada nivel solicitado');
{
  check('a1 no se valida', blocksFor('a1').length === 0);
  check('a2 no se valida', blocksFor('a2').length === 0);
  check('b1 rinde solo el bloque b1', JSON.stringify(blocksFor('b1')) === JSON.stringify(['b1']));
  check('b2 rinde piso b1 + bloque b2', JSON.stringify(blocksFor('b2')) === JSON.stringify(['b1', 'b2']));
}

console.log('scoreValidation — pide b1 y lo aprueba (≥ 70%)');
{
  const items = levelItems('b1', 15);
  const answers = answersAllCorrect(items);
  const result = scoreValidation('b1', items, answers);
  check('otorga b1', result.level === 'b1');
  check('passed es true', result.passed === true);
}

console.log('scoreValidation — pide b1 exacto en el umbral (70%)');
{
  const items = levelItems('b1', 20);
  const answers = answersRatio(items, 0.7); // 14/20 = exactamente 70%
  const result = scoreValidation('b1', items, answers);
  check('el umbral es inclusivo — otorga b1', result.level === 'b1');
}

console.log('scoreValidation — pide b1 y lo reprueba (< 70%) → cae a a1');
{
  const items = levelItems('b1', 15);
  const answers = answersRatio(items, 0.6); // 9/15 = 60%
  const result = scoreValidation('b1', items, answers);
  check('NO otorga b1', result.level !== 'b1');
  check('cae al nivel de fallback', result.level === FALLBACK_LEVEL);
  check('passed es false', result.passed === false);
}

console.log('scoreValidation — pide b2 y reprueba el piso b1 → a1, sin puntuar b2');
{
  const items = [...levelItems('b1', 5), ...levelItems('b2', 5)];
  const answers = [
    ...answersRatio(levelItems('b1', 5), 0.4), // piso reprobado
    ...answersAllCorrect(levelItems('b2', 5)), // no debería rescatarlo
  ];
  const result = scoreValidation('b2', items, answers);
  check('cae a a1 aunque el bloque b2 esté perfecto', result.level === FALLBACK_LEVEL);
  check('corta en el piso — solo puntúa un bloque', result.blocks.length === 1);
  check('el bloque puntuado es el piso b1', result.blocks[0].level === 'b1');
}

console.log('scoreValidation — pide b2, pasa el piso pero reprueba b2 → a1 (no queda en b1)');
{
  const items = [...levelItems('b1', 5), ...levelItems('b2', 5)];
  const answers = [
    ...answersAllCorrect(levelItems('b1', 5)),
    ...answersRatio(levelItems('b2', 5), 0.4), // 2/5 = 40%, bajo el 60%
  ];
  const result = scoreValidation('b2', items, answers);
  check('NO otorga b2', result.level !== 'b2');
  check('tampoco otorga b1 de consuelo — el usuario pidió b2', result.level === FALLBACK_LEVEL);
  check('puntúa ambos bloques', result.blocks.length === 2);
  check('el bloque b2 queda como no aprobado', result.blocks[1].passed === false);
}

console.log('scoreValidation — pide b2 y aprueba piso + bloque → b2');
{
  const items = [...levelItems('b1', 5), ...levelItems('b2', 5)];
  const answers = [
    ...answersAllCorrect(levelItems('b1', 5)),
    ...answersRatio(levelItems('b2', 5), 0.6), // 3/5 = exactamente 60%
  ];
  const result = scoreValidation('b2', items, answers);
  check('otorga b2 en el umbral exacto', result.level === 'b2');
  check('passed es true', result.passed === true);
  check('ambos bloques aprobados', result.blocks.every((block) => block.passed));
}

console.log('scoreValidation — examen cortado: bloque sin ítems rendidos no otorga nivel');
{
  const items = levelItems('b1', 5); // pidió b2 pero solo rindió el piso
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

if (failures > 0) {
  console.error(`\n${failures} invariante(s) de placement-scoring fallaron.`);
  process.exit(1);
}
console.log('\nTodas las invariantes de placement-scoring pasaron.');
