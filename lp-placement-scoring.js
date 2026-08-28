/**
 * Motor de scoring del examen de nivel — gate de validación del nivel solicitado.
 *
 * No ubica al usuario: confirma (o no) el nivel que él mismo pidió en la encuesta.
 * Pedir B1 evalúa el bloque B1; pedir B2 evalúa primero un piso B1 y luego el
 * bloque B2. Si algún bloque se reprueba, el resultado cae a FALLBACK_LEVEL —
 * no se otorga un nivel intermedio, porque el usuario no lo pidió ni lo demostró.
 * A1/A2 no se validan: son encuesta pura y nunca llegan acá.
 *
 * Función pura: no toca localStorage, DOM ni red — solo recibe ítems + respuestas
 * y devuelve el resultado. Así es testeable de forma aislada (ver
 * DeskFlow/tests/placement-scoring-invariants.mjs). El clamp contra el nivel ya
 * ganado orgánicamente lo aplica el llamador (DeskFlow), que sí lee progreso.
 *
 * Canónica en Learn/scripts/; copy-shared.sh la distribuye a DeskFlow.
 */

/** Nivel al que se cae cuando el examen se reprueba o se abandona. */
export const FALLBACK_LEVEL = 'a1';

/** Ratio mínimo de aciertos por bloque para darlo por aprobado. */
export const PASS_THRESHOLD = { b1: 0.7, b2: 0.6 };

/**
 * Ítems servidos por bloque — un subconjunto fijo del banco (ver
 * lp-placement-items.json), no el banco entero. 10 es el piso práctico para
 * que un corte pass/fail sea representable exacto en ambos umbrales (0.7 →
 * 7/10, 0.6 → 6/10) y no dependa de a qué se redondea.
 */
export const BLOCK_SIZE = { b1: 10, b2: 10 };

/**
 * Tamaño del piso B1 cuando se pide B2. Antes era más chico que el bloque B1
 * completo (5 ítems, redondeando el 70% a 4/5 = 80% real) — quien pedía B2
 * enfrentaba un piso más estricto que quien pedía B1 sin que nada lo hubiera
 * decidido. Con el mismo tamaño que BLOCK_SIZE.b1, el umbral es idéntico
 * (7/10) en los dos casos.
 */
export const FLOOR_BLOCK_SIZE = BLOCK_SIZE.b1;

/**
 * Sonda opcional de nivel C1, servida solo tras aprobar B2. Nunca decide el
 * nivel otorgado — scoreValidation la ignora porque C1 no aparece en
 * blocksFor() — solo enriquece el resultado final. Ver probeTriggerFor().
 */
export const PROBE_LEVEL = 'c1';
export const PROBE_SIZE = 5;

/** Bloques a rendir, en orden, para validar `requestedLevel`. Vacío si no se valida. */
export function blocksFor(requestedLevel) {
  if (requestedLevel === 'b1') return ['b1'];
  if (requestedLevel === 'b2') return ['b1', 'b2'];
  return [];
}

function blockResult(level, items, answers) {
  const entries = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.level === level);
  const total = entries.length;
  const correctCount = entries.reduce(
    (count, entry) => count + (answers[entry.index] === entry.item.correct ? 1 : 0),
    0
  );
  // Un bloque sin ítems rendidos (examen cortado antes de llegar) cuenta como
  // reprobado: nunca se demostró, así que no otorga nivel.
  const ratio = total === 0 ? 0 : correctCount / total;
  return { level, correctCount, total, ratio };
}

/** Puntúa un solo bloque de forma aislada — usado para anotar la sonda C1, que
 *  queda fuera del loop de scoreValidation (no está en blocksFor()). */
export function scoreBlock(level, items, answers) {
  return blockResult(level, items, answers);
}

/**
 * Decide si corresponde ofrecer la sonda C1 tras aprobar el bloque B2. Dispara
 * solo en los dos extremos donde 5 ítems más cambian algo:
 *  - al borde del corte (6-7 de 10): desambigua si el aprobado fue un B2 real
 *    o un empate que cayó del lado bueno — la única zona del examen donde 5
 *    ítems pueden cambiar una decisión.
 *  - en el techo (9-10 de 10): no cambia la decisión (ya es B2 sólido), pero
 *    detecta subplacement — si además contesta bien C1, el contenido B2 le
 *    va a quedar corto.
 * En el medio (8 de 10) no se sirve: ya está claro que es B2 sin evidencia de
 * más, así que sondear ahí no aporta nada que la analítica pueda usar.
 */
export function probeTriggerFor(b2Result) {
  if (!b2Result || !b2Result.passed) return false;
  if (b2Result.total !== BLOCK_SIZE.b2) return false;
  const cut = Math.round(b2Result.total * PASS_THRESHOLD.b2);
  const borderline = b2Result.correctCount <= cut + 1;
  const ceiling = b2Result.correctCount >= b2Result.total - 1;
  return borderline || ceiling;
}

/**
 * @param {string} requestedLevel - nivel que el usuario pidió en la encuesta ('b1' | 'b2').
 * @param {Array<{level: string, correct: string}>} items - ítems rendidos, en orden.
 * @param {Array<string|null>} answers - respuesta elegida, mismo índice que `items`.
 * @returns {{
 *   requested: string,
 *   passed: boolean,
 *   level: string,
 *   blocks: Array<{ level: string, correctCount: number, total: number, ratio: number, passed: boolean }>
 * }}
 */
export function scoreValidation(requestedLevel, items, answers) {
  const blocks = [];
  let passed = true;

  // Se corta en el primer bloque reprobado: si el piso B1 falla, el bloque B2
  // ni se puntúa — el resultado ya está decidido. Ítems de otros niveles (p.
  // ej. la sonda C1) no aparecen en blocksFor() y por lo tanto nunca se
  // procesan acá — es justo lo que permite mezclarlos en `items`/`answers`
  // sin que afecten esta decisión.
  for (const level of blocksFor(requestedLevel)) {
    const block = blockResult(level, items, answers);
    const blockPassed = block.ratio >= PASS_THRESHOLD[level];
    blocks.push({ ...block, passed: blockPassed });
    if (!blockPassed) {
      passed = false;
      break;
    }
  }

  // blocksFor() vacío ⇒ nivel no validable: no hay nada que aprobar.
  if (blocks.length === 0) passed = false;

  return {
    requested: requestedLevel,
    passed,
    level: passed ? requestedLevel : FALLBACK_LEVEL,
    blocks,
  };
}

/** PRNG determinista (mulberry32): mismo seed, misma secuencia siempre. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Elige `count` ítems de `pool` de forma determinista según `seed` (Fisher-
 * Yates sobre un PRNG con semilla). Necesario porque el banco tiene más ítems
 * por nivel que los servidos en un examen: sin esto, muestrear al azar en
 * cada carga rompería la reanudación (el índice guardado dejaría de apuntar
 * a la misma pregunta). El seed se genera una vez al empezar el examen y se
 * persiste en el snapshot — ver DeskFlow/lp-placement-test.js.
 */
export function pickItems(pool, count, seed) {
  const rand = mulberry32(seed);
  const copy = pool.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy.slice(0, Math.min(count, copy.length));
}
