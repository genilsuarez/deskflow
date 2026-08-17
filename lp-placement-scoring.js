/**
 * Motor de scoring del examen de nivel — gate de validación del nivel solicitado.
 *
 * No ubica al usuario: confirma (o no) el nivel que él mismo pidió en la encuesta.
 * Pedir B1 evalúa el bloque B1; pedir B2 evalúa primero un piso B1 abreviado y
 * luego el bloque B2. Si algún bloque se reprueba, el resultado cae a FALLBACK_LEVEL
 * — no se otorga un nivel intermedio, porque el usuario no lo pidió ni lo demostró.
 * A1/A2 no se validan: son encuesta pura y nunca llegan acá.
 *
 * Función pura: no toca localStorage, DOM ni red — solo recibe ítems + respuestas
 * y devuelve el resultado. Así es testeable de forma aislada (ver
 * DeskFlow/tests/placement-scoring-invariants.mjs). El clamp contra el nivel ya
 * ganado orgánicamente lo aplica el llamador (DeskFlow), que sí lee progreso.
 *
 * Canónica en Learn/scripts/; copy-shared.sh la distribuye a DeskFlow.
 */

/** Niveles que exigen examen. A1/A2 se auto-reportan sin validar. */
export const VALIDATABLE_LEVELS = ['b1', 'b2'];

/** Nivel al que se cae cuando el examen se reprueba o se abandona. */
export const FALLBACK_LEVEL = 'a1';

/** Ratio mínimo de aciertos por bloque para darlo por aprobado. */
export const PASS_THRESHOLD = { b1: 0.7, b2: 0.6 };

/**
 * Tamaño del piso B1 cuando se pide B2. Quien pide B2 igual verifica un piso B1
 * real, pero forzarle el bloque B1 completo es fricción innecesaria: se acorta
 * la verificación en vez de eliminarla.
 */
export const FLOOR_BLOCK_SIZE = 5;

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
  // ni se puntúa — el resultado ya está decidido.
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
