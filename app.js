import { APPS, ProgressReader, STATUS } from './progress-reader.js';
import { buildContentTitleIndex, resolveContentTitle } from './content-title.js';
import { repairLocalProjections, auditLocalProjections, auditCloudAlignment } from './sync-engine-audit.js';
import { runFullSync, shouldDeferStatsDisplay, shouldDeferActivityDisplay, consumeStatsRevealAnimation, hydrateActivityFromCloud } from './sync-engine.js';
import { animateText, animateCssVar, animateWidth } from './lp-stats-animate.js';
import { setupSupabaseAuth } from './lp-auth-setup.js';
import { getActiveLevel, getCombinedLevelProgress, LEVEL_ORDER } from './lp-progress-summary.js';
import { warmAllCatalogTotals } from './lp-catalog-warmer.js';
import { scorePlacement, STAGE1_LEVEL, STAGE2_LEVELS } from './lp-placement-scoring.js';

const APP_CONFIG = Object.freeze({
  fluentflow: {
    name: 'FluentFlow',
    eyebrow: 'Ruta estructurada',
    description: 'Ruta A1–C2 con módulos secuenciales y práctica guiada.',
    unit: 'módulos',
    lastLabel: 'Ejercicio',
    color: 'purple',
    url: 'https://genilsuarez.github.io/fluentflow/'
  },
  hubflow: {
    name: 'HubFlow',
    eyebrow: 'Práctica temática',
    description: '80 ejercicios · 4 categorías · 5 modos incluyendo Battle 2P.',
    unit: 'ejercicios',
    lastLabel: 'Ejercicio',
    color: 'amber',
    url: 'https://genilsuarez.github.io/hubflow/'
  },
  lyricflow: {
    name: 'LyricFlow',
    eyebrow: 'Aprendizaje con música',
    description: 'Entrena escucha y comprensión con canciones y actividades.',
    unit: 'actividades',
    lastLabel: 'Canción',
    color: 'teal',
    url: 'https://genilsuarez.github.io/lyricflow/'
  }
});

const STATUS_COPY = Object.freeze({
  [STATUS.READY]: 'Datos disponibles',
  [STATUS.EMPTY]: 'Aún no has comenzado',
  [STATUS.UNAVAILABLE]: 'Progreso no disponible',
  [STATUS.OUTDATED]: 'Integración por actualizar',
  [STATUS.INVALID]: 'No se pudo leer el progreso'
});

const reader = new ProgressReader();
let appData = [];
let contentTitleIndex = new Map();
let activityFilter = 'all';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function appendArrow(node) {
  const arrow = element('span', '', '→');
  arrow.setAttribute('aria-hidden', 'true');
  node.append(' ', arrow);
}

/** "Abrir X" → span.lp-btn__verb oculto en mobile (CSS) + resto del label */
function appendLinkLabel(link, label) {
  if (label.startsWith('Abrir ')) {
    link.append(element('span', 'lp-btn__verb', 'Abrir '), document.createTextNode(label.slice(6)));
    return;
  }
  link.append(document.createTextNode(label));
}

function getAppResult(app) {
  const found = appData.find((result) => result.app === app);
  if (!found || found.progress.data?.summary.lastContent || found.activity.status !== STATUS.READY) return found;

  const latestEvent = [...found.activity.data.events]
    .sort((first, second) => new Date(second.occurredAt) - new Date(first.occurredAt))[0];
  if (!latestEvent || !found.progress.data) return found;

  return {
    ...found,
    progress: {
      ...found.progress,
      data: {
        ...found.progress.data,
        summary: {
          ...found.progress.data.summary,
          lastContent: {
            contentId: latestEvent.contentId,
            title: latestEvent.title,
            activity: latestEvent.activity,
            occurredAt: latestEvent.occurredAt,
            progressPct: null,
            scorePct: latestEvent.scorePct
          }
        }
      }
    }
  };
}

function hasValidProgress(result) {
  return (
    (result.progress.status === STATUS.READY || result.progress.status === STATUS.EMPTY) &&
    result.progress.data != null
  );
}

function isStatsDeferred() {
  return shouldDeferStatsDisplay();
}

/** Métrica primaria por app — FluentFlow/HubFlow: contenido; LyricFlow: actividades por canción. */
const PRIMARY_PROGRESS_METRICS = Object.freeze({
  fluentflow: { unit: 'módulos', source: 'content' },
  hubflow: { unit: 'ejercicios', source: 'content' },
  lyricflow: { unit: 'actividades', source: 'activities' },
});

function progressDisplayMetrics(result) {
  const summary = result.progress.data.summary;
  const config = PRIMARY_PROGRESS_METRICS[result.app];
  if (config) {
    const byActivity = config.source === 'activities';
    const total = byActivity ? (summary.totalActivities ?? 0) : (summary.totalContent ?? 0);
    const completed = byActivity ? (summary.completedActivities ?? 0) : (summary.completedContent ?? 0);
    if (total > 0) {
      return { completed, total, unit: config.unit };
    }
  }
  return {
    completed: summary.completedContent,
    total: summary.totalContent,
    unit: APP_CONFIG[result.app]?.unit || 'contenidos',
  };
}

function rounded(value) {
  return Math.round(value);
}

/** Porcentaje alineado con el contador "X de Y" (no el progressPct crudo del storage). */
function displayProgressPct(result) {
  if (!hasValidProgress(result)) return 0;
  const { completed, total } = progressDisplayMetrics(result);
  if (!total) return 0;
  return Math.round((completed / total) * 100);
}

function appMetric(result, config) {
  if (hasValidProgress(result)) {
    const { completed, total } = progressDisplayMetrics(result);
    return `${completed} de ${total}`;
  }
  if (result.progress.status === STATUS.UNAVAILABLE) return `0 ${config.unit}`;
  return STATUS_COPY[result.progress.status];
}

function progressLabel(result) {
  if (hasValidProgress(result)) return `${displayProgressPct(result)}%`;
  return '0%';
}

function completedMetric(result) {
  if (hasValidProgress(result)) {
    const { completed, total } = progressDisplayMetrics(result);
    return `${completed} / ${total}`;
  }
  return '0';
}

function createStatusPill(status) {
  const tone = status === STATUS.READY ? 'success' : status === STATUS.EMPTY ? 'neutral' : 'warning';
  return element('span', `status-pill status-pill--${tone}`, STATUS_COPY[status]);
}

function createProgressBar(value, label, { animate = false } = {}) {
  const track = element('div', 'progress-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(value));
  const fill = element('span', 'progress-track__fill');
  if (animate && value > 0) {
    fill.style.width = '0%';
    animateWidth(fill, value);
  } else {
    fill.style.width = `${value}%`;
  }
  track.append(fill);
  return track;
}

function setPctText(el, value, animate) {
  if (!el) return;
  if (animate && value > 0) animateText(el, 0, value, (v) => `${v}%`);
  else el.textContent = `${value}%`;
}

function createAppLink(app, label = 'Abrir módulo', primary = false) {
  const config = APP_CONFIG[app];
  const link = element('a', primary ? `lp-btn lp-btn--${config.color} app-link` : 'text-action app-link');
  link.href = config.url;
  link.dataset.appLink = app;
  link.rel = 'noopener';
  appendLinkLabel(link, label);
  appendArrow(link);
  return link;
}


function renderModuleCards(animateReveal = false) {
  const container = document.getElementById('summaryModules');
  container.replaceChildren();
  const defer = isStatsDeferred();

  APPS.forEach((app) => {
    const config = APP_CONFIG[app];
    const result = getAppResult(app);
    const card = element('button', `module-card module-card--${config.color}`);
    card.type = 'button';
    card.dataset.view = app;

    const mark = element('span', 'module-card__mark', config.name.charAt(0));
    mark.setAttribute('aria-hidden', 'true');

    const copy = element('div', 'module-card__copy');
    const progressValue = defer ? 0 : (hasValidProgress(result) ? displayProgressPct(result) : 0);
    const hint = element(
      'span',
      'module-card__hint',
      defer ? '0 de 0' : appMetric(result, config)
    );
    copy.append(element('strong', 'module-card__label', config.name), hint);

    const lastRow = element('span', 'module-card__last');
    const lastLabel = element('span', 'module-card__last-label');
    const lastTitle = element('span', 'module-card__last-title');
    if (!defer && hasValidProgress(result) && result.progress.data.summary.lastContent) {
      const last = result.progress.data.summary.lastContent;
      lastLabel.textContent = `${config.lastLabel} ·`;
      lastTitle.textContent = resolveContentTitle(last, contentTitleIndex);
    } else {
      lastRow.classList.add('module-card__last--reserved');
      lastLabel.textContent = '\u00a0';
      lastTitle.textContent = '\u00a0';
    }
    lastRow.append(lastLabel, lastTitle);
    copy.append(lastRow);

    const pct = element('span', 'module-card__pct', defer ? '0%' : progressLabel(result));
    if (animateReveal && progressValue > 0) {
      animateText(pct, 0, progressValue, (v) => `${v}%`);
    }

    const chevron = element('span', 'module-card__chevron', '→');
    chevron.setAttribute('aria-hidden', 'true');

    const progress = createProgressBar(progressValue, `Progreso de ${config.name}`, {
      animate: animateReveal && progressValue > 0,
    });
    progress.classList.add('module-card__bar');

    card.append(mark, copy, pct, chevron, progress);
    container.append(card);
  });
}

function updateGlobalProgressTrack(value, label, animate = false) {
  const track = document.getElementById('globalProgressTrack');
  if (!track) return;
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuenow', String(value));
  const fill = track.querySelector('.progress-track__fill');
  if (!fill) return;
  if (animate && value > 0) {
    fill.style.width = '0%';
    animateWidth(fill, value);
  } else {
    fill.style.width = `${value}%`;
  }
}

function updateGlobalProgressMeta(text) {
  const meta = document.getElementById('globalMeta');
  if (!meta) return;
  meta.textContent = text || '\u00a0';
}

function renderGlobalProgress(animateReveal = false) {
  const value = document.getElementById('globalValue');
  const unit = document.getElementById('globalUnit');
  const ring = document.getElementById('globalRing');
  const description = document.getElementById('globalDescription');

  if (isStatsDeferred()) {
    value.textContent = '0%';
    unit.textContent = '0/3';
    updateGlobalProgressMeta('0 de 3 fuentes');
    ring.style.setProperty('--progress', '0');
    ring.setAttribute('aria-label', 'Progreso global pendiente');
    description.textContent = 'Contenido completado en A1–C2, promediado entre los tres módulos.';
    updateGlobalProgressTrack(0, 'Progreso global pendiente');
    return;
  }

  const validResults = appData.filter(hasValidProgress);

  if (validResults.length === APPS.length) {
    const average = validResults.reduce((total, result) => total + displayProgressPct(result), 0) / APPS.length;
    const displayValue = rounded(average);
    setPctText(value, displayValue, animateReveal);
    unit.textContent = '';
    updateGlobalProgressMeta('3 de 3 fuentes');
    if (animateReveal && displayValue > 0) animateCssVar(ring, '--progress', displayValue);
    else ring.style.setProperty('--progress', String(displayValue));
    ring.setAttribute('aria-label', `Progreso global ${displayValue} por ciento`);
    description.textContent = 'Contenido completado en A1–C2, promediado entre los tres módulos.';
    updateGlobalProgressTrack(displayValue, `Progreso global ${displayValue} por ciento`, animateReveal);
    return;
  }

  const partial = validResults.length > 0;
  let displayValue = 0;
  if (partial) {
    const average = validResults.reduce((total, result) => total + displayProgressPct(result), 0) / validResults.length;
    displayValue = rounded(average);
    setPctText(value, displayValue, animateReveal);
    unit.textContent = `${validResults.length}/3`;
    updateGlobalProgressMeta(`${validResults.length} de 3 fuentes`);
    if (animateReveal && displayValue > 0) animateCssVar(ring, '--progress', displayValue);
    else ring.style.setProperty('--progress', String(displayValue));
    ring.setAttribute('aria-label', `Progreso parcial ${displayValue} por ciento`);
    updateGlobalProgressTrack(displayValue, `Progreso parcial ${displayValue} por ciento`, animateReveal);
  } else {
    value.textContent = '0%';
    unit.textContent = '0/3';
    updateGlobalProgressMeta('0 de 3 fuentes');
    ring.style.setProperty('--progress', '0');
    ring.setAttribute('aria-label', 'Progreso global pendiente');
    updateGlobalProgressTrack(0, 'Progreso global pendiente');
  }
  description.textContent = partial
    ? 'Contenido completado en A1–C2, promediado entre los tres módulos.'
    : `${validResults.length} de 3 fuentes válidas.`;
}

function renderHeaderStats(animateReveal = false) {
  const completedEl = document.getElementById('headerStatsCompleted');
  const pctEl = document.getElementById('headerStatsPct');
  if (!completedEl || !pctEl) return;
  if (isStatsDeferred()) {
    completedEl.textContent = '0';
    pctEl.textContent = '0%';
    return;
  }
  const validResults = appData.filter(hasValidProgress);
  const totalCompleted = validResults.reduce(
    (total, result) => total + progressDisplayMetrics(result).completed,
    0
  );
  const average = validResults.length > 0
    ? validResults.reduce((total, result) => total + displayProgressPct(result), 0) / validResults.length
    : 0;
  const pctValue = rounded(average);
  if (animateReveal && totalCompleted > 0) animateText(completedEl, 0, totalCompleted);
  else completedEl.textContent = String(totalCompleted);
  if (animateReveal && pctValue > 0) animateText(pctEl, 0, pctValue, (v) => `${v}%`);
  else pctEl.textContent = `${pctValue}%`;
}

// LearnFlow Progression System — docs/to-do/learnflow-progression-system.md.
// lp-level es el nivel compartido entre las 3 apps (no la lectura interna
// de FluentFlow): sube solo cuando FluentFlow ≥100%, LyricFlow ≥100% y
// HubFlow ≥50% del nivel activo. Esta tarjeta es la "vista de estadísticas
// globales" a la que enlazan los avisos de "nivel estancado" en HubFlow y
// LyricFlow.
const CEFR_APP_THRESHOLDS = Object.freeze({ fluentflow: 100, hubflow: 50, lyricflow: 100 });

function renderCefr() {
  const level = document.getElementById('cefrLevel');
  const description = document.getElementById('cefrDescription');
  const breakdown = document.getElementById('cefrBreakdown');
  if (!level || !description) return;
  if (isStatsDeferred()) {
    level.textContent = 'A1';
    description.textContent = 'A1';
    if (breakdown) breakdown.innerHTML = '';
    return;
  }

  const activeLevel = getActiveLevel();
  const upperLevel = activeLevel.toUpperCase();
  const progress = getCombinedLevelProgress(activeLevel);
  const apps = ['fluentflow', 'hubflow', 'lyricflow'];
  const met = Object.fromEntries(apps.map((app) => [app, progress[app].progressPct >= CEFR_APP_THRESHOLDS[app]]));
  const isTerminal = LEVEL_ORDER.indexOf(activeLevel) === LEVEL_ORDER.length - 1;

  level.textContent = upperLevel;
  description.textContent = '';
  if (isTerminal) {
    description.append(`${upperLevel} · nivel máximo alcanzado.`);
  } else if (apps.every((app) => met[app])) {
    description.append(`${upperLevel} · cumples las 3 condiciones. Tu nivel sube al registrar la próxima actividad.`);
  } else {
    const pending = apps.filter((app) => !met[app]).map((app) => APP_CONFIG[app].name);
    description.append(`${upperLevel} · para subir de nivel falta: `);
    pending.forEach((name, index) => {
      if (index > 0) description.append(', ');
      description.append(element('strong', 'cefr-pending-name', name));
    });
    description.append('.');
  }

  if (breakdown) {
    breakdown.innerHTML = '';
    apps.forEach((app) => {
      const pct = rounded(progress[app].progressPct);
      const config = APP_CONFIG[app];
      const chip = element('span', `cefr-chip cefr-chip--${config.color} ${met[app] ? 'cefr-chip--met' : 'cefr-chip--pending'}`);
      chip.setAttribute('title', `${config.name} ${upperLevel} ${pct}%${met[app] ? ' · completo' : ' · pendiente'}`);
      const avatar = element('span', 'cefr-chip__avatar', config.name.charAt(0));
      avatar.setAttribute('aria-hidden', 'true');
      chip.append(avatar, element('span', 'cefr-chip__value', `${pct}%`));
      breakdown.appendChild(chip);
    });
  }
}

const RECENT_ACTIVITY_PER_APP = 4;

function recentEventsForApp(result) {
  if (shouldDeferActivityDisplay(result.app)) return [];
  if (result.activity.status !== STATUS.READY) return [];
  return [...result.activity.data.events]
    .map((event) => ({ ...event, app: event.app || result.app }))
    .sort((first, second) => new Date(second.occurredAt) - new Date(first.occurredAt))
    .slice(0, RECENT_ACTIVITY_PER_APP);
}

function allValidEvents() {
  return appData.flatMap(recentEventsForApp)
    .sort((first, second) => new Date(second.occurredAt) - new Date(first.occurredAt));
}

function latestValidEvents(limit = 3) {
  return appData.flatMap((result) => (
    shouldDeferActivityDisplay(result.app)
      ? []
      : result.activity.status === STATUS.READY
        ? result.activity.data.events.map((event) => ({ ...event, app: event.app || result.app }))
        : []
  ))
    .sort((first, second) => new Date(second.occurredAt) - new Date(first.occurredAt))
    .slice(0, limit);
}

/** YYYY-MM-DD del día calendario LOCAL de una fecha — no comparar el ISO string en UTC crudo. */
function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Racha de plataforma (4.3): días consecutivos con ≥1 evento en cualquiera de las 3 apps, sin
 * filtro de score — un intento fallido ya es uso real. Se calcula en vivo desde latestValidEvents()
 * sin límite (nunca se cachea): el reset de invitado (lp-guest-reset.js) borra los ledgers de
 * origen, así que un streak sin caché propia queda en 0 automáticamente, sin tocar ese archivo.
 * Si hoy todavía no tiene evento no se corta de inmediato — se sigue contando desde ayer, para no
 * mostrar la racha "rota" a media mañana antes de que el usuario haya tenido chance de practicar.
 */
function calculateStreak(events) {
  if (!events.length) return 0;
  const activeDays = new Set(events.map((event) => localDayKey(new Date(event.occurredAt))));

  const cursor = new Date();
  if (!activeDays.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (activeDays.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function formatDate(isoDate, { compact = false } = {}) {
  if (compact) {
    return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(isoDate));
  }
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoDate));
}

function capitalizeLabel(text) {
  return text
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase('es') + word.slice(1))
    .join(' ');
}

function readableActivity(activity) {
  return capitalizeLabel(activity.replaceAll('_', ' ').replaceAll('-', ' '));
}

function readablePassStatus(passed) {
  return passed ? 'Superado' : 'Por repetir';
}

function createActivityItem(event, { tabular = false, showApp = false, showTime = true } = {}) {
  const config = APP_CONFIG[event.app] ?? null;
  const item = element('article', tabular ? 'activity-item activity-item--compact' : 'activity-item');

  const body = element('div', 'activity-item__body');
  const title = element('h3', '', resolveContentTitle(event, contentTitleIndex));
  const activityType = readableActivity(event.activity);
  const scoreText = event.scorePct !== null ? `${rounded(event.scorePct)}%` : null;
  const statusText = event.passed !== null ? readablePassStatus(event.passed) : null;
  const detailParts = [activityType];
  if (scoreText) detailParts.push(scoreText);
  if (statusText) detailParts.push(statusText);
  const mobileParts = showApp && config ? [config.name, ...detailParts] : detailParts;

  if (tabular) {
    body.append(title, element('p', 'activity-item__meta-mobile', mobileParts.join(' · ')));
    if (showApp && config) {
      item.append(element('span', `activity-item__cell activity-item__cell--app activity-item__cell--app-${config.color}`, config.name));
    }
    item.append(
      body,
      element('span', 'activity-item__cell activity-item__cell--type', activityType),
      element('span', 'activity-item__cell activity-item__cell--score', scoreText ?? '—'),
      element('span', `activity-item__cell activity-item__cell--status${event.passed === true ? ' activity-item__cell--status-passed' : event.passed === false ? ' activity-item__cell--status-retry' : ''}`, statusText ?? '—')
    );
  } else {
    if (config) {
      const marker = element('span', `activity-item__marker activity-item__marker--${config.color}`);
      marker.textContent = config.name.charAt(0);
      marker.setAttribute('aria-hidden', 'true');
      const appName = element('span', 'activity-item__app', config.name);
      body.append(appName, title, element('p', '', detailParts.join(' · ')));
      item.append(marker, body);
    } else {
      body.append(title, element('p', '', detailParts.join(' · ')));
      item.append(body);
    }
  }

  if (!tabular || showTime) {
    const time = element('time', 'activity-item__time', formatDate(event.occurredAt, { compact: tabular }));
    time.dateTime = event.occurredAt;
    item.append(time);
  }
  return item;
}

function createActivityTableHeader({ showApp = false, showTime = true } = {}) {
  const header = element('div', 'activity-table-header');
  header.setAttribute('aria-hidden', 'true');
  const columns = [];
  if (showApp) columns.push(['--app', 'Módulo']);
  columns.push(
    ['--title', 'Contenido'],
    ['--type', 'Tipo'],
    ['--score', 'Puntuación'],
    ['--status', 'Estado']
  );
  if (showTime) columns.push(['--time', 'Fecha']);
  columns.forEach(([modifier, label]) => {
    header.append(element('span', `activity-table-header__col activity-table-header__col${modifier}`, label));
  });
  return header;
}

function createEmptyState(title, description) {
  const state = element('div', 'empty-state');
  const icon = element('span', 'empty-state__icon', '◇');
  icon.setAttribute('aria-hidden', 'true');
  state.append(icon, element('h3', '', title), element('p', '', description));
  return state;
}

function renderActivityList(container, events, limit, { tabular = false, showApp = false, showTime = true, emptyDescription } = {}) {
  if (!container) return;
  container.replaceChildren();
  container.classList.toggle('activity-list--compact', tabular);
  container.classList.toggle('activity-list--with-app', tabular && showApp);
  container.classList.toggle('activity-list--no-time', tabular && !showTime);
  const visible = typeof limit === 'number' ? events.slice(0, limit) : events;
  if (visible.length === 0) {
    const description = emptyDescription ?? 'Tus sesiones recientes se mostrarán aquí al completar actividades en tus módulos.';
    container.append(createEmptyState('Sin actividad reciente', description));
    return;
  }
  if (tabular) container.append(createActivityTableHeader({ showApp, showTime }));
  visible.forEach((event) => {
    try {
      container.append(createActivityItem(event, { tabular, showApp, showTime }));
    } catch (error) {
      console.error('No se pudo renderizar un evento de actividad', event, error);
    }
  });
}

function renderActivity() {
  const events = allValidEvents();
  const filtered = activityFilter === 'all' ? events : events.filter((event) => event.app === activityFilter);
  renderActivityList(document.getElementById('allActivity'), filtered, undefined, {
    tabular: true,
    showApp: activityFilter === 'all'
  });
}

function renderRecentActivity() {
  const allDeferred = APPS.every((app) => shouldDeferActivityDisplay(app));
  if (allDeferred) {
    renderActivityList(document.getElementById('recentActivity'), [], 3, {
      emptyDescription: 'Tus sesiones recientes se mostrarán aquí al completar actividades en tus módulos.'
    });
    return;
  }
  renderActivityList(document.getElementById('recentActivity'), latestValidEvents(3), 3, {
    emptyDescription: 'Tus sesiones recientes se mostrarán aquí al completar actividades en tus módulos.'
  });
}

function renderStreak() {
  const heading = document.getElementById('streakHeading');
  const description = document.getElementById('streakDescription');
  const value = document.getElementById('streakValue');
  const allDeferred = APPS.every((app) => shouldDeferActivityDisplay(app));
  // Sin límite: el streak necesita el historial completo por app (hasta 200 eventos,
  // ver MAX_ACTIVITY_EVENTS en progress-reader.js), no solo los 3-4 más recientes que
  // usan renderRecentActivity()/allValidEvents() para la lista visible.
  const streak = allDeferred ? 0 : calculateStreak(latestValidEvents(Infinity));

  heading.textContent = streak === 1 ? '1 día' : `${streak} días`;
  value.textContent = `🔥 ${streak}`;
  description.textContent = streak > 0
    ? 'Racha activa en tus tres módulos.'
    : 'Completa una actividad hoy para empezar tu racha.';
}

function renderContinue() {
  const container = document.getElementById('continueGrid');
  container.replaceChildren();

  APPS.forEach((app) => {
    const config = APP_CONFIG[app];
    const result = getAppResult(app);
    const card = element('article', `continue-card continue-card--${config.color}`);
    const top = element('div', 'continue-card__top');
    top.append(element('span', 'section-kicker', config.eyebrow), createStatusPill(result.progress.status));
    card.append(top, element('h2', '', config.name));

    if (hasValidProgress(result) && result.progress.data.summary.lastContent) {
      const last = result.progress.data.summary.lastContent;
      card.append(element('p', 'continue-card__label', 'Último contenido válido'), element('h3', '', resolveContentTitle(last, contentTitleIndex)));
      const details = [];
      if (last.activity) details.push(readableActivity(last.activity));
      if (last.progressPct !== null) details.push(`${rounded(last.progressPct)}% completado`);
      if (last.scorePct !== null) details.push(`score ${rounded(last.scorePct)}%`);
      const descText = Array.isArray(config.description) ? config.description.join(' ') : config.description;
      card.append(element('p', 'continue-card__description', details.join(' · ') || descText));
    } else {
      const descText = Array.isArray(config.description) ? config.description.join(' ') : config.description;
      card.append(element('p', 'continue-card__label', 'Sin último contenido disponible'), element('h3', '', STATUS_COPY[result.progress.status]), element('p', 'continue-card__description', descText));
    }

    card.append(createAppLink(app, hasValidProgress(result) ? `Continuar en ${config.name}` : `Explorar ${config.name}`, true));
    container.append(card);
  });
}

function buildModuleInsight(app, result, config) {
  const insight = element('section', `detail-insight detail-insight--${config.color}`);
  const kickers = {
    fluentflow: 'Lectura CEFR',
    hubflow: 'Práctica temática',
    lyricflow: 'Progreso por actividad'
  };

  insight.append(element('p', 'detail-insight__kicker section-kicker', kickers[app]));

  if (app === 'fluentflow') {
    const cefr = hasValidProgress(result) ? result.progress.data.cefr : null;
    const headline = cefr ? `Ruta ${cefr.level}` : 'Sin nivel CEFR';
    insight.append(element('h2', 'detail-insight__title', headline));
  } else if (app === 'hubflow') {
    const metrics = hasValidProgress(result) ? progressDisplayMetrics(result) : null;
    const headline = metrics?.total ? `${metrics.total} ejercicios` : 'Práctica temática';
    insight.append(element('h2', 'detail-insight__title', headline));
  } else {
    const metrics = hasValidProgress(result) ? progressDisplayMetrics(result) : null;
    const headline = metrics?.total ? `${metrics.total} actividades` : 'Catálogo musical';
    insight.append(element('h2', 'detail-insight__title', headline));
  }

  return insight;
}

function renderModuleDetail(app) {
  const config = APP_CONFIG[app];
  const result = getAppResult(app);
  const container = document.querySelector(`[data-app-detail="${app}"]`);
  container.replaceChildren();

  const actionBar = element('a', `lp-btn lp-btn--${config.color} module-detail__action app-link`);
  actionBar.href = config.url;
  actionBar.dataset.appLink = app;
  actionBar.rel = 'noopener';

  const actionLabel = hasValidProgress(result) ? `Continuar en ${config.name}` : `Explorar ${config.name}`;
  actionBar.append(element('span', 'module-detail__label', actionLabel));

  const insight = buildModuleInsight(app, result, config);
  const hero = element('div', `module-detail__hero module-detail__hero--${config.color}`);
  const mark = element('span', 'module-detail__mark', config.name.charAt(0));
  mark.setAttribute('aria-hidden', 'true');
  hero.append(mark, insight, actionBar);

  const statsSection = element('section', 'section-block detail-metrics');
  const statsCard = element('div', `detail-metrics__card detail-metrics__card--${config.color}`);
  const statsHeader = element('header', 'detail-metrics__header');
  const statsTitle = element('h2', 'detail-metrics__title');
  statsTitle.append(element('span', 'section-kicker', 'En números'), document.createTextNode(' Métricas'));
  statsHeader.append(statsTitle);
  statsCard.append(statsHeader);

  const progressValue = hasValidProgress(result) ? displayProgressPct(result) : 0;
  statsCard.append(createProgressBar(progressValue, `Progreso de ${config.name}`));

  const stats = element('div', 'detail-stats');
  const progressStat = element('article', 'detail-stat');
  progressStat.append(element('span', '', 'Progreso'), element('strong', '', progressLabel(result)), createStatusPill(result.progress.status));
  const contentStat = element('article', 'detail-stat');
  contentStat.append(element('span', '', 'Completado'), element('strong', '', completedMetric(result)), element('p', '', progressDisplayMetrics(result).unit));
  stats.append(progressStat, contentStat);
  statsCard.append(stats);
  statsSection.append(statsCard);

  const activity = element('section', 'section-block detail-activity');
  const activityCard = element('div', `detail-activity__card detail-activity__card--${config.color}`);
  const activityHeader = element('header', 'detail-activity__header');
  const activityTitle = element('h2', 'detail-activity__title', 'Actividad reciente');
  activityHeader.append(activityTitle);
  const list = element('div', 'activity-list activity-list--compact');
  const events = result.activity.status === STATUS.READY ? [...result.activity.data.events].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)) : [];
  renderActivityList(list, events, 3, {
    tabular: true,
    showTime: false,
    emptyDescription: `Completa una sesión en ${config.name} y aparecerá en esta lista.`
  });
  activityCard.append(activityHeader, list);
  activity.append(activityCard);

  const overview = element('div', 'module-detail__overview');
  overview.append(hero, statsSection);
  container.append(overview, activity);
}

function renderDataHealth() {
  const description = document.getElementById('dataHealthDescription');
  const counts = appData.reduce((summary, result) => {
    summary[result.progress.status] = (summary[result.progress.status] || 0) + 1;
    return summary;
  }, {});

  if ((counts.ready || 0) + (counts.empty || 0) === APPS.length) {
    description.textContent = 'Las tres proyecciones de progreso son válidas. LearnFlow permanece en modo de solo lectura.';
    return;
  }

  const issues = appData
    .filter((result) => !hasValidProgress(result))
    .map((result) => `${APP_CONFIG[result.app].name}: ${STATUS_COPY[result.progress.status].toLowerCase()}`);
  description.textContent = `${issues.join(' · ')}. Los datos ausentes, antiguos o corruptos nunca se convierten en 0%.`;
}

/** Módulo que bloquea la subida de nivel CEFR, si lo hay; si no, 'fluentflow' por defecto. */
function pickFallbackApp() {
  const activeLevel = getActiveLevel();
  const progress = getCombinedLevelProgress(activeLevel);
  const apps = ['fluentflow', 'hubflow', 'lyricflow'];
  const pending = apps.filter((app) => progress[app].progressPct < CEFR_APP_THRESHOLDS[app]);
  return pending[0] || 'fluentflow';
}

function renderPrimaryContinue() {
  const link = document.getElementById('primaryContinueLink');
  const bannerTitle = document.getElementById('continueTitle');
  const defaultApp = 'fluentflow';
  const defaultConfig = APP_CONFIG[defaultApp];

  if (isStatsDeferred()) {
    link.href = defaultConfig.url;
    link.dataset.appLink = defaultApp;
    bannerTitle.textContent = 'Retoma donde lo dejaste';
    link.textContent = '';
    link.append(document.createTextNode('Continuar '));
    const arrow = element('span', '', '→');
    arrow.setAttribute('aria-hidden', 'true');
    link.append(arrow);
    return;
  }

  const candidates = appData
    .filter((result) => hasValidProgress(result) && result.progress.data.summary.lastContent)
    .sort((a, b) => new Date(b.progress.data.summary.lastContent.occurredAt || 0) - new Date(a.progress.data.summary.lastContent.occurredAt || 0));
  const selectedApp = candidates[0]?.app || pickFallbackApp();
  const config = APP_CONFIG[selectedApp];
  link.href = config.url;
  link.dataset.appLink = selectedApp;

  if (candidates.length && candidates[0].progress.data.summary.lastContent) {
    const last = candidates[0].progress.data.summary.lastContent;
    bannerTitle.textContent = resolveContentTitle(last, contentTitleIndex) || `Continuar en ${config.name}`;
    link.textContent = '';
    link.append(document.createTextNode(`Continuar `));
    const arrow = element('span', '', '→');
    arrow.setAttribute('aria-hidden', 'true');
    link.append(arrow);
  } else {
    const selectedResult = appData.find((result) => result.app === selectedApp);
    const alreadyStarted = selectedResult && hasValidProgress(selectedResult) && displayProgressPct(selectedResult) > 0;
    bannerTitle.textContent = alreadyStarted ? `Sigue con ${config.name}` : 'Empieza a aprender';
    link.textContent = '';
    link.append(element('span', 'lp-btn__verb', 'Abrir '), document.createTextNode(`${config.name} `));
    const arrow = element('span', '', '→');
    arrow.setAttribute('aria-hidden', 'true');
    link.append(arrow);
  }
}

function isLocalEnvironment() {
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
}

function prepareAppLinks() {
  document.querySelectorAll('[data-app-link]').forEach((link) => {
    const app = link.dataset.appLink;
    if (!APP_CONFIG[app]) return;
    let href = window.LPPlatformUrls
      ? window.LPPlatformUrls.appHref(app)
      : APP_CONFIG[app].url;
    if (window.LPTheme) href = window.LPTheme.appendThemeToHref(href);
    link.href = href;
    if (window.LPPlatformUrls?.isLocalDev()) link.removeAttribute('rel');
    else link.rel = 'noopener';
  });
}

function renderAll() {
  const animateReveal = consumeStatsRevealAnimation();
  repairLocalProjections();
  appData = reader.readAll();
  contentTitleIndex = buildContentTitleIndex(appData);
  renderGlobalProgress(animateReveal);
  renderHeaderStats(animateReveal);
  renderCefr();
  renderStreak();
  renderModuleCards(animateReveal);
  renderRecentActivity();
  renderContinue();
  APPS.forEach(renderModuleDetail);
  renderActivity();
  renderDataHealth();
  renderPrimaryContinue();
  prepareAppLinks();
  maybePromptLoginAfterFirstActivity();
  updatePlacementTestTrigger();
  maybeOfferPlacementTest();
}

// Examen de placement B2+ (ver docs/placement-test-b2plus-plan.md) — la función
// pura scorePlacement vive en un módulo ESM (import arriba); la UI del examen
// es un <script> plano (lp-placement-test.js, mismo patrón que lpOnboarding),
// así que se le inyecta acá en vez de que ella importe el módulo directo.
function placementTestOptions() {
  return { score: scorePlacement, stage1Level: STAGE1_LEVEL, stage2Levels: STAGE2_LEVELS };
}

// Puente encuesta → examen: lpOnboarding es un <script> plano sin acceso al
// scorePlacement importado acá, así que le pasamos este callback en vez de
// que abra el examen directo (mismo patrón de inyección que placementTestOptions).
function openPlacementTestNow() {
  if (window.lpPlacementTest) lpPlacementTest.open(placementTestOptions());
}

function updatePlacementTestTrigger() {
  const trigger = document.getElementById('placementTestTrigger');
  if (!trigger || typeof lpPlacementTest === 'undefined') return;
  trigger.hidden = !lpPlacementTest.isPending();
}

// Fase P.3 — mismo criterio que B.5: se ofrece después de la primera actividad
// real (allValidEvents().length > 0), no al inicio. lpPlacementTest.maybeShowOffer
// ya es idempotente (guarda propia contra duplicados/sesión descartada).
function maybeOfferPlacementTest() {
  if (typeof lpPlacementTest === 'undefined') return;
  if (allValidEvents().length === 0) return;
  const container = document.getElementById('resumenDashboard');
  lpPlacementTest.maybeShowOffer(container, placementTestOptions());
}

// Fase B.5 — registro diferido: nunca al inicio, solo una vez que hay
// progreso real que perder. Se dispara como máximo una vez por invitado
// (lp-guest-reset.js borra la bandera junto con el resto de la identidad).
const LOGIN_PROMPT_SEEN_KEY = 'lp-login-prompted-v1';

function maybePromptLoginAfterFirstActivity() {
  if (typeof lpLogin === 'undefined') return;
  if (localStorage.getItem(LOGIN_PROMPT_SEEN_KEY)) return;
  if (lpLogin.getUser()) {
    localStorage.setItem(LOGIN_PROMPT_SEEN_KEY, '1');
    return;
  }
  if (allValidEvents().length === 0) return;
  localStorage.setItem(LOGIN_PROMPT_SEEN_KEY, '1');
  if (typeof window.lpTrack === 'function') window.lpTrack('login_prompt_after_first_activity');
  lpLogin.open({
    copy: {
      eyebrow: 'Primera actividad completada',
      title: 'Guarda tu progreso',
      lede: 'Ahora mismo tu progreso vive solo en este dispositivo: si cambias de teléfono, ' +
        'limpias el navegador o lo pierdes, se pierde con él. Crear una cuenta lo respalda en ' +
        'la nube en menos de un minuto — o puedes seguir como invitado y hacerlo más adelante.'
    }
  });
}

let renderAllScheduled = false;
function scheduleRenderAll() {
  if (renderAllScheduled) return;
  renderAllScheduled = true;
  requestAnimationFrame(() => {
    renderAllScheduled = false;
    renderAll();
  });
}

const NAVIGATION_MODE_KEY = 'lp-navigation-mode';
const NAVIGATION_MODES = new Set(['sidebar', 'floating']);
const MOBILE_SIDEBAR_MQ = window.matchMedia('(max-width: 768px)');

function syncSidebarMount() {
  const shell = document.querySelector('.app-shell');
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  const launcher = document.getElementById('navigationLauncher');
  if (!shell || !sidebar || !scrim) return;

  const mobile = MOBILE_SIDEBAR_MQ.matches;
  const target = mobile ? document.body : shell;

  if (scrim.parentElement === target && sidebar.parentElement === target) return;

  if (mobile) {
    document.body.appendChild(scrim);
    document.body.appendChild(sidebar);
    return;
  }

  if (launcher) {
    launcher.insertAdjacentElement('afterend', scrim);
    scrim.insertAdjacentElement('afterend', sidebar);
    return;
  }

  shell.insertBefore(scrim, shell.firstChild);
  scrim.insertAdjacentElement('afterend', sidebar);
}

function syncDrawerPersistent() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const persistent = !MOBILE_SIDEBAR_MQ.matches && document.documentElement.dataset.navigationMode === 'sidebar';
  sidebar.classList.toggle('is-persistent', persistent);
}

function setSidebarOpen(open) {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  const toggles = [document.getElementById('menuToggle'), document.getElementById('topbarMenuToggle'), document.getElementById('navigationLauncher')].filter(Boolean);
  const mobile = MOBILE_SIDEBAR_MQ.matches;

  if (mobile) syncSidebarMount();

  sidebar.classList.toggle('is-open', open);
  scrim.classList.toggle('is-open', open);
  scrim.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('lp-drawer-open', open);

  if (open && typeof lpLogin !== 'undefined' && lpLogin.refreshNavLabels) {
    lpLogin.refreshNavLabels();
  }

  toggles.forEach((toggle) => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar navegación' : toggle.id === 'navigationLauncher' ? 'Abrir navegación flotante' : 'Abrir navegación');
  });
}

function closeSidebar() {
  setSidebarOpen(false);
}

function setNavigationMode(mode, persist = false) {
  const resolvedMode = NAVIGATION_MODES.has(mode) ? mode : 'sidebar';
  document.documentElement.dataset.navigationMode = resolvedMode;
  const toggle = document.getElementById('navigationModeToggle');
  if (toggle) {
    const isFloating = resolvedMode === 'floating';
    toggle.setAttribute('aria-pressed', String(isFloating));
    toggle.setAttribute('aria-label', isFloating ? 'Usar barra lateral fija' : 'Usar navegación flotante');
    toggle.title = isFloating ? 'Muestra la barra lateral fija' : 'Oculta la barra lateral y usa un menú flotante';
    const icon = toggle.querySelector('span');
    if (icon) icon.textContent = isFloating ? '▣' : '◫';
  }
  if (persist) localStorage.setItem(NAVIGATION_MODE_KEY, resolvedMode);
  syncDrawerPersistent();
  closeSidebar();
}

function setupNavigationMode() {
  const savedMode = localStorage.getItem(NAVIGATION_MODE_KEY);
  setNavigationMode(NAVIGATION_MODES.has(savedMode) ? savedMode : 'sidebar');
  syncDrawerPersistent();
  MOBILE_SIDEBAR_MQ.addEventListener('change', syncDrawerPersistent);
  document.getElementById('navigationModeToggle').addEventListener('click', () => {
    const nextMode = document.documentElement.dataset.navigationMode === 'floating' ? 'sidebar' : 'floating';
    setNavigationMode(nextMode, true);
  });
  document.getElementById('drawerCloseBtn')?.addEventListener('click', closeSidebar);
}

const TOPBAR_CONTENT = {
  resumen: { eyebrow: 'Tu plataforma de aprendizaje', title: 'LearnFlow', sub: '' },
  continuar: { eyebrow: 'Retoma el hilo', title: 'Continuar aprendiendo', sub: 'Accesos directos basados en el último dato válido de cada módulo.' },
  actividad: {
    eyebrow: 'Historial local',
    title: 'Actividad',
    sub: 'Eventos recientes publicados por los módulos.',
    subMobile: 'Eventos recientes de tus módulos.',
  },
  fluentflow: {
    eyebrow: 'Ruta estructurada',
    title: 'FluentFlow',
    sub: 'Ruta A1–C2 con módulos secuenciales y práctica guiada.',
    subMobile: 'Ruta A1–C2 con práctica guiada.',
  },
  hubflow: {
    eyebrow: 'Práctica temática',
    title: 'HubFlow',
    sub: '80 ejercicios · 4 categorías · 5 modos incluyendo Battle 2P.',
    subMobile: '80 ejercicios · 4 categorías · 5 modos.',
  },
  lyricflow: {
    eyebrow: 'Aprendizaje con música',
    title: 'LyricFlow',
    sub: '9 canciones · 36 actividades (escucha, dictado, challenge y quiz).',
    subMobile: 'Progreso por actividad en cada canción.',
  },
};

/**
 * El max-width de .topbar-greeting deja menos espacio real del necesario en
 * el rango ~832-1100px (pill de stats centrado + botón atrás compiten por el
 * mismo ancho) — se detecta el truncamiento en vivo en vez de fijar un
 * breakpoint mágico, porque el punto exacto de corte depende del largo de
 * cada texto (H1/1.7). Sin `short` disponible, se deja el truncamiento CSS
 * existente (ellipsis) como red de seguridad.
 */
function setSubTextSafe(subEl, full, short) {
  subEl.textContent = full;
  if (short && subEl.scrollWidth > subEl.clientWidth) subEl.textContent = short;
}

function resolveTopbarSub(content, viewName) {
  if (viewName === 'resumen') return RESUMEN_HINTS[0].full;
  const useMobileCopy = window.matchMedia('(max-width: 768px)').matches;
  if (useMobileCopy && content.subMobile) return content.subMobile;
  return content.sub;
}

function applyTopbarSub(subEl, content, viewName) {
  if (viewName === 'resumen') {
    setSubTextSafe(subEl, RESUMEN_HINTS[0].full, RESUMEN_HINTS[0].short);
    return;
  }
  setSubTextSafe(subEl, resolveTopbarSub(content, viewName), content.subMobile);
}

const RESUMEN_HINTS = [
  { full: 'Tres módulos, un hilo: estructura, práctica y música conectados.', short: 'Tres módulos, un hilo conectado.' },
  { full: 'Tu progreso vive aquí, en tu navegador. Sin cuentas, sin excusas.', short: 'Tu progreso vive en tu navegador.' },
  { full: 'Cada sesión cuenta. Vuelve cuando quieras, todo sigue donde lo dejaste.', short: 'Cada sesión cuenta. Todo sigue donde lo dejaste.' },
];

const MODULE_VIEWS = new Set(['fluentflow', 'hubflow', 'lyricflow']);
/** Vistas con header secundario mobile: [←] título [☰] */
const SECONDARY_TOPBAR_VIEWS = new Set(['actividad', 'continuar', ...MODULE_VIEWS]);

function setTopbarTitle(titleEl, title) {
  titleEl.replaceChildren();
  if (title.endsWith('Flow')) {
    titleEl.append(title.slice(0, -4), Object.assign(document.createElement('em'), { textContent: 'Flow' }));
    return;
  }
  if (title === 'Continuar aprendiendo') {
    titleEl.append('Continuar ', Object.assign(document.createElement('em'), { textContent: 'aprendiendo' }));
    return;
  }
  titleEl.textContent = title;
}

function updateTopbar(viewName) {
  const topbar = document.getElementById('deskTopbar');
  const backBtn = document.getElementById('topbarBackBtn');
  const eyebrowEl = document.getElementById('topbarEyebrow');
  const titleEl = document.getElementById('summaryTitle');
  const subEl = document.getElementById('topbarSub');
  const resolvedView = viewName || 'resumen';
  const isSecondaryTopbar = SECONDARY_TOPBAR_VIEWS.has(resolvedView);
  topbar.dataset.view = resolvedView;
  topbar.classList.toggle('topbar--module', isSecondaryTopbar);
  topbar.classList.remove('topbar--compact');
  if (backBtn) backBtn.hidden = !isSecondaryTopbar;
  const content = TOPBAR_CONTENT[resolvedView];
  if (!content) {
    topbar.classList.add('topbar--compact');
    eyebrowEl.textContent = 'Tu plataforma de aprendizaje';
    eyebrowEl.hidden = false;
    setTopbarTitle(titleEl, 'LearnFlow');
    setSubTextSafe(subEl, RESUMEN_HINTS[0].full, RESUMEN_HINTS[0].short);
    return;
  }
  if (resolvedView !== 'resumen') topbar.classList.add('topbar--compact');
  eyebrowEl.textContent = content.eyebrow;
  eyebrowEl.hidden = false;
  setTopbarTitle(titleEl, content.title);
  applyTopbarSub(subEl, content, resolvedView);
}

function showView(viewName, updateHash = true) {
  const target = document.querySelector(`[data-view-panel="${viewName}"]`);
  if (!target) return;

  document.querySelectorAll('[data-view-panel]').forEach((panel) => {
    const active = panel === target;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => {
    const active = item.dataset.view === viewName;
    item.classList.toggle('is-active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });

  updateTopbar(viewName);
  const shell = document.querySelector('.app-shell');
  if (shell) shell.dataset.view = viewName;
  if (viewName === 'actividad') renderActivity();
  if (updateHash) history.pushState(null, '', `${location.pathname}${location.search}#${viewName}`);
  closeSidebar();
  document.getElementById('mainContent').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function getAppHref(app) {
  if (window.LPPlatformUrls) return window.LPPlatformUrls.appHref(app);
  return `https://genilsuarez.github.io/${app}/`;
}

/** Resuelve la vista activa desde location.hash — usado en la carga inicial y en popstate. */
function navigateFromHash() {
  const hashView = location.hash.slice(1);
  if (hashView === 'about') {
    showView('resumen', false);
    lpAbout.open(null, {
      inertElements: [document.querySelector('.app-shell')],
    });
  } else {
    showView(document.querySelector(`[data-view-panel="${hashView}"]`) ? hashView : 'resumen', false);
  }
}

function setupNavigation() {
  document.addEventListener('click', (event) => {
    const viewControl = event.target.closest('button[data-view]');
    if (viewControl) showView(viewControl.dataset.view);

    const viewLink = event.target.closest('[data-view-link]');
    if (viewLink) {
      event.preventDefault();
      showView(viewLink.dataset.viewLink);
    }

    const localLink = event.target.closest('a[data-app-link]');
    if (localLink && isLocalEnvironment()) {
      // Links handled by isLocalEnvironment() URL resolution only
    }
  });

  const backBtn = document.getElementById('topbarBackBtn');
  if (backBtn) backBtn.addEventListener('click', () => showView('resumen'));

  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  const menuToggles = [document.getElementById('menuToggle'), document.getElementById('topbarMenuToggle'), document.getElementById('navigationLauncher')].filter(Boolean);
  menuToggles.forEach((toggle) => toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setSidebarOpen(!sidebar.classList.contains('is-open'));
  }));
  scrim.addEventListener('click', closeSidebar);

  document.getElementById('settingsTrigger').addEventListener('click', (event) => {
    if (window.lpFluentFlowSettings) lpFluentFlowSettings.updateSectionVisibility();
    lpSettings.open(event, {
      beforeOpen: closeSidebar,
      inertElements: [document.querySelector('.app-shell')],
    });
  });
  document.getElementById('fluentflowAdvancedTrigger').addEventListener('click', (event) => {
    lpFluentFlowSettings.open(event, {
      beforeOpen: () => lpSettings.close(),
      inertElements: [document.querySelector('.app-shell')],
    });
  });
  document.getElementById('aboutTrigger').addEventListener('click', (event) => {
    lpAbout.open(event, {
      beforeOpen: () => { closeSidebar(); lpSettings.close(); },
      inertElements: [document.querySelector('.app-shell')],
    });
  });
  document.getElementById('replayOnboardingTrigger').addEventListener('click', () => {
    closeSidebar();
    lpSettings.close();
    if (window.lpOnboarding) lpOnboarding.open({ force: true, onPlacementReady: openPlacementTestNow });
  });
  document.getElementById('placementTestTrigger').addEventListener('click', () => {
    closeSidebar();
    lpSettings.close();
    if (window.lpPlacementTest) lpPlacementTest.open(placementTestOptions());
  });
  lpLogin.bindNavButton('#loginTrigger', {
    beforeOpen: () => { closeSidebar(); lpSettings.close(); },
    labelSelector: '.nav-label',
    onSync(user, btn) {
      const icon = btn.querySelector('.nav-icon');
      if (icon && window.LpNavIcons) window.LpNavIcons.set(icon, 'user');
      btn.setAttribute('aria-label', user ? user.name + ' — perfil' : 'Iniciar sesión');
    },
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });

  navigateFromHash();
  // Atrás/adelante del navegador debe navegar entre vistas internas, no salir de la
  // app en un solo "atrás" (H11/1.14). showView() ya usa pushState para los clicks del
  // usuario (arriba); acá solo se responde al cambio de hash que el navegador ya hizo —
  // showView(hash, false) evita volver a empujar una entrada de historia.
  window.addEventListener('popstate', navigateFromHash);

  window.addEventListener('resize', () => {
    syncSidebarMount();
    const activePanel = document.querySelector('[data-view-panel].is-active');
    if (!activePanel) return;
    updateTopbar(activePanel.id.replace('view-', ''));
  });
}

function setupTheme() {
  const toggles = document.querySelectorAll('.theme-toggle');
  const update = () => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    toggles.forEach((toggle) => {
      const icon = toggle.querySelector('.nav-icon');
      const label = toggle.querySelector('.theme-toggle__label');
      if (icon && window.LpNavIcons) window.LpNavIcons.setTheme(icon, isDark);
      if (label) label.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
      toggle.setAttribute('aria-label', isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    });
  };

  toggles.forEach((toggle) => toggle.addEventListener('click', () => {
    if (window.LPTheme) {
      window.LPTheme.toggleTheme();
    } else {
      document.documentElement.classList.add('theme-transitioning');
      const newTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      if (newTheme === 'dark') document.documentElement.dataset.theme = 'dark';
      else document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('lp-theme', newTheme);
      setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350);
    }
    update();
  }));
  update();
}

function setupActivityFilters() {
  document.querySelectorAll('[data-activity-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      activityFilter = button.dataset.activityFilter;
      document.querySelectorAll('[data-activity-filter]').forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle('active', active);
        candidate.setAttribute('aria-pressed', String(active));
      });
      renderActivity();
    });
  });
}

setupTheme();
setupNavigationMode();
syncSidebarMount();
MOBILE_SIDEBAR_MQ.addEventListener('change', syncSidebarMount);
setupNavigation();
setupActivityFilters();
renderAll();
if (window.lpOnboarding && !lpOnboarding.hasSeenOnboarding() && location.hash !== '#about') {
  lpOnboarding.open({ onPlacementReady: openPlacementTestNow });
}
void Promise.all([
  hydrateActivityFromCloud('fluentflow'),
  hydrateActivityFromCloud('hubflow'),
  hydrateActivityFromCloud('lyricflow'),
]);
void warmAllCatalogTotals().then((changed) => {
  if (changed) scheduleRenderAll();
});
window.addEventListener('lp-stats-ready', () => scheduleRenderAll());
window.addEventListener('lp-activity-ready', () => scheduleRenderAll());
setupSupabaseAuth({
  onAfterLogin: () => scheduleRenderAll(),
  onAfterLogout: () => scheduleRenderAll(),
});
window.addEventListener('lp-cloud-hydrated', () => scheduleRenderAll());
window.addEventListener('lp-sync-peer', () => scheduleRenderAll());
window.addEventListener('lp-guest-reset', () => {
  scheduleRenderAll();
});

if (new URLSearchParams(location.search).has('debug')) {
  document.getElementById('dataHealth').hidden = false;
  window.lpSyncAudit = {
    local: auditLocalProjections,
    cloud: auditCloudAlignment,
    repair: repairLocalProjections,
    fullSync: () => runFullSync({ force: true }),
  };
}
document.getElementById('refreshData')?.addEventListener('click', scheduleRenderAll);
window.addEventListener('storage', (event) => {
  if (event.key === NAVIGATION_MODE_KEY) {
    setNavigationMode(NAVIGATION_MODES.has(event.newValue) ? event.newValue : 'sidebar');
    return;
  }
  if (/^learnflow:(progress|activity):(fluentflow|hubflow|lyricflow):v1$/.test(event.key || '')) scheduleRenderAll();
});

(function rotateHints() {
  const hints = RESUMEN_HINTS;
  if (hints.length < 2) return;
  let current = 0;
  const subEl = document.getElementById('topbarSub');
  setInterval(() => {
    const activeView = document.querySelector('[data-view-panel].is-active');
    if (!activeView || activeView.id !== 'view-resumen') return;
    current = (current + 1) % hints.length;
    subEl.style.opacity = '0';
    setTimeout(() => {
      setSubTextSafe(subEl, hints[current].full, hints[current].short);
      subEl.style.opacity = '1';
    }, 300);
  }, 120000);
})();
