#!/usr/bin/env node
// Invariantes del motor de scoring del examen de nivel — prueba compartida.
//
// Canónica en Learn/scripts/; copy-shared.sh la distribuye a tests/ de cada app.
// No editar las copias: el chequeo de deriva del build las revierte.
//
// Son pruebas funcionales: importan el módulo real (scoreValidation) y lo
// ejecutan con ítems/respuestas sintéticas — no hacen grep sobre el fuente.
// El último bloque valida además el banco real (lp-placement-items.json), que
// es donde viven los defectos que ningún test sintético puede ver: sesgo de
// posición de la respuesta correcta, ids duplicados, niveles sin ítems
// suficientes para armar un bloque.
//
// Correr:  node tests/placement-scoring-invariants.mjs

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function locate(...candidates) {
  for (const rel of candidates) {
    const abs = resolve(HERE, rel);
    if (existsSync(abs)) return abs;
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
  probeLevelFor,
  probeTriggerFor,
  pickItems,
  pickBlock,
  typeQuota,
  TYPE_MIX,
  orderedOptions,
  isCorrect,
  expectedBlockSize,
  FALLBACK_LEVEL,
  VALIDATABLE_LEVELS,
  REQUESTABLE_LEVELS,
  BLOCK_SIZE,
  FLOOR_BLOCK_SIZE,
  PASS_THRESHOLD,
  PROBE_SIZE,
} = await import(pathToFileURL(scoringPath).href);

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
  check('b1 rinde solo su bloque — a2 no es validable, no hay piso', JSON.stringify(blocksFor('b1')) === JSON.stringify(['b1']));
  check('b2 rinde piso b1 + bloque b2', JSON.stringify(blocksFor('b2')) === JSON.stringify(['b1', 'b2']));
  check('c1 rinde piso b2 + bloque c1', JSON.stringify(blocksFor('c1')) === JSON.stringify(['b2', 'c1']));
  check('c2 rinde piso c1 + bloque c2', JSON.stringify(blocksFor('c2')) === JSON.stringify(['c1', 'c2']));
  check('ningún nivel apila más de dos bloques — el examen no crece con el nivel',
    VALIDATABLE_LEVELS.every((level) => blocksFor(level).length <= 2));
  check('todo nivel solicitable es validable', REQUESTABLE_LEVELS.every((level) => blocksFor(level).length > 0));
}

console.log('probeLevelFor — la sonda es el nivel siguiente al pedido');
{
  check('pedir b1 sondea b2', probeLevelFor('b1') === 'b2');
  check('pedir b2 sondea c1', probeLevelFor('b2') === 'c1');
  check('pedir c1 sondea c2', probeLevelFor('c1') === 'c2');
  check('el nivel más alto no tiene sonda', probeLevelFor(VALIDATABLE_LEVELS[VALIDATABLE_LEVELS.length - 1]) === null);
  check('un nivel no validable no tiene sonda', probeLevelFor('a2') === null);
  check('la sonda nunca es un bloque calificado del mismo examen',
    VALIDATABLE_LEVELS.every((level) => !blocksFor(level).includes(probeLevelFor(level))));
}

console.log('BLOCK_SIZE / FLOOR_BLOCK_SIZE — el umbral es representable exacto');
{
  check('todo nivel validable define tamaño de bloque',
    VALIDATABLE_LEVELS.every((level) => BLOCK_SIZE[level] === 10));
  check('todo nivel validable define umbral', VALIDATABLE_LEVELS.every((level) => PASS_THRESHOLD[level] > 0));
  check('el piso usa el mismo tamaño que el bloque completo — sin asimetría', FLOOR_BLOCK_SIZE === BLOCK_SIZE.b1);
  check('el piso de b2 espera 10 ítems', expectedBlockSize('b1', 'b2') === FLOOR_BLOCK_SIZE);
  check('el bloque pedido espera su BLOCK_SIZE', expectedBlockSize('b2', 'b2') === BLOCK_SIZE.b2);
  check('cada umbral cae en un entero exacto sobre 10 ítems',
    VALIDATABLE_LEVELS.every((level) => Number.isInteger(BLOCK_SIZE[level] * PASS_THRESHOLD[level])));
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
  check('sin ningún bloque aprobado, cae al fallback', result.level === FALLBACK_LEVEL);
  check('passed es false', result.passed === false);
}

console.log('scoreValidation — pide b2, el piso b1 (10 ítems) con 7/10 exacto también aprueba');
{
  // El piso abreviado de una versión anterior (5 ítems) exigía 4/5 = 80% real —
  // más estricto que el bloque b1 completo. Con FLOOR_BLOCK_SIZE igual a
  // BLOCK_SIZE.b1, el mismo 70% (7/10) rige en los dos casos.
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

console.log('scoreValidation — pide b2, aprueba el piso y reprueba b2 → conserva b1');
{
  // Antes caía a a1: sacar 10/10 en el piso B1 y fallar B2 dejaba al usuario
  // tratado como principiante absoluto, borrando un B1 demostrado en el mismo
  // examen. Se otorga el bloque más alto efectivamente aprobado.
  const b1 = levelItems('b1', BLOCK_SIZE.b1);
  const b2 = levelItems('b2', BLOCK_SIZE.b2);
  const items = [...b1, ...b2];
  const answers = [...answersAllCorrect(b1), ...answersWithCount(b2, 4)]; // 4/10 = 40%, bajo el 60%
  const result = scoreValidation('b2', items, answers);
  check('NO otorga b2', result.level !== 'b2');
  check('otorga b1 — el piso se aprobó y no se tira', result.level === 'b1');
  check('passed sigue siendo false: no confirmó lo que pidió', result.passed === false);
  check('puntúa ambos bloques', result.blocks.length === 2);
  check('el bloque b2 queda como no aprobado', result.blocks[1].passed === false);
}

console.log('scoreValidation — pide c1, aprueba el piso b2 y reprueba c1 → conserva b2');
{
  const b2 = levelItems('b2', FLOOR_BLOCK_SIZE);
  const c1 = levelItems('c1', BLOCK_SIZE.c1);
  const items = [...b2, ...c1];
  const answers = [...answersAllCorrect(b2), ...answersWithCount(c1, 3)];
  const result = scoreValidation('c1', items, answers);
  check('otorga b2, no a1', result.level === 'b2');
  check('passed es false', result.passed === false);
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

console.log('scoreValidation — un bloque incompleto nunca aprueba, por alto que sea el ratio');
{
  // Abandonar tras tres aciertos daba ratio 1.0 sobre 3 ítems. Sin exigir el
  // bloque completo, eso otorgaría el nivel: sería la forma barata de saltárselo.
  const items = levelItems('b1', 3);
  const answers = answersAllCorrect(items);
  const result = scoreValidation('b1', items, answers);
  check('3 de 3 con el bloque a medias no otorga b1', result.level === FALLBACK_LEVEL);
  check('el bloque se reporta como incompleto', result.blocks[0].complete === false);
  check('ratio perfecto pero no aprobado', result.blocks[0].ratio === 1 && result.blocks[0].passed === false);
}

console.log('scoreValidation — examen cortado: el piso aprobado cuenta, el bloque vacío no');
{
  const items = levelItems('b1', FLOOR_BLOCK_SIZE); // pidió b2 pero solo rindió el piso
  const answers = answersAllCorrect(items);
  const result = scoreValidation('b2', items, answers);
  check('el bloque b2 vacío reprueba', result.passed === false);
  check('pero el piso b1 rendido completo sí otorga b1', result.level === 'b1');
}

console.log('scoreValidation — un nivel no validable nunca otorga nivel');
{
  const result = scoreValidation('a2', [], []);
  check('sin bloques que rendir, passed es false', result.passed === false);
  check('no otorga a2 por la vía del examen', result.level === FALLBACK_LEVEL);
}

console.log('scoreValidation — los ítems de la sonda mezclados no afectan el pass/fail');
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

console.log('probeTriggerFor — solo dispara si el bloque se aprobó, en los dos extremos');
{
  const b2 = (correctCount) => ({ level: 'b2', correctCount, total: BLOCK_SIZE.b2, passed: correctCount >= 6 });
  check('no dispara si b2 reprobó (5/10)', probeTriggerFor(b2(5)) === false);
  check('dispara al borde del corte (6/10)', probeTriggerFor(b2(6)) === true);
  check('dispara al borde del corte (7/10)', probeTriggerFor(b2(7)) === true);
  check('NO dispara en el medio (8/10) — ya es sólido sin evidencia de más', probeTriggerFor(b2(8)) === false);
  check('dispara en el techo (9/10)', probeTriggerFor(b2(9)) === true);
  check('dispara en el techo (10/10)', probeTriggerFor(b2(10)) === true);
  check('no dispara sin resultado', probeTriggerFor(null) === false);
  check('no dispara con un bloque de otro tamaño', probeTriggerFor({ level: 'b2', correctCount: 6, total: 5, passed: true }) === false);
  check('funciona igual para c1 (7/10 al borde)', probeTriggerFor({ level: 'c1', correctCount: 7, total: 10, passed: true }) === true);
}

console.log('isCorrect — opción múltiple exacta, cloze normalizado');
{
  const mc = { level: 'b1', correct: 'swimming', options: ['swimming', 'swam'] };
  check('acierto exacto', isCorrect(mc, 'swimming') === true);
  check('otra opción falla', isCorrect(mc, 'swam') === false);
  check('sin respuesta falla', isCorrect(mc, null) === false);
  check('la opción múltiple NO normaliza — el texto viene del propio botón', isCorrect(mc, 'Swimming') === false);

  const cloze = { level: 'b1', type: 'cloze', correct: "doesn't", accept: ['does not'] };
  check('cloze ignora mayúsculas', isCorrect(cloze, "DOESN'T") === true);
  check('cloze ignora espacios de sobra', isCorrect(cloze, "  doesn't  ") === true);
  check('cloze ignora puntuación final', isCorrect(cloze, "doesn't.") === true);
  check('cloze acepta las variantes de accept', isCorrect(cloze, 'Does not') === true);
  check('cloze no acepta cualquier cosa', isCorrect(cloze, 'do not') === false);
  check('cloze vacío falla', isCorrect(cloze, '   ') === false);
}

console.log('pickItems — determinista, sin repetir, y estratificado por destreza');
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

  // 5 destrezas × 6 ítems, se piden 10: estratificando toca las 5 sí o sí.
  const skills = ['s1', 's2', 's3', 's4', 's5'];
  const skilled = skills.flatMap((skill) => Array.from({ length: 6 }, (_, i) => ({ id: `${skill}-${i}`, skill })));
  let everySkillAlways = true;
  let neverOverloads = true;
  for (let seed = 1; seed <= 300; seed++) {
    const picked = pickItems(skilled, 10, seed);
    const seen = new Set(picked.map((item) => item.skill));
    if (seen.size !== skills.length) everySkillAlways = false;
    const counts = skills.map((skill) => picked.filter((item) => item.skill === skill).length);
    if (Math.max(...counts) - Math.min(...counts) > 1) neverOverloads = false;
  }
  check('todo examen cubre todas las destrezas del pool', everySkillAlways);
  check('ninguna destreza se lleva más de un ítem de ventaja sobre otra', neverOverloads);
  check('el pool sin skill sigue funcionando (muestreo plano)', pickItems(pool, 10, 7).length === 10);

  // Reintentar sin esto repite preguntas cuya explicación ya se mostró, así que
  // el segundo intento mediría memoria del primero en vez de nivel.
  {
    const first = pickItems(skilled, 10, 11);
    const seen = first.map((item) => item.id);
    const second = pickItems(skilled, 10, 11, { exclude: seen });
    const repeated = second.filter((item) => seen.includes(item.id));
    check('con 30 ítems y 10 por examen, el reintento no repite ninguno', repeated.length === 0);
    check('el reintento sigue cubriendo todas las destrezas',
      new Set(second.map((item) => item.skill)).size === skills.length);
    check('excluir no reduce el tamaño del bloque', second.length === 10);
    check('mismo seed + misma exclusión → misma selección',
      JSON.stringify(second) === JSON.stringify(pickItems(skilled, 10, 11, { exclude: seen })));

    // Con todo el pool ya visto no se puede estrenar nada: hay que servir un
    // bloque completo igual, repitiendo, en vez de devolver menos ítems (un
    // bloque corto ya no aprueba nunca — ver la invariante de bloque completo).
    const allSeen = skilled.map((item) => item.id);
    const exhausted = pickItems(skilled, 10, 3, { exclude: allSeen });
    check('con el pool agotado sigue devolviendo un bloque completo', exhausted.length === 10);
    check('con el pool agotado no repite ítems dentro del mismo examen',
      new Set(exhausted.map((item) => item.id)).size === 10);
  }

  // `prefer` es lo que sostiene la reanudación: el examen se recompone con otro
  // pool (banco nuevo) y las respuestas guardadas tienen que seguir cayendo en
  // ítems que el bloque vuelve a servir.
  {
    const skills2 = ['s1', 's2', 's3', 's4', 's5'];
    const bank = skills2.flatMap((skill) => Array.from({ length: 6 }, (_, i) => ({ id: `${skill}-${i}`, skill })));
    const served = pickItems(bank, 10, 77);
    const servedIds = served.map((item) => item.id);

    // Se publica un banco nuevo: desaparecen 2 de los servidos y entran 5 ítems.
    const dropped = servedIds.slice(0, 2);
    const newBank = bank
      .filter((item) => !dropped.includes(item.id))
      .concat(skills2.slice(0, 5).map((skill, i) => ({ id: `${skill}-new${i}`, skill })));

    const withPrefer = pickItems(newBank, 10, 77, { prefer: servedIds });
    const kept = withPrefer.filter((item) => servedIds.includes(item.id));
    check('tras cambiar el banco, se conservan todos los ítems servidos que sobreviven',
      kept.length === servedIds.length - dropped.length);
    check('los ítems borrados del banco no reaparecen',
      withPrefer.every((item) => !dropped.includes(item.id)));
    check('el bloque recompuesto sigue completo', withPrefer.length === 10);

    const withoutPrefer = pickItems(newBank, 10, 77);
    check('sin prefer se pierden respuestas que sí eran recuperables',
      withoutPrefer.filter((item) => servedIds.includes(item.id)).length < kept.length);

    check('prefer manda sobre exclude — un ítem ya visto se conserva si este examen lo sirvió',
      pickItems(newBank, 10, 77, { prefer: servedIds, exclude: servedIds })
        .filter((item) => servedIds.includes(item.id)).length === kept.length);
  }
}

console.log('typeQuota / pickBlock — la mezcla de tipos de un bloque es siempre la misma');
{
  check('las proporciones suman 1', Math.abs(Object.values(TYPE_MIX).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  for (const size of [5, 10, 20]) {
    const quota = typeQuota(size);
    check(`la cuota de ${size} ítems suma exactamente ${size}`,
      Object.values(quota).reduce((a, b) => a + b, 0) === size);
    check(`ninguna cuota de ${size} es negativa`, Object.values(quota).every((n) => n >= 0));
  }
  check('un bloque de 10 lleva 7 opción múltiple, 2 escritas y 1 de audio',
    JSON.stringify(typeQuota(10)) === JSON.stringify({ mc: 7, cloze: 2, listen: 1 }));

  // El defecto que esto corrige: muestreando solo por destreza, un bloque de 10
  // salía con entre 0 y 5 cloze. Un cloze no tiene el 25% de acierto por azar
  // del MC, así que 7/10 sobre 5 cloze exige mucho más que 7/10 sobre ninguno:
  // el mismo umbral medía cosas distintas según lo que saliera sorteado.
  const skills = ['s1', 's2', 's3', 's4', 's5', 's6'];
  const pool = [];
  skills.forEach((skill) => {
    for (let i = 0; i < 5; i++) pool.push({ id: `mc-${skill}-${i}`, skill });
    for (let i = 0; i < 2; i++) pool.push({ id: `cz-${skill}-${i}`, skill, type: 'cloze' });
    pool.push({ id: `ls-${skill}`, skill, type: 'listen' });
  });

  const mixes = new Set();
  let alwaysFull = true;
  let neverRepeats = true;
  for (let seed = 1; seed <= 500; seed++) {
    const block = pickBlock(pool, 10, seed);
    if (block.length !== 10) alwaysFull = false;
    if (new Set(block.map((item) => item.id)).size !== block.length) neverRepeats = false;
    const counts = { mc: 0, cloze: 0, listen: 0 };
    block.forEach((item) => { counts[item.type || 'mc'] += 1; });
    mixes.add(JSON.stringify(counts));
  }
  check('la mezcla de tipos es idéntica en los 500 bloques', mixes.size === 1);
  check('la mezcla es la que fija typeQuota',
    mixes.has(JSON.stringify({ mc: 7, cloze: 2, listen: 1 })));
  check('todo bloque viene completo', alwaysFull);
  check('ningún ítem se repite dentro del bloque', neverRepeats);
  check('mismo seed → mismo bloque',
    JSON.stringify(pickBlock(pool, 10, 42)) === JSON.stringify(pickBlock(pool, 10, 42)));
  check('seeds distintos → bloques distintos',
    JSON.stringify(pickBlock(pool, 10, 42)) !== JSON.stringify(pickBlock(pool, 10, 43)));

  // Un pool sin cloze ni audio (o al que le faltan) tiene que seguir dando un
  // bloque completo: uno corto no aprueba nunca y dejaría el nivel inalcanzable.
  const onlyMc = pool.filter((item) => !item.type);
  check('un pool sin cloze ni audio sigue devolviendo el bloque completo',
    pickBlock(onlyMc, 10, 5).length === 10);
  check('nunca devuelve más de lo que hay en el pool',
    pickBlock(onlyMc.slice(0, 6), 10, 5).length === 6);

  // La preferencia por preguntas no vistas tiene que sobrevivir a la cuota.
  const first = pickBlock(pool, 10, 9);
  const seenIds = first.map((item) => item.id);
  const second = pickBlock(pool, 10, 9, { exclude: seenIds });
  const counts2 = { mc: 0, cloze: 0, listen: 0 };
  second.forEach((item) => { counts2[item.type || 'mc'] += 1; });
  check('el reintento conserva la mezcla de tipos',
    JSON.stringify(counts2) === JSON.stringify({ mc: 7, cloze: 2, listen: 1 }));
  check('el reintento estrena todo lo que el stock permite',
    second.filter((item) => seenIds.includes(item.id)).length <= 1);
}

console.log('orderedOptions — baraja determinista por ítem, sin sesgo de posición');
{
  const item = { id: 'x-1', question: 'q', options: ['A', 'B', 'C', 'D'], correct: 'A' };
  const first = orderedOptions(item, 4242);
  check('mismo ítem + mismo seed → mismo orden (la reanudación no se mueve)',
    JSON.stringify(first) === JSON.stringify(orderedOptions(item, 4242)));
  check('conserva exactamente las mismas opciones',
    JSON.stringify(first.slice().sort()) === JSON.stringify(item.options.slice().sort()));
  check('un ítem sin opciones no explota', orderedOptions({ id: 'y' }, 1).length === 0);

  // El defecto que esto corrige: en el banco v2 el 70% de las correctas de B2
  // caía en la segunda opción y responder siempre la segunda aprobaba el bloque.
  // Barajado, la correcta cae en cada posición ~25% de las veces.
  const positions = [0, 0, 0, 0];
  const runs = 4000;
  for (let seed = 1; seed <= runs; seed++) {
    positions[orderedOptions(item, seed).indexOf('A')]++;
  }
  const worst = Math.max(...positions.map((count) => Math.abs(count / runs - 0.25)));
  check(`la correcta se reparte uniforme entre las 4 posiciones (desvío máx ${(worst * 100).toFixed(1)}pp)`, worst < 0.03);
}

console.log('banco real — lp-placement-items.json');
{
  const bankPath = locate(
    '../public/lp-placement-items.json', // DeskFlow
    './lp-placement-items.json' // Learn/scripts (canónico)
  );
  if (!bankPath) {
    check('se encontró el banco de ítems', false);
  } else {
    const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
    const items = bank.items || [];

    check('el banco declara versión', typeof bank.version === 'string' && bank.version.length > 0);
    check('todo ítem tiene id', items.every((item) => typeof item.id === 'string' && item.id.length > 0));
    check('los ids son únicos — el orden de opciones se deriva de ellos',
      new Set(items.map((item) => item.id)).size === items.length);
    check('todo ítem tiene destreza (skill) para poder estratificar',
      items.every((item) => typeof item.skill === 'string' && item.skill.length > 0));
    check('todo ítem tiene explicación', items.every((item) => typeof item.explanation === 'string' && item.explanation.length > 0));

    // En los ítems de audio el estímulo es audioText, no el enunciado: varios
    // comparten a propósito la misma consigna ("Escucha y elige la frase…").
    const written = items.filter((item) => item.type !== 'listen');
    check('no hay preguntas repetidas', new Set(written.map((item) => item.question)).size === written.length);

    const mc = items.filter((item) => item.type !== 'cloze');
    check('toda opción múltiple ofrece 4 opciones', mc.every((item) => Array.isArray(item.options) && item.options.length === 4));
    check('la correcta está entre las opciones', mc.every((item) => item.options.includes(item.correct)));
    check('ninguna opción está duplicada dentro del ítem',
      mc.every((item) => new Set(item.options).size === item.options.length));

    const cloze = items.filter((item) => item.type === 'cloze');
    check('hay ítems de respuesta escrita (cloze), no solo opción múltiple', cloze.length > 0);
    check('ningún cloze trae options — se escribe, no se elige', cloze.every((item) => !item.options));
    check('todo cloze tiene una respuesta corta (no una frase entera)',
      cloze.every((item) => item.correct.trim().split(/\s+/).length <= 4));

    const listen = items.filter((item) => item.type === 'listen');
    check('hay ítems de comprensión oral', listen.length > 0);
    check('todo ítem de audio tiene audioText', listen.every((item) => typeof item.audioText === 'string' && item.audioText.length > 0));
    check('no hay audios repetidos', new Set(listen.map((item) => item.audioText)).size === listen.length);
    // Si el enunciado contuviera la frase hablada, el ítem mediría lectura.
    check('ningún enunciado revela su propio audio',
      listen.every((item) => !item.question.toLowerCase().includes(item.audioText.toLowerCase().replace(/\.$/, ''))));
    check('todo ítem de audio se responde eligiendo (necesita options)',
      listen.every((item) => Array.isArray(item.options) && item.options.length === 4));

    // Sin clip, el ítem cae a la voz del sistema operativo y su dificultad pasa
    // a depender del dispositivo. La UI tiene ese respaldo, pero un clip que
    // falta es un descuido del build, no un caso de uso.
    const audioDir = locate('../public/placement-audio', './../DeskFlow/public/placement-audio');
    if (!audioDir) {
      check('existe el directorio de clips de audio', false);
    } else {
      const missing = listen
        .map((item) => item.id)
        .filter((id) => !existsSync(resolve(audioDir, `${id}.m4a`)));
      check(
        `todo ítem de audio tiene su clip grabado${missing.length ? ' — faltan: ' + missing.join(', ') : ''}`,
        missing.length === 0
      );
    }

    // Sin esto, un nivel con menos ítems que BLOCK_SIZE serviría un bloque
    // incompleto que, tras el fix de "bloque incompleto no aprueba", sería
    // imposible de aprobar: nadie podría obtener ese nivel nunca.
    for (const level of VALIDATABLE_LEVELS) {
      const pool = items.filter((item) => item.level === level);
      const needed = Math.max(BLOCK_SIZE[level], FLOOR_BLOCK_SIZE);
      check(`${level}: alcanza para armar un bloque completo (${pool.length} ≥ ${needed})`, pool.length >= needed);
      check(`${level}: hay margen para reintentar sin repetir medio examen (${pool.length} ≥ ${needed * 2})`, pool.length >= needed * 2);
      // Sin síntesis de voz la UI retira los ítems de audio del banco; el resto
      // tiene que seguir alcanzando para armar un bloque completo, o en ese
      // entorno el nivel sería imposible de aprobar.
      const withoutAudio = pool.filter((item) => item.type !== 'listen');
      check(`${level}: sigue alcanzando sin los ítems de audio (${withoutAudio.length} ≥ ${needed})`, withoutAudio.length >= needed);
      const skills = new Set(pool.map((item) => item.skill));
      check(`${level}: el bloque cubre al menos 6 destrezas distintas (${skills.size})`, skills.size >= 6);
      check(`${level}: ninguna destreza domina el pool (máx 1/3)`,
        Array.from(skills).every((skill) => pool.filter((item) => item.skill === skill).length <= Math.ceil(pool.length / 3)));
    }

    // La sonda se sirve entera o no se sirve: un pool corto la dejaría trunca.
    for (const level of VALIDATABLE_LEVELS) {
      const probe = probeLevelFor(level);
      if (!probe) continue;
      const pool = items.filter((item) => item.level === probe);
      check(`la sonda de ${level} (${probe}) tiene ítems suficientes`, pool.length >= PROBE_SIZE);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} invariante(s) de placement-scoring fallaron.`);
  process.exit(1);
}
console.log('\nTodas las invariantes de placement-scoring pasaron.');
