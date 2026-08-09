/**
 * Motor de scoring del examen de placement B2+ — two-stage fixed-form.
 * Ver docs/placement-test-b2plus-plan.md para el diseño completo.
 *
 * Función pura: no toca localStorage, DOM ni red — solo recibe ítems + respuestas
 * y devuelve el resultado. Así es testeable de forma aislada (ver
 * DeskFlow/tests/placement-scoring-invariants.mjs).
 *
 * Canónica en Learn/scripts/; copy-shared.sh la distribuye a DeskFlow.
 */

export const STAGE1_LEVEL = 'b1';
export const STAGE1_PASS_THRESHOLD = 0.7;
export const STAGE2_LEVELS = ['b2', 'c1', 'c2'];
export const STAGE2_PASS_THRESHOLD = 0.6;

function blockResult(level, items, answers) {
  const indices = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.level === level);
  const total = indices.length;
  const correctCount = indices.reduce(
    (count, entry) => count + (answers[entry.index] === entry.item.correct ? 1 : 0),
    0
  );
  const ratio = total === 0 ? 0 : correctCount / total;
  return { level, correctCount, total, ratio };
}

/**
 * @param {Array<{level: string, correct: string}>} items - ítems del examen, en el orden rendido.
 * @param {Array<string|null>} answers - respuesta elegida por el usuario, mismo índice que `items`.
 * @returns {{
 *   level: string,
 *   stage1: { correctCount: number, total: number, ratio: number, passed: boolean },
 *   stage2Blocks: Array<{ level: string, correctCount: number, total: number, ratio: number, passed: boolean }>
 * }}
 */
export function scorePlacement(items, answers) {
  const stage1Raw = blockResult(STAGE1_LEVEL, items, answers);
  const stage1 = { ...stage1Raw, passed: stage1Raw.ratio >= STAGE1_PASS_THRESHOLD };

  if (!stage1.passed) {
    return { level: STAGE1_LEVEL, stage1, stage2Blocks: [] };
  }

  const stage2Blocks = [];
  let finalLevel = STAGE1_LEVEL;
  for (const level of STAGE2_LEVELS) {
    const block = blockResult(level, items, answers);
    const passed = block.ratio >= STAGE2_PASS_THRESHOLD;
    stage2Blocks.push({ ...block, passed });
    if (!passed) break;
    finalLevel = level;
  }

  return { level: finalLevel, stage1, stage2Blocks };
}
