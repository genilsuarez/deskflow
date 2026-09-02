/**
 * LP Placement Test — examen que valida el nivel que el usuario pidió en la encuesta.
 * Solo DeskFlow — no se comparte con FluentFlow/HubFlow/LyricFlow.
 *
 * No ubica: confirma. Pedir B1 rinde el bloque B1; pedir un nivel más alto rinde
 * el piso del nivel anterior + el bloque pedido (ver blocksFor). Aprobar otorga
 * el nivel pedido; reprobar otorga el bloque más alto que sí se aprobó, y solo
 * cae al fallback si no se aprobó ninguno — nunca por debajo del nivel que ya se
 * ganó completando contenido real (ver commitLevel).
 *
 * Requiere:
 *  - lp-placement-test.css, lp-about.css (el modal de reanudación reusa .about-modal)
 *  - lp-placement-items.json (copia de scripts/lp-placement-items.json)
 *  - las funciones puras de scripts/lp-placement-scoring.js, inyectadas por quien
 *    llama a open()/maybeShowOffer()/maybeShowResumePrompt() — este archivo es un
 *    <script> plano, no un módulo (mismo patrón que app.js con lpOnboarding).
 */
/* eslint-disable no-var */
var lpPlacementTest = (function () {
  'use strict';

  var REQUEST_KEY = 'lp-placement-request';
  var SNAPSHOT_KEY = 'lp-placement-progress';
  var SEEN_KEY = 'lp-placement-seen';
  var SESSION_DISMISS_KEY = 'lp-placement-offer-dismissed';
  var ITEMS_URL = 'lp-placement-items.json';
  // Un clip por ítem de audio, nombrado por su id (los genera
  // scripts/generate-placement-audio.sh). Se deriva del id en vez de declararse
  // en el banco para que no puedan desincronizarse.
  var AUDIO_BASE = 'placement-audio/';

  // Formato del snapshot. Un snapshot de otro formato se descarta en vez de
  // interpretarse mal: los anteriores guardaban índices en vez de ids y
  // reanudarlos con este código daría respuestas cruzadas con otras preguntas.
  var SNAPSHOT_FORMAT = 4;

  // Techo de ids recordados entre intentos. Con ~30 ítems por nivel y 20 por
  // examen, cubre de sobra los intentos que alguien encadena de verdad; más
  // allá de eso da igual repetir, porque ya no se acuerda.
  var SEEN_MAX = 300;

  // Un examen a medias caduca: retomar algo que se dejó hace semanas mide el
  // recuerdo del intento, no el nivel. Pasado el plazo se ofrece la encuesta.
  var SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Etiqueta del bloque en la barra superior. La sonda se rotula como
   * "preguntas extra" para dejar claro que el nivel ya no está en juego: si
   * pareciera un bloque más, abandonarla se sentiría como reprobar.
   */
  function stageLabel(level, isProbe) {
    var name = String(level).toUpperCase();
    return isProbe ? 'Preguntas extra (' + name + ')' : 'Nivel ' + name;
  }

  // Mismo sistema visual que el onboarding (lp-flow-ui.js): el examen es la
  // continuación de la encuesta, no otra app.
  var icon = function (name, cls) { return window.lpFlowUI.icon(name, cls); };
  var flowHeader = function (opts) { return window.lpFlowUI.header(opts); };
  var flowNote = function (iconName, text) { return window.lpFlowUI.note(iconName, text); };

  /** Letra de la opción (A, B, C…): ancla cada fila a la columna del icono. */
  function optionLetter(index) {
    return String.fromCharCode(65 + index);
  }

  /**
   * Audio de los ítems de comprensión oral. La fuente principal es el clip
   * grabado (playClip): la voz de speechSynthesis la elige el sistema operativo,
   * así que sin los clips la misma pregunta suena distinta —y es objetivamente
   * más difícil— según el dispositivo, que en un examen calificado es un
   * problema de equidad. La síntesis queda como respaldo para cuando el clip no
   * carga. Si no hay ninguna de las dos, los ítems de audio se retiran del banco
   * (canHear): servir una pregunta que no se puede oír sería un fallo seguro
   * atribuido al usuario.
   */
  var speech = {
    /** Reproduce el clip del ítem. Devuelve una promesa que rechaza si no puede. */
    playClip: function (item) {
      return new Promise(function (resolve, reject) {
        if (typeof window.Audio !== 'function' || !item || !item.id) {
          reject(new Error('sin soporte de audio'));
          return;
        }
        var audio = new window.Audio(AUDIO_BASE + item.id + '.m4a');
        speech._clip = audio; // para que stop() pueda cortarlo al cambiar de pregunta
        audio.addEventListener('error', function () {
          reject(new Error('clip no disponible'));
        });
        var started = audio.play();
        if (started && typeof started.catch === 'function') started.catch(reject);
        else resolve(audio);
        audio.addEventListener('playing', function () {
          resolve(audio);
        });
      });
    },
    available: function () {
      return (
        typeof window.speechSynthesis !== 'undefined' &&
        typeof window.SpeechSynthesisUtterance === 'function'
      );
    },
    speak: function (text) {
      if (!speech.available()) return;
      try {
        window.speechSynthesis.cancel();
        var utterance = new window.SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        // Algo por debajo del natural: es un examen, no una conversación, y la
        // frase se oye una vez antes de decidir.
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        /* la voz no es indispensable para cerrar el examen */
      }
    },
    _clip: null,
    stop: function () {
      if (speech._clip) {
        try {
          speech._clip.pause();
        } catch (e) {
          /* el elemento ya no sirve */
        }
        speech._clip = null;
      }
      if (!speech.available()) return;
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        /* idem */
      }
    },
    /** ¿Se puede servir un ítem de audio en este entorno? */
    canHear: function () {
      return typeof window.Audio === 'function' || speech.available();
    },
  };

  function track(eventName, params) {
    if (typeof window.lpTrack === 'function') window.lpTrack(eventName, params);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Estado persistido -------------------------------------------------

  /** Nivel pedido en la encuesta y todavía no validado ('b1' | 'b2' | null). */
  function pendingRequest() {
    try {
      return localStorage.getItem(REQUEST_KEY);
    } catch (e) {
      return null;
    }
  }

  function clearRequest() {
    try {
      localStorage.removeItem(REQUEST_KEY);
    } catch (e) {
      /* localStorage no disponible */
    }
  }

  /** Examen a medias todavía válido, o null si no hay / caducó / es de otro formato. */
  function readSnapshot() {
    var raw;
    try {
      raw = localStorage.getItem(SNAPSHOT_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;

    var snap;
    try {
      snap = JSON.parse(raw);
    } catch (e) {
      clearSnapshot();
      return null;
    }
    if (!snap || snap.format !== SNAPSHOT_FORMAT || !snap.requestedLevel || !Array.isArray(snap.given)) {
      clearSnapshot();
      return null;
    }
    if (Date.now() - (snap.updatedAt || 0) > SNAPSHOT_MAX_AGE_MS) {
      clearSnapshot();
      return null;
    }
    // Ya no se compara contra la versión del banco: el snapshot guarda el id de
    // cada ítem respondido, así que publicar un banco nuevo deja de tirar a la
    // basura un examen a medias — se conservan las respuestas de los ítems que
    // sigan existiendo y se pregunta el resto (ver replayAnswers).
    return snap;
  }

  // --- Ítems ya vistos en intentos anteriores ----------------------------

  /**
   * Ids servidos en exámenes previos. El examen muestra la explicación al
   * responder, así que repetir un ítem en el siguiente intento mide el recuerdo
   * del intento anterior, no el nivel: pickBlock() los pospone dentro de su
   * destreza. Se guarda acotado y en orden de antigüedad — un banco que crece
   * no puede hacer crecer esta lista sin techo.
   */
  function readSeen() {
    try {
      var parsed = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(function (id) { return typeof id === 'string'; }) : [];
    } catch (e) {
      return [];
    }
  }

  function writeSeen(list) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(list));
    } catch (e) {
      /* sin persistencia solo se pierde la preferencia por preguntas nuevas */
    }
  }

  /** Une dos listas de ids conservando el orden de antigüedad y el techo. */
  function mergeSeen(older, newer) {
    var merged = older.filter(function (id) {
      return newer.indexOf(id) === -1;
    });
    merged = merged.concat(newer); // los recién vistos, al final: los últimos en caducar
    if (merged.length > SEEN_MAX) merged = merged.slice(merged.length - SEEN_MAX);
    return merged;
  }

  /**
   * Registra los ítems servidos y los sube. Sin la subida, la lista vive solo
   * en este dispositivo y quien reintenta desde el móvil vuelve a ver las
   * preguntas que ya respondió en el portátil — con la explicación incluida,
   * que es justo lo que esta lista existe para evitar.
   */
  function rememberSeen(ids, options) {
    if (!ids || ids.length === 0) return;
    var merged = mergeSeen(readSeen(), ids);
    writeSeen(merged);
    if (options && typeof options.pushSeen === 'function') {
      try {
        options.pushSeen(merged);
      } catch (e) {
        /* best-effort: se reintenta al terminar el próximo examen */
      }
    }
  }

  /**
   * Lista de vistos a usar para componer un examen: la local unida con la de la
   * nube. Se resuelve al abrir el examen — es el único momento en que hace
   * falta — y en paralelo con la descarga del banco, así que no añade espera.
   */
  function resolveSeen(options) {
    if (!options || typeof options.fetchRemoteSeen !== 'function') {
      return Promise.resolve(readSeen());
    }
    return Promise.resolve()
      .then(function () {
        return options.fetchRemoteSeen();
      })
      .then(function (remote) {
        if (!Array.isArray(remote) || remote.length === 0) return readSeen();
        // La nube va primero: lo local es más reciente por definición en este
        // dispositivo, y mergeSeen conserva al final lo que menos debe caducar.
        var merged = mergeSeen(remote, readSeen());
        writeSeen(merged);
        return merged;
      })
      .catch(function () {
        return readSeen(); // sin red o sin sesión: alcanza con lo local
      });
  }

  function writeSnapshot(snap) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
    } catch (e) {
      /* sin persistencia el examen sigue funcionando, solo no se puede retomar */
    }
  }

  function clearSnapshot() {
    try {
      localStorage.removeItem(SNAPSHOT_KEY);
    } catch (e) {
      /* localStorage no disponible */
    }
  }

  /** `true` si hay algo que resolver: petición pendiente o examen a medias. */
  function isPending() {
    return !!pendingRequest() || !!readSnapshot();
  }

  // --- Otorgar el nivel --------------------------------------------------

  function higherLevel(levelA, levelB, levelOrder) {
    return levelOrder.indexOf(levelA) >= levelOrder.indexOf(levelB) ? levelA : levelB;
  }

  /**
   * Escribe el nivel resultante, con piso en lo ya ganado orgánicamente:
   * reprobar un intento de B2 no puede borrar un B1 que se ganó completando
   * módulos. Notifica al llamador para que lo persista en la nube — incluso
   * cuando baja, porque el restore de login nunca baja por su cuenta y si no
   * se sincroniza el nivel viejo vuelve solo en el próximo inicio de sesión.
   */
  function commitLevel(level, options) {
    var floor = 'a1';
    if (typeof options.earnedFloor === 'function') {
      try {
        floor = options.earnedFloor();
      } catch (e) {
        floor = 'a1';
      }
    }
    var finalLevel = higherLevel(level, floor, options.levelOrder);
    try {
      localStorage.setItem('lp-level', finalLevel);
    } catch (e) {
      /* localStorage no disponible */
    }
    if (typeof options.onLevelCommitted === 'function') options.onLevelCommitted(finalLevel);
    return finalLevel;
  }

  // --- Composición del examen -------------------------------------------

  function fetchItemBank() {
    // cache: 'default' — el banco es un JSON estático que cambia rara vez y
    // GitHub Pages lo sirve con ETag + max-age, así que revalidar sale un 304
    // en vez de re-bajar los ~45 KB en cada intento. Que el banco cambie no se
    // cubre acá: lo cubre `version`, revalidado contra resume.itemsVersion en
    // renderExam(), que descarta el intento guardado y arranca limpio.
    return fetch(ITEMS_URL, { cache: 'default' }).then(function (res) {
      if (!res.ok) throw new Error('lp-placement-items.json fetch failed: ' + res.status);
      return res.json();
    });
  }

  /**
   * Bloques a rendir, en orden, para el nivel pedido. El banco tiene más
   * ítems por nivel que los servidos acá — options.pickBlock() muestrea
   * `seed` de forma determinista (y con la mezcla fija de tipos de TYPE_MIX),
   * así que reanudar con el mismo seed reconstruye la misma secuencia.
   */
  function buildBlocks(items, requestedLevel, options, seed, pickOpts) {
    var order = options.blocksFor(requestedLevel);
    var byLevel = {};
    order.forEach(function (level, idx) {
      var pool = items.filter(function (item) {
        return item.level === level;
      });
      var isFloor = idx === 0 && order.length > 1;
      var size = isFloor ? options.floorBlockSize : options.blockSize[level];
      byLevel[level] = options.pickBlock(pool, size, seed, pickOpts);
    });
    var flat = [];
    order.forEach(function (level) {
      flat = flat.concat(byLevel[level]);
    });
    return { order: order, byLevel: byLevel, flat: flat };
  }

  /**
   * Compone el examen que se va a rendir de verdad y reproduce sobre él el
   * intento guardado. Es la única fuente de verdad de "en qué pregunta se
   * retoma": la usan tanto renderExam() para arrancar como el modal de
   * reanudación para poder decir cuántas respuestas se conservan realmente —
   * antes el modal mostraba el contador del snapshot, que miente en cuanto el
   * banco cambia y algunos ítems respondidos ya no existen.
   *
   * No toca el DOM ni escribe en localStorage: solo decide. `resumed === false`
   * significa que el intento guardado no se pudo aprovechar.
   */
  function planExam(items, requestedLevel, options, resume) {
    var seed =
      resume && typeof resume.seed === 'number'
        ? resume.seed
        : Math.floor(Math.random() * 0xffffffff);

    // Ítems servidos en intentos anteriores: pickBlock los pospone. Se congela
    // al empezar y viaja en el snapshot, para que terminar otro examen en otra
    // pestaña no recomponga este a mitad de camino.
    var excluded = resume && Array.isArray(resume.excluded) ? resume.excluded : readSeen();

    // Al reanudar hay que volver a elegir los ítems que este examen ya sirvió:
    // sin `prefer`, un banco nuevo remuestrea el bloque y las respuestas
    // guardadas quedan huérfanas aunque sus ítems sigan existiendo.
    var pickOpts = {
      exclude: excluded,
      prefer: resume
        ? resume.given.map(function (entry) {
            return entry && entry.id;
          })
        : [],
    };

    var blocks = buildBlocks(items, requestedLevel, options, seed, pickOpts);
    if (blocks.order.length === 0) return null;

    // Nivel de la sonda opcional: el siguiente al pedido, o null si no hay
    // (pedir el nivel más alto del banco) o si el llamador no la habilitó.
    var probeLevel =
      typeof options.probeLevelFor === 'function' ? options.probeLevelFor(requestedLevel) : null;

    var resumed = !!resume && typeof resume.seed === 'number' && resume.requestedLevel === requestedLevel;

    // Si el intento guardado ya había disparado la sonda, hay que reconstruirla
    // ANTES de reproducir las respuestas: sus ítems son parte de la secuencia.
    if (resumed && resume.probeTriggered) {
      var probeItems = probeLevel
        ? options.pickBlock(
            items.filter(function (item) {
              return item.level === probeLevel;
            }),
            options.probeSize,
            seed,
            pickOpts
          )
        : [];
      if (probeItems.length > 0) {
        blocks.order.push(probeLevel);
        blocks.byLevel[probeLevel] = probeItems;
        blocks.flat = blocks.flat.concat(probeItems);
      } else {
        resumed = false;
      }
    }

    /** Posición (bloque, ítem) para `count` respuestas dadas, o null si ya no queda ninguna. */
    function positionFor(count) {
      var remaining = count;
      for (var i = 0; i < blocks.order.length; i++) {
        var size = blocks.byLevel[blocks.order[i]].length;
        if (remaining < size) return { levelIndex: i, itemIndex: remaining };
        remaining -= size;
      }
      return null;
    }

    /**
     * Reordena cada bloque poniendo delante lo que ya se respondió, en el orden
     * en que se respondió. Las respuestas se emparejan por id, pero tienen que
     * quedar alineadas 1:1 con el prefijo de blocks.flat; sin este reordenado,
     * que el banco cambiara movía de sitio el primer ítem y el replay se cortaba
     * en el índice 0, tirando el intento entero — justo lo que guardar ids venía
     * a evitar. El orden dentro de un bloque no afecta a la puntuación
     * (blockResult mira nivel y acierto, no posición).
     */
    function reorderAnsweredFirst(given) {
      var rank = {};
      given.forEach(function (entry, index) {
        if (entry && typeof entry.id === 'string') rank[entry.id] = index;
      });
      var isAnswered = function (item) {
        return Object.prototype.hasOwnProperty.call(rank, item.id);
      };
      blocks.order.forEach(function (level) {
        var block = blocks.byLevel[level];
        var answered = block.filter(isAnswered).sort(function (a, b) {
          return rank[a.id] - rank[b.id];
        });
        blocks.byLevel[level] = answered.concat(
          block.filter(function (item) {
            return !isAnswered(item);
          })
        );
      });
      blocks.flat = [];
      blocks.order.forEach(function (level) {
        blocks.flat = blocks.flat.concat(blocks.byLevel[level]);
      });
    }

    /**
     * Reproduce las respuestas guardadas sobre el examen recién compuesto,
     * emparejándolas por id. Se corta en el primer ítem sin respuesta guardada
     * — que tras reorderAnsweredFirst() es el primero realmente pendiente.
     */
    function replayAnswers(given) {
      var byId = {};
      given.forEach(function (entry) {
        if (entry && typeof entry.id === 'string') byId[entry.id] = entry.value;
      });
      var out = [];
      for (var i = 0; i < blocks.flat.length; i++) {
        var id = blocks.flat[i].id;
        if (!Object.prototype.hasOwnProperty.call(byId, id)) break;
        out.push({ id: id, value: byId[id] });
      }
      return out;
    }

    if (resumed) reorderAnsweredFirst(resume.given);
    var replayed = resumed ? replayAnswers(resume.given) : [];
    var startAt = positionFor(replayed.length);
    // Un intento ya completo (o que tras el replay no deja ninguna pregunta
    // pendiente) no es reanudable: se descarta y se empieza limpio.
    if (resumed && !startAt) resumed = false;

    if (!resumed) {
      // La sonda solo existe si el intento guardado la había disparado: si ese
      // intento se descarta, hay que sacarla o el examen limpio arrancaría con
      // un bloque extra que nadie se ganó.
      if (probeLevel && blocks.order[blocks.order.length - 1] === probeLevel) {
        blocks.flat = blocks.flat.slice(0, blocks.flat.length - blocks.byLevel[probeLevel].length);
        delete blocks.byLevel[probeLevel];
        blocks.order.pop();
      }
      replayed = [];
      startAt = { levelIndex: 0, itemIndex: 0 };
    }

    return {
      blocks: blocks,
      probeLevel: probeLevel,
      seed: seed,
      excluded: excluded,
      pickOpts: pickOpts,
      replayed: replayed,
      startAt: startAt,
      resumed: resumed,
    };
  }

  /** Ítems del banco que este entorno puede servir (sin voz, nada de audio). */
  function playableItems(bank) {
    // Servir una pregunta que no se puede oír sería un fallo seguro atribuido
    // al usuario; el resto del banco alcanza de sobra para armar los bloques
    // (ver la invariante de tamaño mínimo en placement-scoring-invariants.mjs).
    if (speech.canHear()) return bank.items;
    return bank.items.filter(function (item) {
      return item.type !== 'listen';
    });
  }

  function requireOptions(options) {
    if (typeof options.score !== 'function' || typeof options.blocksFor !== 'function') {
      throw new Error('lpPlacementTest requiere options.score y options.blocksFor');
    }
    if (!Array.isArray(options.levelOrder) || !options.fallbackLevel) {
      throw new Error('lpPlacementTest requiere options.levelOrder y options.fallbackLevel');
    }
    if (typeof options.pickBlock !== 'function' || !options.blockSize || !options.floorBlockSize) {
      throw new Error('lpPlacementTest requiere options.pickBlock, options.blockSize y options.floorBlockSize');
    }
    if (typeof options.orderedOptions !== 'function' || typeof options.isCorrect !== 'function') {
      throw new Error('lpPlacementTest requiere options.orderedOptions y options.isCorrect');
    }
  }

  /** Params escalares (GA4 no acepta arrays/objetos anidados en un evento) con
   *  el detalle por bloque — incluida la sonda si se sirvió — para poder
   *  calibrar umbrales más adelante sin esperar a tener cientos de exámenes
   *  por ítem: alcanza con la tasa de aciertos por bloque agregada en GA4. */
  function blockParams(result, state) {
    var params = {};
    if (state) {
      // Señales de contexto del intento. No cambian el resultado: sirven para
      // leer la analítica con criterio. `focus_lost` alto + `total_ms` alto es
      // el perfil de quien consulta las respuestas fuera; ninguno de los dos
      // por separado prueba nada, y por eso no se penaliza ninguno.
      params.focus_lost = state.focusLost;
      params.total_ms = state.startedAt ? Date.now() - state.startedAt : 0;
    }
    (result.blocks || []).forEach(function (block) {
      params[block.level + '_correct'] = block.correctCount;
      params[block.level + '_total'] = block.total;
    });
    if (result.probe) {
      params.probe_level = result.probe.level;
      params.probe_correct = result.probe.correctCount;
      params.probe_total = result.probe.total;
    }
    return params;
  }

  /**
   * @param {object} options
   * @param {string} options.requestedLevel - nivel a validar; por defecto, la petición pendiente.
   * @param {function} options.score - scoreValidation (scripts/lp-placement-scoring.js)
   * @param {function} options.blocksFor - blocksFor (idem)
   * @param {string} options.fallbackLevel - FALLBACK_LEVEL (idem)
   * @param {string[]} options.levelOrder - LEVEL_ORDER (scripts/lp-progress-summary.js)
   * @param {function} options.pickBlock - pickBlock (scripts/lp-placement-scoring.js)
   * @param {object} options.blockSize - BLOCK_SIZE (idem)
   * @param {number} options.floorBlockSize - FLOOR_BLOCK_SIZE (idem)
   * @param {function} options.orderedOptions - orderedOptions (idem) — baraja las opciones
   * @param {function} options.isCorrect - isCorrect (idem) — acierto de opción múltiple o cloze
   * @param {function} [options.probeLevelFor] - probeLevelFor (idem)
   * @param {number} [options.probeSize] - PROBE_SIZE (idem)
   * @param {function} [options.probeTriggerFor] - probeTriggerFor (idem)
   * @param {function} [options.scoreBlock] - scoreBlock (idem) — requerido si hay sonda
   * @param {function} [options.earnedFloor] - getEarnedLevelFloor (idem)
   * @param {function} [options.onLevelCommitted] - persistencia en la nube del nivel resultante
   * @param {object} [options.resumeFrom] - snapshot devuelto por readSnapshot()
   */
  function open(options) {
    options = options || {};
    requireOptions(options);

    var requestedLevel = options.requestedLevel || pendingRequest();
    if (!requestedLevel) return;

    track('placement_test_started', { level: requestedLevel, resumed: !!options.resumeFrom });

    // En paralelo: el banco y la lista de ítems ya vistos (local ∪ nube).
    // resolveSeen() deja la lista fusionada en localStorage antes de componer,
    // que es de donde la lee planExam(); si falla, cae sola a la local.
    Promise.all([fetchItemBank(), resolveSeen(options)])
      .then(function (results) {
        renderExam(results[0], requestedLevel, options);
      })
      .catch(function (err) {
        console.error('[lpPlacementTest]', err);
      });
  }

  function renderExam(bank, requestedLevel, options) {
    var resume = options.resumeFrom;

    // Se guarda la referencia además de pasarla a planExam: la sonda se compone
    // más tarde, al aprobar el bloque, y necesita el mismo banco filtrado.
    var items = playableItems(bank);

    // Toda la decisión de qué se pregunta y desde dónde se retoma vive en
    // planExam() — acá solo se dibuja. El modal de reanudación llama a la misma
    // función para contar respuestas conservadas, así que no puede desviarse
    // de lo que el examen realmente hace.
    var plan = planExam(items, requestedLevel, options, resume);
    if (!plan) return;

    var blocks = plan.blocks;
    var probeLevel = plan.probeLevel;
    var seed = plan.seed;
    var excluded = plan.excluded;
    var pickOpts = plan.pickOpts;
    var startAt = plan.startAt;

    // Un intento guardado que no se pudo aprovechar se descarta acá (planExam
    // no escribe), para no dejar un snapshot que el próximo arranque vuelva a
    // ofrecer retomar sin que quede nada que retomar.
    if (resume && !plan.resumed) {
      clearSnapshot();
      resume = null;
    }

    // Nivel con el que se entra al examen — se lee ANTES de escribir nada para
    // poder decir en el resultado si el examen lo subió, lo dejó igual o no
    // alcanzó (ver renderResult).
    var levelBefore = 'a1';
    try {
      levelBefore = localStorage.getItem('lp-level') || 'a1';
    } catch (e) {
      /* localStorage no disponible */
    }

    var state = {
      levelIndex: startAt.levelIndex,
      itemIndex: startAt.itemIndex,
      given: plan.replayed,
      answered: false,
      probeTriggered: resume ? !!resume.probeTriggered : false,
      // Marca de tiempo de la pregunta en pantalla: alimenta el `ms` por ítem,
      // que es lo que permite distinguir una respuesta pensada de una buscada.
      shownAt: 0,
      // Arranque del intento en este dispositivo (una reanudación reinicia el
      // reloj: el tiempo de la sesión anterior ya no es observable).
      startedAt: Date.now(),
      // Veces que el examen dejó de estar visible. NO penaliza: una
      // notificación o un cambio de app accidental no son hacer trampa, y
      // castigarlos convertiría el examen en algo hostil. Se registra para
      // poder leer la analítica con criterio — un resultado con 12 salidas de
      // foco y 40 s por pregunta dice algo distinto de uno sin ninguna.
      focusLost: 0,
    };

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') state.focusLost += 1;
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    /** Respuestas dadas, en orden — lo que espera options.score(). */
    function answerValues() {
      return state.given.map(function (entry) {
        return entry.value;
      });
    }

    var overlay = document.createElement('div');
    overlay.id = 'lpPlacementTest';
    overlay.className = 'placement-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'placementTestTitle');
    document.body.appendChild(overlay);
    document.body.classList.add('placement-open');

    var appShell = document.querySelector('.app-shell');
    if (appShell) appShell.inert = true;

    var card = document.createElement('section');
    card.className = 'placement-card';

    var topbar = document.createElement('div');
    topbar.className = 'placement-topbar';
    var counter = document.createElement('span');
    counter.className = 'placement-topbar__counter';
    topbar.appendChild(counter);
    var progress = document.createElement('div');
    progress.className = 'placement-progress';
    var progressFill = document.createElement('div');
    progressFill.className = 'placement-progress__fill';
    progress.appendChild(progressFill);
    topbar.appendChild(progress);
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'placement-close';
    closeBtn.setAttribute('aria-label', 'Cerrar examen');
    closeBtn.innerHTML = icon('close', 'flow-icon flow-icon--sm');
    closeBtn.addEventListener('click', function () {
      abandon();
    });
    topbar.appendChild(closeBtn);
    card.appendChild(topbar);

    var body = document.createElement('div');
    body.className = 'placement-body';
    card.appendChild(body);

    var footer = document.createElement('div');
    footer.className = 'placement-footer';
    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'lp-btn lp-btn--primary placement-next';
    nextBtn.disabled = true;
    footer.appendChild(nextBtn);
    card.appendChild(footer);

    overlay.appendChild(card);

    function currentLevel() {
      return blocks.order[state.levelIndex];
    }

    function currentBlock() {
      return blocks.byLevel[currentLevel()];
    }

    /** Ítems ya rendidos, en orden — alineados 1:1 con state.given. */
    function presentedItems() {
      return blocks.flat.slice(0, state.given.length);
    }

    /** Ids de lo ya rendido — se recuerdan para que el próximo intento estrene preguntas. */
    function presentedIds() {
      return presentedItems().map(function (item) {
        return item.id;
      });
    }

    /**
     * Guarda el intento por id de ítem, no por índice: así el examen sobrevive
     * a que se publique un banco nuevo. levelIndex/itemIndex no se guardan
     * porque se derivan del número de respuestas (positionFor); guardarlos
     * sería una segunda fuente de verdad que puede contradecir a la primera.
     */
    function persist() {
      writeSnapshot({
        format: SNAPSHOT_FORMAT,
        requestedLevel: requestedLevel,
        seed: seed,
        excluded: excluded,
        given: state.given,
        // Solo para el modal de reanudación, que se muestra sin haber cargado
        // el banco y por tanto no puede recomponer el examen para contarlo.
        answeredCount: state.given.length,
        totalCount: blocks.flat.length,
        probeTriggered: state.probeTriggered,
        updatedAt: Date.now(),
      });
    }

    function updateTopbar() {
      var block = currentBlock();
      var isProbe = state.probeTriggered && currentLevel() === probeLevel;
      counter.textContent =
        stageLabel(currentLevel(), isProbe) +
        ' · Pregunta ' + (state.itemIndex + 1) + ' de ' + block.length;
      progressFill.style.width = Math.round((state.itemIndex / block.length) * 100) + '%';
    }

    function renderQuestion() {
      state.answered = false;
      state.shownAt = Date.now();
      nextBtn.disabled = true;
      var block = currentBlock();
      var isVeryLastItem =
        state.levelIndex === blocks.order.length - 1 && state.itemIndex === block.length - 1;
      nextBtn.textContent = isVeryLastItem ? 'Ver resultado' : 'Siguiente';
      updateTopbar();

      var item = block[state.itemIndex];
      var isCloze = item.type === 'cloze';
      var isListen = item.type === 'listen';
      // Una pregunta nueva cancela el audio de la anterior: si no, la voz sigue
      // sonando sobre la siguiente pantalla.
      speech.stop();
      body.innerHTML = '';
      body.insertAdjacentHTML(
        'beforeend',
        flowHeader({
          // El icono distingue de un vistazo los tres tipos de ítem: elegir
          // entre opciones (?), escribir la respuesta (pluma) u oírla (audio).
          icon: isCloze ? 'pen' : isListen ? 'sound' : 'help',
          tone: isCloze ? 'purple' : isListen ? 'blue' : null,
          title: escapeHtml(item.question),
          text: isCloze ? 'Escribe tu respuesta.' : isListen ? 'Puedes repetir el audio.' : 'Elige una opción.',
          titleId: 'placementTestTitle',
        })
      );

      if (isListen) renderAudio(item);
      if (isCloze) renderCloze(item);
      else renderChoices(item);
    }

    /**
     * Botón de audio de un ítem de comprensión oral. Se reproduce solo al
     * entrar y se puede repetir sin límite: el ítem mide si se entiende la
     * frase, no si se capta a la primera con el volumen a medias.
     */
    function renderAudio(item) {
      var wrap = document.createElement('div');
      wrap.className = 'placement-audio';

      var playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'lp-btn placement-audio__play';
      playBtn.innerHTML =
        '<span class="placement-audio__icon">' + icon('sound', 'flow-icon flow-icon--sm') + '</span>' +
        '<span class="placement-audio__label"></span>';
      var label = playBtn.querySelector('.placement-audio__label');
      label.textContent = 'Escuchar otra vez';
      wrap.appendChild(playBtn);
      body.appendChild(wrap);

      /**
       * El clip grabado manda y la síntesis del navegador es el respaldo: la voz
       * que elige speechSynthesis la decide el sistema operativo, así que la
       * misma pregunta suena distinta —y es más difícil— según el dispositivo.
       * En un examen calificado eso es equidad, no pulido.
       */
      function play() {
        speech.stop(); // corta el clip anterior y cualquier voz en curso
        speech
          .playClip(item)
          .catch(function () {
            // Sin clip (404, formato no soportado, autoplay bloqueado antes del
            // primer gesto): se cae a la voz del navegador, que suena peor pero
            // deja la pregunta contestable.
            speech.speak(item.audioText);
          });
      }

      playBtn.addEventListener('click', play);
      play();
    }

    /**
     * Registra la respuesta y muestra la explicación. Común a los dos tipos de
     * ítem. Se persiste en cuanto se responde: si cierra acá, la respuesta ya
     * cuenta y no puede reintentarse limpio (ver § abandono).
     */
    function commitAnswer(item, value, correct) {
      state.answered = true;
      state.given.push({ id: item.id, value: value });
      persist();

      // Un evento por ítem: sin dificultad medida por pregunta no hay forma de
      // calibrar PASS_THRESHOLD, que hoy son 0.7/0.6 puestos a ojo. Con esto,
      // la tasa de acierto por `item_id` sale de la analítica y los umbrales
      // pueden fijarse sobre datos en vez de sobre intuición.
      track('placement_item_answered', {
        item_id: item.id,
        item_level: item.level,
        item_skill: item.skill,
        item_type: item.type || 'mc',
        requested: requestedLevel,
        correct: correct ? 1 : 0,
        ms: state.shownAt ? Date.now() - state.shownAt : 0,
      });

      // Veredicto y explicación en un solo bloque, con la misma rejilla de
      // icono + texto que el resto del flujo: antes eran dos párrafos sueltos
      // (solución y explicación) que no compartían alineación ni tono.
      var feedback = document.createElement('div');
      feedback.className = 'placement-feedback ' + (correct ? 'is-correct' : 'is-wrong');
      feedback.innerHTML =
        '<span class="placement-feedback__icon">' + icon(correct ? 'check' : 'close', 'flow-icon flow-icon--sm') + '</span>' +
        '<div class="placement-feedback__text">' +
        '<strong></strong>' +
        (item.explanation ? '<p></p>' : '') +
        '</div>';
      feedback.querySelector('strong').textContent = correct
        ? '¡Correcto!'
        : 'Respuesta correcta: ' + item.correct;
      if (item.explanation) feedback.querySelector('p').textContent = item.explanation;
      body.appendChild(feedback);

      nextBtn.disabled = false;
      nextBtn.focus();
    }

    function renderChoices(item) {
      var optionsWrap = document.createElement('div');
      optionsWrap.className = 'placement-options';
      // Orden barajado, derivado del seed y del id del ítem: en el banco sin
      // barajar la posición de la correcta se concentraba en una sola opción y
      // contestar siempre esa aprobaba el bloque sin saber inglés. Al depender
      // del id (y no de la posición en el examen) el orden sobrevive intacto a
      // la reanudación.
      options.orderedOptions(item, seed).forEach(function (optionText, index) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'placement-option';
        // Misma rejilla que las filas del onboarding: marca (columna fija) ·
        // texto · estado. La marca ocupa la columna del icono para que las
        // cuatro opciones queden alineadas entre sí y con la cabecera.
        btn.innerHTML =
          '<span class="placement-option__mark" aria-hidden="true">' +
          '<span class="placement-option__letter">' + optionLetter(index) + '</span>' +
          icon('check', 'flow-icon flow-icon--sm placement-option__markicon') +
          icon('close', 'flow-icon flow-icon--sm placement-option__markicon') +
          '</span>' +
          '<span class="placement-option__text"></span>';
        btn.querySelector('.placement-option__text').textContent = optionText;
        btn.dataset.value = optionText;
        btn.addEventListener('click', function () {
          if (state.answered) return;

          Array.prototype.slice.call(optionsWrap.children).forEach(function (b) {
            b.disabled = true;
            if (b.dataset.value === item.correct) b.classList.add('is-correct');
            else if (b === btn) b.classList.add('is-wrong');
          });

          commitAnswer(item, optionText, optionText === item.correct);
        });
        optionsWrap.appendChild(btn);
      });
      body.appendChild(optionsWrap);
    }

    /**
     * Ítem de respuesta escrita. Mide producción, no reconocimiento: elegir la
     * forma correcta entre cuatro no prueba que se sepa producirla, y un examen
     * de puro opción múltiple sobreestima el nivel de forma sistemática.
     */
    function renderCloze(item) {
      var form = document.createElement('form');
      form.className = 'placement-cloze';

      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'placement-cloze__input';
      input.placeholder = 'Escribe tu respuesta';
      input.setAttribute('aria-label', 'Tu respuesta');
      // El teclado móvil corrige y capitaliza por su cuenta: acá eso falsearía
      // la respuesta que se está midiendo.
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.setAttribute('autocorrect', 'off');
      form.appendChild(input);

      var checkBtn = document.createElement('button');
      checkBtn.type = 'submit';
      checkBtn.className = 'lp-btn placement-cloze__check';
      checkBtn.textContent = 'Comprobar';
      form.appendChild(checkBtn);

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (state.answered) return;
        var value = input.value.trim();
        if (!value) return;

        input.disabled = true;
        checkBtn.disabled = true;
        var ok = options.isCorrect(item, value);
        input.classList.add(ok ? 'is-correct' : 'is-wrong');
        commitAnswer(item, value, ok);
      });

      body.appendChild(form);
      input.focus();
    }

    nextBtn.addEventListener('click', function () {
      if (!state.answered) return;

      var block = currentBlock();
      if (state.itemIndex < block.length - 1) {
        state.itemIndex += 1;
        persist();
        renderQuestion();
        return;
      }

      // Bloque terminado: si se reprueba, el examen corta acá — el resultado
      // ya está decidido y los bloques siguientes no lo pueden rescatar.
      // scoreValidation() ignora niveles fuera de blocksFor(requestedLevel),
      // así que mezclar ítems de la sonda en presentedItems()/answers (una vez
      // agregada, más abajo) nunca contamina este cálculo.
      var result = options.score(requestedLevel, presentedItems(), answerValues());
      var finishedLevel = currentLevel();
      var blockRes = null;
      for (var i = 0; i < result.blocks.length; i++) {
        if (result.blocks[i].level === finishedLevel) blockRes = result.blocks[i];
      }
      var isLastStaticBlock = state.levelIndex === blocks.order.length - 1;

      if (!blockRes || !blockRes.passed) {
        finish(result);
        return;
      }

      if (isLastStaticBlock) {
        // Nivel pedido recién aprobado: ver si corresponde ofrecer la sonda
        // opcional del nivel siguiente (ver probeTriggerFor) antes de cerrar.
        if (
          probeLevel &&
          finishedLevel === requestedLevel &&
          !state.probeTriggered &&
          typeof options.probeTriggerFor === 'function' &&
          options.probeTriggerFor(blockRes)
        ) {
          var probePool = items.filter(function (item) {
            return item.level === probeLevel;
          });
          var probeItems = options.pickBlock(probePool, options.probeSize, seed, pickOpts);
          if (probeItems.length > 0) {
            state.probeTriggered = true;
            blocks.order.push(probeLevel);
            blocks.byLevel[probeLevel] = probeItems;
            blocks.flat = blocks.flat.concat(probeItems);
            state.levelIndex += 1;
            state.itemIndex = 0;
            persist();
            renderQuestion();
            return;
          }
        }
        finish(result);
        return;
      }

      state.levelIndex += 1;
      state.itemIndex = 0;
      persist();
      renderQuestion();
    });

    function finish(result) {
      // Si se sirvió la sonda, sus respuestas ya están mezcladas en
      // presentedItems()/state.given (van al final, después de los bloques) —
      // options.score() las ignoró para el pass/fail; acá se puntúan aparte,
      // solo para reportar, nunca para decidir el nivel.
      if (state.probeTriggered && probeLevel) {
        var probeItems = blocks.byLevel[probeLevel] || [];
        var values = answerValues();
        var probeAnswers = values.slice(values.length - probeItems.length);
        result = Object.assign({}, result, {
          probe: options.scoreBlock(probeLevel, probeItems, probeAnswers),
        });
      }
      var committed = commitLevel(result.level, options);
      rememberSeen(presentedIds(), options);
      clearSnapshot();
      clearRequest();
      track(
        'placement_test_completed',
        Object.assign(
          { requested: requestedLevel, passed: result.passed, level: committed },
          blockParams(result, state)
        )
      );
      renderResult(result, committed);
    }

    /**
     * Abandono a mitad de examen. Escribe el nivel que las respuestas dadas
     * hasta acá alcanzan a demostrar — no el pedido, y tampoco un fallback
     * ciego: dejar el nivel pedido sin validar sería el agujero que este gate
     * cierra, pero tirar a A1 a quien ya aprobó el bloque piso borraría algo
     * demostrado en este mismo examen. Un bloque a medias no cuenta
     * (scoreValidation exige el bloque completo), así que cerrar tras tres
     * aciertos sigue sin otorgar nada. El snapshot se conserva para poder
     * retomar donde quedó — reanudar arrastra las respuestas ya dadas, así que
     * abandonar un intento que va mal no sirve para reintentarlo limpio.
     *
     * Excepción: si ya se disparó la sonda, el bloque calificado ya se había
     * aprobado ANTES de ofrecerla — cerrar sin responder la sonda opcional es
     * un cierre normal, no un abandono, y se reporta como tal.
     */
    function abandon() {
      var partial = options.score(requestedLevel, presentedItems(), answerValues());

      if (state.probeTriggered && partial.passed) {
        var committedCore = commitLevel(partial.level, options);
        rememberSeen(presentedIds(), options);
        clearSnapshot();
        clearRequest();
        track(
          'placement_test_completed',
          Object.assign(
            { requested: requestedLevel, passed: partial.passed, level: committedCore, probe_skipped: true },
            blockParams(partial, state)
          )
        );
        close({ reload: true });
        return;
      }

      var committed = commitLevel(partial.level, options);
      rememberSeen(presentedIds(), options);
      persist();
      track(
        'placement_test_abandoned',
        Object.assign(
          { requested: requestedLevel, answered: state.given.length, level: committed },
          blockParams(partial, state)
        )
      );
      close({ reload: true });
    }

    function renderResult(result, committed) {
      progressFill.style.width = '100%';
      topbar.style.display = 'none';
      body.innerHTML = '';
      footer.innerHTML = '';

      // Reprobar el nivel pedido ya no implica quedarse igual: quien pidió B2 y
      // aprobó el piso B1 sube a B1. El copy tiene que distinguir los dos casos
      // o "no alcanzó" contradiría el nivel que se acaba de otorgar.
      var improved =
        !result.passed &&
        options.levelOrder.indexOf(committed) > options.levelOrder.indexOf(levelBefore);

      var copy;
      if (result.passed) {
        copy =
          'Confirmado: tu contenido queda ajustado a nivel ' + committed.toUpperCase() +
          '. Los niveles anteriores siguen disponibles para repasar cuando quieras.';
      } else if (improved) {
        copy =
          'No alcanzó para ' + requestedLevel.toUpperCase() + ', pero sí demostraste nivel ' +
          committed.toUpperCase() + ', así que ahí queda tu contenido. Puedes volver a intentar ' +
          requestedLevel.toUpperCase() + ' cuando quieras.';
      } else {
        copy =
          'Esta vez no alcanzó para ' + requestedLevel.toUpperCase() + ', así que sigues en nivel ' +
          committed.toUpperCase() + '. Puedes volver a intentarlo cuando quieras, o elegir otro nivel ' +
          'desde los ajustes — nada de lo que ya completaste se pierde.';
      }

      // La sonda nunca cambia el nivel otorgado — solo agrega contexto al
      // resultado cuando se sirvió.
      if (result.probe) {
        var probeName = String(result.probe.level).toUpperCase();
        var probeCut = (options.passThreshold || {})[result.probe.level] || 0.6;
        var probePassed = result.probe.correctCount >= Math.ceil(result.probe.total * probeCut);
        copy += probePassed
          ? ' Además, respondiste bien la mayoría de unas preguntas extra de nivel ' + probeName +
            ' — tu inglés puede estar rindiendo más de lo que el contenido ' + committed.toUpperCase() +
            ' te exige.'
          : ' También probaste algunas preguntas extra de nivel ' + probeName +
            ', sin compromiso: no afectan tu resultado.';
      }

      var heading = result.passed
        ? 'Tu nivel confirmado: '
        : improved
          ? 'Tu nivel sube a '
          : 'Tu nivel sigue en ';

      // Marcador del resultado: el nivel otorgado en grande, y debajo el
      // recuento real de aciertos por bloque — dos datos que antes solo se
      // insinuaban en la prosa.
      // La sonda no está en result.blocks (queda fuera del scoring del nivel):
      // se anexa al final marcada como extra, para que el recuento visible
      // cuadre con las preguntas que la persona realmente contestó.
      var scored = (result.blocks || []).map(function (b) {
        return { level: b.level, correctCount: b.correctCount, total: b.total, passed: b.passed, probe: false };
      });
      if (result.probe) {
        scored.push({
          level: result.probe.level,
          correctCount: result.probe.correctCount,
          total: result.probe.total,
          passed: false,
          probe: true,
        });
      }
      var scoreRows = scored
        .map(function (b) {
          return (
            '<li class="placement-score__row">' +
            '<span class="placement-score__label">' + escapeHtml(stageLabel(b.level, b.probe)) + '</span>' +
            '<span class="placement-score__value' + (b.passed ? ' is-passed' : '') + '">' +
            Number(b.correctCount) + '/' + Number(b.total) + '</span>' +
            '</li>'
          );
        })
        .join('');

      body.insertAdjacentHTML(
        'beforeend',
        '<div class="placement-result">' +
          '<div class="placement-result-badge" aria-hidden="true">' + escapeHtml(committed.toUpperCase()) + '</div>' +
          '<div class="placement-result__text">' +
          '<h2 id="placementTestTitle">' + heading + escapeHtml(committed.toUpperCase()) + '</h2>' +
          '<p class="placement-body-text">' + escapeHtml(copy) + '</p>' +
          '</div></div>' +
          (scoreRows ? '<ul class="placement-score">' + scoreRows + '</ul>' : '') +
          flowNote('shield', 'Puedes repetir el examen o cambiar de nivel cuando quieras desde Ajustes.')
      );

      var continueBtn = document.createElement('button');
      continueBtn.type = 'button';
      continueBtn.className = 'lp-btn lp-btn--primary placement-next';
      continueBtn.textContent = 'Continuar';
      continueBtn.addEventListener('click', function () {
        close({ reload: true });
      });
      footer.appendChild(continueBtn);
    }

    function close(closeOptions) {
      var reload = !!(closeOptions && closeOptions.reload);
      speech.stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      overlay.remove();
      document.body.classList.remove('placement-open');
      if (appShell) appShell.inert = false;
      document.removeEventListener('keydown', onKeydown);
      if (reload) {
        location.reload();
        return;
      }
      var main = document.getElementById('mainContent');
      if (main) main.focus({ preventScroll: true });
    }

    function onKeydown(event) {
      if (event.key === 'Escape') abandon();
    }
    document.addEventListener('keydown', onKeydown);

    renderQuestion();
  }

  // --- Aviso en el dashboard: petición pendiente sin empezar --------------

  function maybeShowOffer(container, options) {
    if (!container) return;
    var requested = pendingRequest();
    if (!requested) return;
    if (readSnapshot()) return; // hay examen a medias: manda el modal de reanudación
    if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return;
    if (document.getElementById('placementOffer')) return;

    track('placement_test_offered', { level: requested });

    var offer = document.createElement('section');
    offer.id = 'placementOffer';
    offer.className = 'placement-offer';
    offer.setAttribute('aria-labelledby', 'placementOfferTitle');
    // Misma cabecera (icono · título con regla · texto) que las pantallas del
    // examen, para que el aviso se lea como su antesala y no como otra tarjeta
    // más del dashboard.
    offer.innerHTML =
      '<div class="placement-offer__head">' +
      '<span class="flow-head__icon flow-head__icon--amber">' + icon('doc', 'flow-icon') + '</span>' +
      '<div class="flow-head__text">' +
      '<h2 class="placement-offer__title" id="placementOfferTitle">Confirma tu nivel ' +
      escapeHtml(requested.toUpperCase()) + '</h2>' +
      '<p class="placement-offer__text">Pediste nivel ' + escapeHtml(requested.toUpperCase()) +
      ' en la encuesta. Toma unos minutos confirmarlo con un examen corto; hasta entonces tu ' +
      'contenido sigue en el nivel que ya tienes.</p>' +
      '</div></div>' +
      // Se pide de frente en vez de vigilar: no hay forma honesta de impedir
      // que alguien busque las respuestas en otra pestaña, y las que existen
      // (bloquear al perder el foco, cronómetro) castigan a quien recibe una
      // notificación. El examen es para el propio usuario; decirlo funciona
      // mejor que fingir que se puede controlar.
      flowNote('shield', 'Hazlo de una sentada y sin buscar las respuestas: el resultado solo te sirve si refleja tu nivel real.') +
      '<div class="placement-offer__actions"></div>';
    var actions = offer.querySelector('.placement-offer__actions');

    var startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'lp-btn lp-btn--primary';
    startBtn.textContent = 'Hacer el examen';
    startBtn.addEventListener('click', function () {
      offer.remove();
      open(Object.assign({}, options, { requestedLevel: requested }));
    });
    actions.appendChild(startBtn);

    var laterBtn = document.createElement('button');
    laterBtn.type = 'button';
    laterBtn.className = 'placement-later';
    laterBtn.textContent = 'Ahora no';
    laterBtn.addEventListener('click', function () {
      sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
      offer.remove();
    });
    actions.appendChild(laterBtn);

    container.prepend(offer);
  }

  // --- Modal de reanudación: examen a medias ------------------------------

  /**
   * Explica un examen dejado a medias y ofrece salida. **Nunca abre el examen
   * solo**: caer directo en un examen al entrar es desconcertante para quien
   * apenas conoce la plataforma, así que el examen solo se retoma con un click
   * explícito. La otra salida es volver a la encuesta y pedir otro nivel.
   */
  function maybeShowResumePrompt(options) {
    var snap = readSnapshot();
    if (!snap) return false;
    if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return false;
    if (document.getElementById('lpPlacementResume')) return false;

    var currentLevel = 'a1';
    try {
      currentLevel = localStorage.getItem('lp-level') || 'a1';
    } catch (e) {
      /* localStorage no disponible */
    }

    track('placement_resume_offered', { level: snap.requestedLevel, answered: snap.answeredCount });

    /** Primera frase del modal. Se recalcula abajo con el examen ya compuesto. */
    function progressCopy(answered, total) {
      return 'Respondiste ' + answered + ' de ' + total + ' preguntas. ';
    }

    var shell = document.querySelector('.app-shell') || document.body;
    var overlay = document.createElement('div');
    overlay.id = 'lpPlacementResume';
    overlay.className = 'about-overlay';
    overlay.innerHTML =
      '<section class="about-modal" role="dialog" aria-modal="true" ' +
      'aria-labelledby="lpPlacementResumeTitle" aria-describedby="lpPlacementResumeDesc">' +
      '<header class="about-header"><div class="about-header__text placement-resume__head">' +
      '<span class="flow-head__icon flow-head__icon--amber">' + icon('clock', 'flow-icon') + '</span>' +
      '<div class="flow-head__text">' +
      '<p class="about-eyebrow">Examen sin terminar</p>' +
      '<h2 id="lpPlacementResumeTitle">Dejaste el examen de ' + escapeHtml(snap.requestedLevel.toUpperCase()) + ' a medias</h2>' +
      '</div></div></header>' +
      '<div class="about-body"><p id="lpPlacementResumeDesc" class="about-description">' +
      progressCopy(Number(snap.answeredCount), Number(snap.totalCount)) +
      'Como no lo terminaste, tu nivel quedó en ' + escapeHtml(currentLevel.toUpperCase()) + '. ' +
      'Puedes retomarlo donde lo dejaste (se conservan tus respuestas) o elegir otro nivel.' +
      '</p></div>' +
      '<footer class="about-footer" style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">' +
      '<button class="lp-btn lp-btn--ghost" id="lpPlacementResumeSurvey" type="button">Elegir otro nivel</button>' +
      '<button class="lp-btn lp-btn--primary" id="lpPlacementResumeGo" type="button">Retomar el examen</button>' +
      '</footer></section>';

    document.body.appendChild(overlay);
    if (shell) shell.inert = true;

    function close() {
      overlay.remove();
      if (shell) shell.inert = false;
      document.removeEventListener('keydown', onKeydown);
    }

    function dismiss() {
      sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
      close();
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    }

    overlay.querySelector('#lpPlacementResumeGo').addEventListener('click', function () {
      close();
      track('placement_resume_accepted', { level: snap.requestedLevel });
      open(Object.assign({}, options, { requestedLevel: snap.requestedLevel, resumeFrom: snap }));
    });

    overlay.querySelector('#lpPlacementResumeSurvey').addEventListener('click', function () {
      close();
      track('placement_resume_survey', { level: snap.requestedLevel });
      // El intento viejo se descarta: el usuario está pidiendo otro nivel.
      clearSnapshot();
      clearRequest();
      if (typeof options.onChooseAnotherLevel === 'function') options.onChooseAnotherLevel();
    });

    document.addEventListener('keydown', onKeydown);
    overlay.querySelector('#lpPlacementResumeGo').focus();

    // El contador del snapshot cuenta lo que se respondió, no lo que se va a
    // conservar: si el banco cambió, los ítems respondidos que ya no existen
    // se vuelven a preguntar. Componer el examen es la única forma de saberlo,
    // y para eso hace falta el banco — que llega tarde. El modal se muestra ya
    // con la cifra del snapshot y se corrige sola al llegar, en vez de
    // retrasar el modal detrás de una petición de red.
    fetchItemBank()
      .then(function (bank) {
        var plan = planExam(playableItems(bank), snap.requestedLevel, options, snap);
        if (!plan || !plan.resumed) return;
        var kept = plan.replayed.length;
        if (kept === Number(snap.answeredCount) && plan.blocks.flat.length === Number(snap.totalCount)) return;
        var desc = document.getElementById('lpPlacementResumeDesc');
        if (!desc) return;
        desc.textContent =
          progressCopy(kept, plan.blocks.flat.length) +
          'Como no lo terminaste, tu nivel quedó en ' + currentLevel.toUpperCase() + '. ' +
          'Puedes retomarlo donde lo dejaste (se conservan tus respuestas) o elegir otro nivel.';
      })
      .catch(function () {
        /* sin banco no se puede afinar: se queda la cifra del snapshot */
      });

    return true;
  }

  return {
    open: open,
    isPending: isPending,
    pendingRequest: pendingRequest,
    maybeShowOffer: maybeShowOffer,
    maybeShowResumePrompt: maybeShowResumePrompt,
  };
})();

window.lpPlacementTest = lpPlacementTest; // ESM side-effect import (main.js) does not attach top-level vars to window like a classic <script> did — restore it explicitly.
