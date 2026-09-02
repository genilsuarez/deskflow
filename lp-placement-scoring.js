/**
 * Motor de scoring del examen de nivel — gate de validación del nivel solicitado.
 *
 * No ubica al usuario: confirma (o no) el nivel que él mismo pidió en la encuesta.
 * Cada nivel validable se rinde con un piso del nivel anterior (cuando ese
 * anterior también es validable) más el bloque del nivel pedido — ver blocksFor().
 * A1/A2 no se validan: son encuesta pura y nunca llegan acá.
 *
 * Reprobar no borra lo demostrado: el resultado otorga el bloque más alto que sí
 * se aprobó (pedir B2 y aprobar solo el piso B1 otorga B1), y solo cae a
 * FALLBACK_LEVEL cuando no se aprobó ningún bloque. Un bloque solo cuenta como
 * aprobado si se rindió completo — abandonar tras tres aciertos no otorga nada.
 *
 * Función pura: no toca localStorage, DOM ni red — solo recibe ítems + respuestas
 * y devuelve el resultado. Así es testeable de forma aislada (ver
 * DeskFlow/tests/placement-scoring-invariants.mjs). El clamp contra el nivel ya
 * ganado orgánicamente lo aplica el llamador (DeskFlow), que sí lee progreso.
 *
 * Canónica en Learn/scripts/; copy-shared.sh la distribuye a DeskFlow.
 */

/** Nivel al que se cae cuando no se aprueba ni un solo bloque. */
export const FALLBACK_LEVEL = 'a1';

/**
 * Niveles que el examen sabe validar, de menor a mayor. A1/A2 quedan fuera a
 * propósito: se auto-reportan en la encuesta y no hay nada que demostrar.
 */
export const VALIDATABLE_LEVELS = Object.freeze(['b1', 'b2', 'c1', 'c2']);

/**
 * Niveles que la encuesta ofrece pedir. Subconjunto de VALIDATABLE_LEVELS: C2
 * se puede validar (se usa como sonda sobre C1) pero no se ofrece, porque hoy
 * solo FluentFlow tiene catálogo C2 — otorgarlo dejaría HubFlow y LyricFlow sin
 * contenido en el nivel activo. Ampliar acá en cuanto exista ese contenido.
 */
export const REQUESTABLE_LEVELS = Object.freeze(['b1', 'b2', 'c1']);

/** Ratio mínimo de aciertos por bloque para darlo por aprobado. */
export const PASS_THRESHOLD = { b1: 0.7, b2: 0.6, c1: 0.6, c2: 0.6 };

/**
 * Ítems servidos por bloque — un subconjunto fijo del banco (ver
 * lp-placement-items.json), no el banco entero. 10 es el piso práctico para
 * que un corte pass/fail sea representable exacto en ambos umbrales (0.7 →
 * 7/10, 0.6 → 6/10) y no dependa de a qué se redondea.
 */
export const BLOCK_SIZE = { b1: 10, b2: 10, c1: 10, c2: 10 };

/**
 * Tamaño del bloque piso. Igual que el bloque completo del mismo nivel: si el
 * piso fuera más chico, el umbral efectivo cambiaría (con 5 ítems, el 70% se
 * redondea a 4/5 = 80% real) y quien pide un nivel alto enfrentaría un piso más
 * estricto que quien pide ese piso directo, sin que nada lo hubiera decidido.
 */
export const FLOOR_BLOCK_SIZE = 10;

/**
 * Sonda opcional del nivel siguiente al pedido, servida solo tras aprobarlo.
 * Nunca decide el nivel otorgado — scoreValidation la ignora porque el nivel de
 * la sonda no aparece en blocksFor() — solo enriquece el resultado final.
 * Ver probeLevelFor() y probeTriggerFor().
 */
export const PROBE_SIZE = 5;

/** Nivel inmediatamente inferior a `level` dentro de los validables, o null. */
function previousValidatable(level) {
  const index = VALIDATABLE_LEVELS.indexOf(level);
  return index > 0 ? VALIDATABLE_LEVELS[index - 1] : null;
}

/**
 * Bloques a rendir, en orden, para validar `requestedLevel`. Vacío si no se
 * valida. El piso es el nivel validable anterior — B1 no tiene (A2 no se
 * valida), así que se rinde solo; B2 rinde B1+B2; C1 rinde B2+C1. Nunca se
 * apilan más de dos bloques: pedir C1 no obliga a re-demostrar B1, que el
 * bloque B2 ya cubre implícitamente.
 */
export function blocksFor(requestedLevel) {
  if (!VALIDATABLE_LEVELS.includes(requestedLevel)) return [];
  const floor = previousValidatable(requestedLevel);
  return floor ? [floor, requestedLevel] : [requestedLevel];
}

/** Nivel de la sonda opcional para `requestedLevel`: el siguiente validable, o null. */
export function probeLevelFor(requestedLevel) {
  const index = VALIDATABLE_LEVELS.indexOf(requestedLevel);
  if (index < 0) return null;
  return VALIDATABLE_LEVELS[index + 1] || null;
}

/**
 * Ítems que se sirven de `level` cuando se pidió `requestedLevel`. El piso usa
 * FLOOR_BLOCK_SIZE; el bloque del nivel pedido, su BLOCK_SIZE. Se usa también
 * para exigir que el bloque se haya rendido completo antes de darlo por
 * aprobado (ver blockResult).
 */
export function expectedBlockSize(level, requestedLevel) {
  const order = blocksFor(requestedLevel);
  if (order.length > 1 && order[0] === level) return FLOOR_BLOCK_SIZE;
  return BLOCK_SIZE[level] || 0;
}

/** Normaliza una respuesta escrita: sin mayúsculas, espacios de más ni puntuación final. */
function normalizeText(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '');
}

/**
 * ¿La respuesta dada acierta el ítem? Los ítems de opción múltiple guardan el
 * texto de la opción elegida y se comparan exacto. Los de tipo `cloze` (el
 * usuario escribe) se comparan normalizados contra `correct` más las variantes
 * de `accept` — que existen para las respuestas con más de una forma válida
 * ("don't" / "do not"), no para aflojar el corte.
 */
export function isCorrect(item, answer) {
  if (!item || answer == null) return false;
  if (item.type === 'cloze') {
    const accepted = [item.correct].concat(item.accept || []).map(normalizeText);
    return accepted.includes(normalizeText(answer));
  }
  return answer === item.correct;
}

function blockResult(level, items, answers, requestedLevel) {
  const entries = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.level === level);
  const total = entries.length;
  const correctCount = entries.reduce(
    (count, entry) => count + (isCorrect(entry.item, answers[entry.index]) ? 1 : 0),
    0
  );
  const ratio = total === 0 ? 0 : correctCount / total;
  // Un bloque incompleto (examen cortado antes de terminarlo) nunca aprueba,
  // aunque el ratio parcial dé alto: abandonar con 3 de 3 aciertos no demuestra
  // el nivel, y sin esta guarda sería la forma barata de saltarse el bloque.
  const expected = requestedLevel == null ? total : expectedBlockSize(level, requestedLevel);
  const complete = total > 0 && total >= expected;
  return { level, correctCount, total, ratio, complete };
}

/** Puntúa un solo bloque de forma aislada — usado para anotar la sonda, que
 *  queda fuera del loop de scoreValidation (no está en blocksFor()). */
export function scoreBlock(level, items, answers) {
  return blockResult(level, items, answers, null);
}

/**
 * Decide si corresponde ofrecer la sonda tras aprobar el bloque del nivel
 * pedido. Dispara solo en los dos extremos donde 5 ítems más cambian algo:
 *  - al borde del corte (6-7 de 10): desambigua si el aprobado fue sólido o un
 *    empate que cayó del lado bueno — la única zona donde 5 ítems pueden
 *    cambiar una decisión.
 *  - en el techo (9-10 de 10): no cambia la decisión, pero detecta
 *    subplacement — si además contesta bien el nivel siguiente, el contenido
 *    del nivel otorgado le va a quedar corto.
 * En el medio (8 de 10) no se sirve: ya está claro que el nivel es correcto sin
 * evidencia de más, así que sondear ahí no aporta nada que la analítica use.
 */
export function probeTriggerFor(topResult) {
  if (!topResult || !topResult.passed) return false;
  const expected = BLOCK_SIZE[topResult.level];
  if (!expected || topResult.total !== expected) return false;
  const threshold = PASS_THRESHOLD[topResult.level];
  if (threshold == null) return false;
  const cut = Math.round(topResult.total * threshold);
  const borderline = topResult.correctCount <= cut + 1;
  const ceiling = topResult.correctCount >= topResult.total - 1;
  return borderline || ceiling;
}

/**
 * @param {string} requestedLevel - nivel que el usuario pidió en la encuesta.
 * @param {Array<{level: string, correct: string}>} items - ítems rendidos, en orden.
 * @param {Array<string|null>} answers - respuesta dada, mismo índice que `items`.
 * @returns {{
 *   requested: string,
 *   passed: boolean,
 *   level: string,
 *   blocks: Array<{ level, correctCount, total, ratio, complete, passed }>
 * }}
 */
export function scoreValidation(requestedLevel, items, answers) {
  const blocks = [];
  let passed = true;
  // Nivel más alto efectivamente demostrado. Arranca en el fallback y sube con
  // cada bloque aprobado, así que reprobar el bloque de arriba conserva el piso
  // que sí se aprobó en el mismo examen en vez de tirarlo a A1.
  let granted = FALLBACK_LEVEL;

  // Se corta en el primer bloque reprobado: si el piso falla, el bloque de
  // arriba ni se puntúa — el resultado ya está decidido. Ítems de otros niveles
  // (p. ej. la sonda) no aparecen en blocksFor() y por lo tanto nunca se
  // procesan acá — es justo lo que permite mezclarlos en `items`/`answers` sin
  // que afecten esta decisión.
  for (const level of blocksFor(requestedLevel)) {
    const block = blockResult(level, items, answers, requestedLevel);
    const blockPassed = block.complete && block.ratio >= PASS_THRESHOLD[level];
    blocks.push({ ...block, passed: blockPassed });
    if (!blockPassed) {
      passed = false;
      break;
    }
    granted = level;
  }

  // blocksFor() vacío ⇒ nivel no validable: no hay nada que aprobar.
  if (blocks.length === 0) passed = false;

  return { requested: requestedLevel, passed, level: granted, blocks };
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

/** Hash estable de una cadena (FNV-1a de 32 bits) — deriva un sub-seed por ítem. */
function hashString(value) {
  let hash = 0x811c9dc5;
  const str = String(value == null ? '' : value);
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Fisher-Yates sobre un PRNG ya construido. Devuelve una copia. */
function shuffleWith(list, rand) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Elige `count` ítems de `pool` de forma determinista según `seed`. Necesario
 * porque el banco tiene más ítems por nivel que los servidos en un examen: sin
 * esto, muestrear al azar en cada carga rompería la reanudación (la respuesta
 * guardada dejaría de corresponder a la misma pregunta). El seed se genera una
 * vez al empezar el examen y se persiste en el snapshot — ver
 * DeskFlow/lp-placement-test.js.
 *
 * El muestreo es estratificado por `skill`: reparte round-robin entre las
 * destrezas presentes en el pool en vez de tomar 10 al azar. Sin esto, dos
 * usuarios del mismo nivel real reciben exámenes de cobertura distinta — uno
 * con cuatro ítems de idioms y cero de reported speech, otro al revés — y el
 * corte pass/fail termina midiendo qué salió sorteado. Un pool sin `skill`
 * (ítems sintéticos de los tests) cae al muestreo plano.
 *
 * `opts.exclude` son los ítems que el usuario ya vio en intentos anteriores. No
 * se descartan (dejarían pools cortos tras varios intentos): se posponen dentro
 * de su propia destreza, así que un reintento estrena todo lo que pueda antes
 * de repetir nada. Importa porque el examen muestra la explicación al
 * responder: repetir un ítem ya visto mide memoria del intento anterior, no
 * nivel.
 *
 * `opts.prefer` hace lo contrario y manda sobre `exclude`: son los ítems que
 * este examen ya sirvió y que hay que volver a elegir si siguen existiendo. Lo
 * usa la reanudación — sin esto, publicar un banco nuevo remuestrea el bloque y
 * la mayoría de las respuestas guardadas quedan huérfanas aunque sus ítems
 * sigan en el banco.
 *
 * Las dos preferencias se aplican dentro de cada destreza, no sobre el pool
 * entero, para no sacrificar la cobertura por estrenar (o conservar) preguntas.
 */
export function pickItems(pool, count, seed, opts) {
  const rand = mulberry32(seed);
  const shuffled = shuffleWith(pool, rand);
  const wanted = Math.min(count, shuffled.length);

  const asSet = (value) => (value instanceof Set ? value : new Set(value || []));
  const seen = asSet(opts && opts.exclude);
  const prefer = asSet(opts && opts.prefer);
  const idOf = (item) => (item && item.id != null ? item.id : null);
  // 0 = a conservar, 1 = sin estrenar, 2 = ya visto en otro intento.
  const priority = (item) => {
    const id = idOf(item);
    if (id !== null && prefer.has(id)) return 0;
    return id !== null && seen.has(id) ? 2 : 1;
  };

  const buckets = new Map();
  for (const item of shuffled) {
    const skill = item && item.skill ? item.skill : '';
    if (!buckets.has(skill)) buckets.set(skill, []);
    buckets.get(skill).push(item);
  }

  // Dentro de cada destreza: primero lo que hay que conservar, luego lo no
  // visto, y por último lo repetido. El orden dentro de cada grupo lo sigue
  // decidiendo el seed, porque `shuffled` ya venía barajado.
  const stable = seen.size === 0 && prefer.size === 0;
  const groups = Array.from(buckets.values()).map((group) =>
    stable ? group : group.slice().sort((a, b) => priority(a) - priority(b))
  );

  // Una sola destreza (o ninguna): estratificar no cambia nada.
  if (groups.length <= 1) return (groups[0] || []).slice(0, wanted);

  // El orden de las destrezas ya es aleatorio-determinista: viene de su primera
  // aparición en `shuffled`, que depende del seed.
  const picked = [];
  while (picked.length < wanted) {
    let tookOne = false;
    for (const group of groups) {
      if (picked.length >= wanted) break;
      if (group.length === 0) continue;
      picked.push(group.shift());
      tookOne = true;
    }
    if (!tookOne) break;
  }
  return picked;
}

/**
 * Reparto de tipos de ítem dentro de un bloque, como proporción. Existe porque
 * los tres tipos no cuestan lo mismo: en opción múltiple se acierta el 25% sin
 * saber nada, y en un cloze se escribe desde cero. Sin cuota fija, muestrear 10
 * ítems al azar daba bloques de entre 0 y 5 cloze (medido sobre el banco v4), y
 * un 7/10 sobre 5 cloze exige muchísimo más que un 7/10 sobre ninguno: el mismo
 * umbral estaría midiendo cosas distintas según lo que saliera sorteado, y
 * calibrarlo sería imposible.
 */
export const TYPE_MIX = Object.freeze({ mc: 0.7, cloze: 0.2, listen: 0.1 });

/** Tipo efectivo de un ítem: los que no lo declaran son opción múltiple. */
function typeOf(item) {
  return (item && item.type) || 'mc';
}

/**
 * Cuántos ítems de cada tipo lleva un bloque de `size`. Reparte por la parte
 * entera y asigna el resto a los tipos con mayor fracción pendiente, así que la
 * suma es exactamente `size` para cualquier tamaño (10 → 7/2/1; 5 → 3/1/1).
 */
export function typeQuota(size) {
  const names = Object.keys(TYPE_MIX);
  const exact = names.map((name) => ({ name, want: size * TYPE_MIX[name] }));
  const quota = {};
  let assigned = 0;
  for (const entry of exact) {
    quota[entry.name] = Math.floor(entry.want);
    assigned += quota[entry.name];
  }
  const leftovers = exact
    .map((entry) => ({ name: entry.name, frac: entry.want - Math.floor(entry.want) }))
    .sort((a, b) => b.frac - a.frac || names.indexOf(a.name) - names.indexOf(b.name));
  let index = 0;
  while (assigned < size && leftovers.length > 0) {
    quota[leftovers[index % leftovers.length].name] += 1;
    assigned += 1;
    index += 1;
  }
  return quota;
}

/**
 * Arma un bloque de `count` ítems con la mezcla de tipos de TYPE_MIX, y dentro
 * de cada tipo con el muestreo estratificado por destreza de pickItems(). Si un
 * tipo no tiene ítems suficientes en el pool, el faltante lo cubren los demás:
 * un bloque corto no aprueba nunca (ver `complete` en blockResult), así que
 * devolver menos de `count` dejaría el nivel imposible de obtener.
 */
export function pickBlock(pool, count, seed, opts) {
  const byType = new Map();
  for (const item of pool) {
    const type = typeOf(item);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(item);
  }

  const quota = typeQuota(Math.min(count, pool.length));
  const picked = [];
  const takenIds = new Set();
  const take = (type, howMany) => {
    if (howMany <= 0) return;
    const available = (byType.get(type) || []).filter((item) => !takenIds.has(item.id));
    // Sub-seed por tipo: si los tres compartieran seed, sus barajados quedarían
    // correlacionados y el bloque sería menos variado de lo que parece.
    const chosen = pickItems(available, howMany, (seed ^ hashString(type)) >>> 0, opts);
    for (const item of chosen) {
      picked.push(item);
      if (item && item.id != null) takenIds.add(item.id);
    }
  };

  for (const type of Object.keys(quota)) take(type, quota[type]);

  // Relleno del faltante (un tipo sin stock suficiente), por orden de cuota:
  // primero opción múltiple, que es el tipo del que siempre sobra.
  for (const type of Object.keys(quota)) {
    if (picked.length >= Math.min(count, pool.length)) break;
    take(type, Math.min(count, pool.length) - picked.length);
  }

  // Se intercalan por tipo en vez de dejar los cloze en bloque al final: una
  // tanda seguida de preguntas escritas se percibe como un examen distinto.
  const queues = new Map();
  for (const item of picked) {
    const type = typeOf(item);
    if (!queues.has(type)) queues.set(type, []);
    queues.get(type).push(item);
  }
  const groups = shuffleWith(Array.from(queues.values()), mulberry32(seed));
  const out = [];
  while (out.length < picked.length) {
    let tookOne = false;
    for (const group of groups) {
      if (group.length === 0) continue;
      out.push(group.shift());
      tookOne = true;
    }
    if (!tookOne) break;
  }
  return out;
}

/**
 * Orden en que se muestran las opciones de un ítem. El banco las guarda con la
 * correcta en una posición fija por ítem y, sin barajar, esa posición se
 * concentra: en el banco v2 el 70% de las correctas de B2 caía en la segunda
 * opción, así que responder siempre la segunda aprobaba el bloque sin saber
 * inglés. El orden se deriva del seed del examen y del id del ítem, así que es
 * estable al reanudar (misma pregunta, mismas opciones en el mismo orden) sin
 * depender de en qué posición del examen quedó.
 */
export function orderedOptions(item, seed) {
  if (!item || !Array.isArray(item.options)) return [];
  const rand = mulberry32((seed >>> 0) ^ hashString(item.id || item.question));
  return shuffleWith(item.options, rand);
}
