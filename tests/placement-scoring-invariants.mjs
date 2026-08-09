#!/usr/bin/env node
// Invariantes del motor de scoring del placement test — prueba compartida.
//
// Canónica en Learn/scripts/; copy-shared.sh la distribuye a tests/ de cada app.
// No editar las copias: el chequeo de deriva del build las revierte.
//
// Son pruebas funcionales: importan el módulo real (scorePlacement) y lo
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

const { scorePlacement } = await import(scoringPath);

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

console.log('scorePlacement — reprueba etapa 1 (< 70% en B1)');
{
  const items = levelItems('b1', 15);
  const answers = answersRatio(items, 0.6); // 9/15 = 60%, por debajo del gate
  const result = scorePlacement(items, answers);
  check('nivel final es b1', result.level === 'b1');
  check('stage1.passed es false', result.stage1.passed === false);
  check('no evalúa stage2', result.stage2Blocks.length === 0);
}

console.log('scorePlacement — aprueba etapa 1 exacto en el umbral (70%)');
{
  const items = levelItems('b1', 20);
  const answers = answersRatio(items, 0.7); // 14/20 = exactamente 70%
  const result = scorePlacement(items, answers);
  check('stage1.passed es true en el umbral', result.stage1.passed === true);
}

console.log('scorePlacement — aprueba etapa 1, reprueba el primer bloque de etapa 2 (queda en b1)');
{
  const items = [...levelItems('b1', 15), ...levelItems('b2', 5), ...levelItems('c1', 5), ...levelItems('c2', 5)];
  const answers = [
    ...answersAllCorrect(levelItems('b1', 15)),
    ...answersRatio(levelItems('b2', 5), 0.4), // < 60%, corta acá
    ...levelItems('c1', 5).map(() => 'WRONG'), // no debería ni importar
    ...levelItems('c2', 5).map(() => 'WRONG'),
  ];
  const result = scorePlacement(items, answers);
  check('nivel final es b1 (piso confirmado, techo no sube)', result.level === 'b1');
  check('solo evalúa el bloque b2 antes de cortar', result.stage2Blocks.length === 1);
  check('el bloque b2 queda marcado como no aprobado', result.stage2Blocks[0].passed === false);
}

console.log('scorePlacement — sube hasta b2 (aprueba b2, reprueba c1)');
{
  const items = [...levelItems('b1', 15), ...levelItems('b2', 5), ...levelItems('c1', 5), ...levelItems('c2', 5)];
  const answers = [
    ...answersAllCorrect(levelItems('b1', 15)),
    ...answersAllCorrect(levelItems('b2', 5)),
    ...answersRatio(levelItems('c1', 5), 0.4),
    ...levelItems('c2', 5).map(() => 'WRONG'),
  ];
  const result = scorePlacement(items, answers);
  check('nivel final es b2', result.level === 'b2');
  check('evalúa b2 y c1, corta antes de c2', result.stage2Blocks.length === 2);
}

console.log('scorePlacement — sube hasta c1 (aprueba b2 y c1, reprueba c2)');
{
  const items = [...levelItems('b1', 15), ...levelItems('b2', 5), ...levelItems('c1', 5), ...levelItems('c2', 5)];
  const answers = [
    ...answersAllCorrect(levelItems('b1', 15)),
    ...answersAllCorrect(levelItems('b2', 5)),
    ...answersAllCorrect(levelItems('c1', 5)),
    ...answersRatio(levelItems('c2', 5), 0.2),
  ];
  const result = scorePlacement(items, answers);
  check('nivel final es c1', result.level === 'c1');
  check('evalúa los 3 bloques de etapa 2', result.stage2Blocks.length === 3);
}

console.log('scorePlacement — sube hasta c2 (aprueba los tres bloques)');
{
  const items = [...levelItems('b1', 15), ...levelItems('b2', 5), ...levelItems('c1', 5), ...levelItems('c2', 5)];
  const answers = [
    ...answersAllCorrect(levelItems('b1', 15)),
    ...answersAllCorrect(levelItems('b2', 5)),
    ...answersAllCorrect(levelItems('c1', 5)),
    ...answersAllCorrect(levelItems('c2', 5)),
  ];
  const result = scorePlacement(items, answers);
  check('nivel final es c2', result.level === 'c2');
  check('los 3 bloques quedan aprobados', result.stage2Blocks.every((block) => block.passed));
}

if (failures > 0) {
  console.error(`\n${failures} invariante(s) de placement-scoring fallaron.`);
  process.exit(1);
}
console.log('\nTodas las invariantes de placement-scoring pasaron.');
