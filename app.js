import { APPS, ProgressReader, STATUS } from './progress-reader.js';
import { buildContentTitleIndex, resolveContentTitle } from './content-title.js';
import * as lpSupabase from './lp-supabase.js';
import { runFullSync, downloadOnLogin, resetDownloadState } from './sync-engine.js';

window.lpSupabase = lpSupabase;

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
    description: '5 modos por ejercicio incluyendo Battle 2P.',
    unit: 'contenidos',
    lastLabel: 'Ejercicio',
    color: 'amber',
    url: 'https://genilsuarez.github.io/hubflow/'
  },
  lyricflow: {
    name: 'LyricFlow',
    eyebrow: 'Aprendizaje con música',
    description: 'Entrena escucha y comprensión con canciones y actividades.',
    unit: 'canciones',
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
  return result.progress.status === STATUS.READY || result.progress.status === STATUS.EMPTY;
}

/** Métricas primarias para UI — LyricFlow cuenta actividades; el % mostrado deriva de completed/total. */
function progressDisplayMetrics(result) {
  const summary = result.progress.data.summary;
  if (
    result.app === 'lyricflow'
    && summary.completedActivities != null
    && summary.totalActivities != null
    && summary.totalActivities > 0
  ) {
    return {
      completed: summary.completedActivities,
      total: summary.totalActivities,
      unit: 'actividades',
    };
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

function attemptedMetric(result) {
  if (hasValidProgress(result)) return String(result.progress.data.summary.attemptedContent);
  return '0';
}

function attemptedTotalLabel(result) {
  if (hasValidProgress(result)) return `de ${result.progress.data.summary.totalContent}`;
  return 'de 0';
}

function createStatusPill(status) {
  const tone = status === STATUS.READY ? 'success' : status === STATUS.EMPTY ? 'neutral' : 'warning';
  return element('span', `status-pill status-pill--${tone}`, STATUS_COPY[status]);
}

function createProgressBar(value, label) {
  const track = element('div', 'progress-track');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(value));
  const fill = element('span', 'progress-track__fill');
  fill.style.width = `${value}%`;
  track.append(fill);
  return track;
}

function createAppLink(app, label = 'Abrir módulo', primary = false) {
  const config = APP_CONFIG[app];
  const link = element('a', primary ? 'lp-btn lp-btn--primary app-link' : 'text-action app-link');
  link.href = config.url;
  link.dataset.appLink = app;
  link.rel = 'noopener';
  appendLinkLabel(link, label);
  appendArrow(link);
  return link;
}

function createModuleCardLast(last, config) {
  const row = element('span', 'module-card__last');
  row.append(
    element('span', 'module-card__last-label', `${config.lastLabel} ·`),
    element('span', 'module-card__last-title', resolveContentTitle(last, contentTitleIndex))
  );
  return row;
}

function renderModuleCards() {
  const container = document.getElementById('summaryModules');
  container.replaceChildren();

  APPS.forEach((app) => {
    const config = APP_CONFIG[app];
    const result = getAppResult(app);
    const card = element('button', `module-card module-card--${config.color}`);
    card.type = 'button';
    card.dataset.view = app;

    const mark = element('span', 'module-card__mark', config.name.charAt(0));
    mark.setAttribute('aria-hidden', 'true');

    const copy = element('div', 'module-card__copy');
    const hint = element('span', 'module-card__hint', appMetric(result, config));
    copy.append(element('strong', 'module-card__label', config.name), hint);
    if (hasValidProgress(result) && result.progress.data.summary.lastContent) {
      copy.append(createModuleCardLast(result.progress.data.summary.lastContent, config));
    }

    const pct = element('span', 'module-card__pct', progressLabel(result));

    const chevron = element('span', 'module-card__chevron', '→');
    chevron.setAttribute('aria-hidden', 'true');

    const progressValue = hasValidProgress(result) ? displayProgressPct(result) : 0;
    const progress = createProgressBar(progressValue, `Progreso de ${config.name}`);
    progress.classList.add('module-card__bar');

    card.append(mark, copy, pct, chevron, progress);
    container.append(card);
  });
}

function renderGlobalProgress() {
  const validResults = appData.filter(hasValidProgress);
  const value = document.getElementById('globalValue');
  const unit = document.getElementById('globalUnit');
  const ring = document.getElementById('globalRing');
  const status = document.getElementById('globalStatus');
  const description = document.getElementById('globalDescription');

  if (validResults.length === APPS.length) {
    const average = validResults.reduce((total, result) => total + displayProgressPct(result), 0) / APPS.length;
    const displayValue = rounded(average);
    value.textContent = `${displayValue}%`;
    unit.textContent = 'prom.';
    ring.style.setProperty('--progress', String(displayValue));
    ring.setAttribute('aria-label', `Progreso global ${displayValue} por ciento`);
    status.className = 'status-pill status-pill--success';
    status.textContent = 'Completo';
    description.textContent = 'Promedio equilibrado de las tres fuentes.';
    return;
  }

  const partial = validResults.length > 0;
  if (partial) {
    const average = validResults.reduce((total, result) => total + displayProgressPct(result), 0) / validResults.length;
    const displayValue = rounded(average);
    value.textContent = `${displayValue}%`;
    unit.textContent = `${validResults.length}/3`;
    ring.style.setProperty('--progress', String(displayValue));
    ring.setAttribute('aria-label', `Progreso parcial ${displayValue} por ciento`);
  } else {
    value.textContent = '0%';
    unit.textContent = '0/3';
    ring.style.setProperty('--progress', '0');
    ring.setAttribute('aria-label', 'Progreso global pendiente');
  }
  status.className = 'status-pill status-pill--warning';
  status.textContent = 'Parcial';
  description.textContent = `${validResults.length} de 3 fuentes válidas.`;
}

function renderHeaderStats() {
  const completedEl = document.getElementById('headerStatsCompleted');
  const pctEl = document.getElementById('headerStatsPct');
  if (!completedEl || !pctEl) return;
  const validResults = appData.filter(hasValidProgress);
  const totalCompleted = validResults.reduce((total, result) => total + result.progress.data.summary.completedContent, 0);
  const average = validResults.length > 0
    ? validResults.reduce((total, result) => total + displayProgressPct(result), 0) / validResults.length
    : 0;
  completedEl.textContent = String(totalCompleted);
  pctEl.textContent = `${rounded(average)}%`;
}

function renderCefr() {
  const level = document.getElementById('cefrLevel');
  const description = document.getElementById('cefrDescription');
  if (!level || !description) return;
  const result = getAppResult('fluentflow');
  const cefr = hasValidProgress(result) ? result.progress.data.cefr : null;

  if (!cefr) {
    level.textContent = 'pendiente';
    description.textContent = 'Disponible cuando FluentFlow publique información válida de su ruta.';
    return;
  }

  const statusCopy = {
    not_started: 'sin comenzar',
    in_progress: 'en progreso',
    near_completion: 'cerca de completar',
    completed: 'ruta completada'
  };
  level.textContent = cefr.level;
  description.textContent = `${cefr.level} · ${statusCopy[cefr.status]}. ${cefr.completedModules} de ${cefr.totalModules} módulos del nivel completados.`;
}

const RECENT_ACTIVITY_PER_APP = 4;

function recentEventsForApp(result) {
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
    result.activity.status === STATUS.READY
      ? result.activity.data.events.map((event) => ({ ...event, app: event.app || result.app }))
      : []
  ))
    .sort((first, second) => new Date(second.occurredAt) - new Date(first.occurredAt))
    .slice(0, limit);
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

function createActivityItem(event, { tabular = false, showApp = false } = {}) {
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

  const time = element('time', 'activity-item__time', formatDate(event.occurredAt, { compact: tabular }));
  time.dateTime = event.occurredAt;
  item.append(time);
  return item;
}

function createActivityTableHeader({ showApp = false } = {}) {
  const header = element('div', 'activity-table-header');
  header.setAttribute('aria-hidden', 'true');
  const columns = [];
  if (showApp) columns.push(['--app', 'Módulo']);
  columns.push(
    ['--title', 'Contenido'],
    ['--type', 'Tipo'],
    ['--score', 'Puntuación'],
    ['--status', 'Estado'],
    ['--time', 'Fecha']
  );
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

function renderActivityList(container, events, limit, { tabular = false, showApp = false, emptyDescription } = {}) {
  if (!container) return;
  container.replaceChildren();
  container.classList.toggle('activity-list--compact', tabular);
  container.classList.toggle('activity-list--with-app', tabular && showApp);
  const visible = typeof limit === 'number' ? events.slice(0, limit) : events;
  if (visible.length === 0) {
    const description = emptyDescription ?? 'Tus sesiones recientes se mostrarán aquí al completar actividades en tus módulos.';
    container.append(createEmptyState('Sin actividad reciente', description));
    return;
  }
  if (tabular) container.append(createActivityTableHeader({ showApp }));
  visible.forEach((event) => {
    try {
      container.append(createActivityItem(event, { tabular, showApp }));
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
  renderActivityList(document.getElementById('recentActivity'), latestValidEvents(3), 3, {
    emptyDescription: 'Tus sesiones recientes se mostrarán aquí al completar actividades en tus módulos.'
  });
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
    lyricflow: 'Progreso por canción'
  };

  insight.append(element('p', 'detail-insight__kicker section-kicker', kickers[app]));

  if (app === 'fluentflow') {
    const cefr = hasValidProgress(result) ? result.progress.data.cefr : null;
    const headline = cefr ? `Ruta ${cefr.level}` : 'Sin nivel CEFR';
    const detail = cefr
      ? `${cefr.completedModules} de ${cefr.totalModules} módulos en el nivel`
      : 'Completa módulos para ver tu nivel.';
    insight.append(element('h2', 'detail-insight__title', headline), element('p', 'detail-insight__detail', detail));
  } else if (app === 'hubflow') {
    insight.append(
      element('h2', 'detail-insight__title', '5 modos por ejercicio'),
      element('p', 'detail-insight__detail', 'Incluye Battle 2P.')
    );
  } else {
    const summary = hasValidProgress(result) ? result.progress.data.summary : null;
    const headline = summary?.totalContent != null ? `${summary.totalContent} canciones` : 'Catálogo musical';
    const detail = summary?.completedActivities != null && summary?.totalActivities != null
      ? `${summary.completedActivities} de ${summary.totalActivities} actividades completadas`
      : 'El desglose aparece al completar canciones.';
    insight.append(element('h2', 'detail-insight__title', headline), element('p', 'detail-insight__detail', detail));
  }

  return insight;
}

function renderModuleDetail(app) {
  const config = APP_CONFIG[app];
  const result = getAppResult(app);
  const container = document.querySelector(`[data-app-detail="${app}"]`);
  container.replaceChildren();

  const actionBar = element('a', `module-detail__action module-detail__action--${config.color} app-link`);
  actionBar.href = config.url;
  actionBar.dataset.appLink = app;
  actionBar.rel = 'noopener';

  const mark = element('span', 'module-detail__mark', config.name.charAt(0));
  mark.setAttribute('aria-hidden', 'true');

  const copy = element('div', 'module-detail__copy');
  const actionLabel = hasValidProgress(result) ? `Continuar en ${config.name}` : `Explorar ${config.name}`;
  const actionHint = hasValidProgress(result) ? progressLabel(result) : config.eyebrow;
  copy.append(element('strong', 'module-detail__label', actionLabel), element('span', 'module-detail__hint', actionHint));

  const chevron = element('span', 'module-detail__chevron', '→');
  chevron.setAttribute('aria-hidden', 'true');

  actionBar.append(mark, copy, chevron);

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
  const attemptedStat = element('article', 'detail-stat');
  attemptedStat.append(element('span', '', 'Iniciado'), element('strong', '', attemptedMetric(result)), element('p', '', attemptedTotalLabel(result)));
  stats.append(progressStat, contentStat, attemptedStat);
  statsCard.append(stats);
  statsSection.append(statsCard);

  const insight = buildModuleInsight(app, result, config);

  const activity = element('section', 'section-block detail-activity');
  const activityCard = element('div', `detail-activity__card detail-activity__card--${config.color}`);
  const activityHeader = element('header', 'detail-activity__header');
  const activityTitle = element('h2', 'detail-activity__title', 'Actividad reciente');
  activityHeader.append(activityTitle);
  const list = element('div', 'activity-list activity-list--compact');
  const events = result.activity.status === STATUS.READY ? [...result.activity.data.events].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)) : [];
  renderActivityList(list, events, 3, {
    tabular: true,
    emptyDescription: `Completa una sesión en ${config.name} y aparecerá en esta lista.`
  });
  activityCard.append(activityHeader, list);
  activity.append(activityCard);

  container.append(actionBar, insight, statsSection, activity);
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

function renderPrimaryContinue() {
  const candidates = appData
    .filter((result) => hasValidProgress(result) && result.progress.data.summary.lastContent)
    .sort((a, b) => new Date(b.progress.data.summary.lastContent.occurredAt || 0) - new Date(a.progress.data.summary.lastContent.occurredAt || 0));
  const selectedApp = candidates[0]?.app || 'fluentflow';
  const config = APP_CONFIG[selectedApp];
  const link = document.getElementById('primaryContinueLink');
  link.href = config.url;
  link.dataset.appLink = selectedApp;

  const bannerTitle = document.getElementById('continueTitle');
  const bannerDesc = document.getElementById('continueDescription');

  if (candidates.length && candidates[0].progress.data.summary.lastContent) {
    const last = candidates[0].progress.data.summary.lastContent;
    bannerTitle.textContent = resolveContentTitle(last, contentTitleIndex) || `Continuar en ${config.name}`;
    bannerDesc.textContent = `${config.name} · ${readableActivity(last.activity || '')}`;
    link.textContent = '';
    link.append(document.createTextNode(`Continuar `));
    const arrow = element('span', '', '→');
    arrow.setAttribute('aria-hidden', 'true');
    link.append(arrow);
  } else {
    bannerTitle.textContent = 'Empieza a aprender';
    bannerDesc.textContent = 'Elige un módulo y comienza tu primera sesión.';
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

function isUnifiedLocalEnvironment() {
  return isLocalEnvironment() && location.port === '3000' && location.pathname.startsWith('/deskflow/');
}

function prepareAppLinks() {
  const host = location.hostname;
  const isLocal = isLocalEnvironment();
  const isUnifiedLocal = isUnifiedLocalEnvironment();
  const localPorts = { fluentflow: '3001', hubflow: '3002', lyricflow: '3003' };

  document.querySelectorAll('[data-app-link]').forEach((link) => {
    const app = link.dataset.appLink;
    if (!APP_CONFIG[app]) return;
    let href = isUnifiedLocal ? `/${app}/` : isLocal ? `http://${host}:${localPorts[app]}/` : APP_CONFIG[app].url;
    if (window.LPTheme) href = window.LPTheme.appendThemeToHref(href);
    link.href = href;
    if (isLocal) link.removeAttribute('rel');
    else link.rel = 'noopener';
  });
}

function renderAll() {
  appData = reader.readAll();
  contentTitleIndex = buildContentTitleIndex(appData);
  renderGlobalProgress();
  renderHeaderStats();
  renderCefr();
  renderModuleCards();
  renderRecentActivity();
  renderContinue();
  APPS.forEach(renderModuleDetail);
  renderActivity();
  renderDataHealth();
  renderPrimaryContinue();
  prepareAppLinks();
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

function setSidebarOpen(open) {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  const toggles = [document.getElementById('menuToggle'), document.getElementById('topbarMenuToggle'), document.getElementById('navigationLauncher')].filter(Boolean);
  const mobile = MOBILE_SIDEBAR_MQ.matches;

  if (mobile) syncSidebarMount();

  sidebar.classList.toggle('is-open', open);
  scrim.classList.toggle('is-visible', open);
  scrim.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('sidebar-open', open);

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
  closeSidebar();
}

function setupNavigationMode() {
  const savedMode = localStorage.getItem(NAVIGATION_MODE_KEY);
  setNavigationMode(NAVIGATION_MODES.has(savedMode) ? savedMode : 'sidebar');
  document.getElementById('navigationModeToggle').addEventListener('click', () => {
    const nextMode = document.documentElement.dataset.navigationMode === 'floating' ? 'sidebar' : 'floating';
    setNavigationMode(nextMode, true);
  });
}

const TOPBAR_CONTENT = {
  resumen: { eyebrow: 'Tu plataforma de aprendizaje', title: 'LearnFlow', sub: '' },
  continuar: { eyebrow: 'Retoma el hilo', title: 'Continuar aprendiendo', sub: 'Accesos directos basados en el último dato válido de cada módulo.' },
  actividad: { eyebrow: 'Historial local', title: 'Actividad', sub: 'Eventos recientes publicados por los módulos.' },
  fluentflow: { eyebrow: 'Ruta estructurada', title: 'FluentFlow', sub: 'Ruta A1–C2 con módulos secuenciales y práctica guiada.' },
  hubflow: { eyebrow: 'Práctica temática', title: 'HubFlow', sub: '55 módulos · 5 modos incluyendo Battle 2P.' },
  lyricflow: {
    eyebrow: 'Aprendizaje con música',
    title: 'LyricFlow',
    sub: 'Entrena escucha y comprensión con canciones y actividades.',
    subMobile: 'Escucha y comprensión con canciones.',
  },
};

function resolveTopbarSub(content, viewName) {
  if (viewName === 'resumen') return RESUMEN_HINTS[0];
  const useMobileCopy = window.matchMedia('(max-width: 768px)').matches;
  if (useMobileCopy && content.subMobile) return content.subMobile;
  return content.sub;
}

const RESUMEN_HINTS = [
  'Tres módulos, un hilo: estructura, práctica y música conectados.',
  'Tu progreso vive aquí, en tu navegador. Sin cuentas, sin excusas.',
  'Cada sesión cuenta. Vuelve cuando quieras, todo sigue donde lo dejaste.'
];

const MODULE_VIEWS = new Set(['fluentflow', 'hubflow', 'lyricflow']);

function setTopbarTitle(titleEl, title) {
  titleEl.replaceChildren();
  if (title.endsWith('Flow')) {
    titleEl.append(title.slice(0, -4), Object.assign(document.createElement('em'), { textContent: 'Flow' }));
    return;
  }
  titleEl.textContent = title;
}

function updateTopbar(viewName) {
  const topbar = document.getElementById('deskTopbar');
  const eyebrowEl = document.getElementById('topbarEyebrow');
  const titleEl = document.getElementById('summaryTitle');
  const subEl = document.getElementById('topbarSub');
  const resolvedView = viewName || 'resumen';
  const isModuleView = MODULE_VIEWS.has(resolvedView);
  topbar.dataset.view = resolvedView;
  topbar.classList.toggle('topbar--module', isModuleView);
  topbar.classList.remove('topbar--compact');
  const content = TOPBAR_CONTENT[resolvedView];
  if (!content) {
    topbar.classList.add('topbar--compact');
    eyebrowEl.textContent = 'Tu plataforma de aprendizaje';
    eyebrowEl.hidden = false;
    setTopbarTitle(titleEl, 'LearnFlow');
    subEl.textContent = RESUMEN_HINTS[0];
    return;
  }
  if (resolvedView !== 'resumen') topbar.classList.add('topbar--compact');
  eyebrowEl.textContent = content.eyebrow;
  eyebrowEl.hidden = false;
  setTopbarTitle(titleEl, content.title);
  subEl.textContent = resolveTopbarSub(content, resolvedView);
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
  if (updateHash) history.replaceState(null, '', `${location.pathname}${location.search}#${viewName}`);
  closeSidebar();
  document.getElementById('mainContent').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function getAppHref(path, port) {
  const host = location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  const isUnified = isLocal && location.port === '3000' && location.pathname.startsWith('/deskflow/');
  if (isUnified) return path;
  if (isLocal) return `http://${host}:${port}/`;
  return `https://genilsuarez.github.io${path}`;
}

function showAboutLearnFlow(event) {
  document.getElementById('aboutLearnFlow')?.remove();
  const opener = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
  const shell = document.querySelector('.app-shell');
  const overlay = document.createElement('div');
  overlay.id = 'aboutLearnFlow';
  overlay.className = 'about-overlay';
  overlay.innerHTML = `
    <section class="about-modal" role="dialog" aria-modal="true" aria-labelledby="aboutLearnFlowTitle" aria-describedby="aboutLearnFlowDescription">
      <header class="about-header">
        <div class="about-identity" aria-hidden="true">L</div>
        <div class="about-header__text">
          <p class="about-eyebrow">LearnFlow · Plataforma</p>
          <h2 id="aboutLearnFlowTitle">About LearnFlow</h2>
        </div>
        <button class="about-close" id="aboutCloseBtn" type="button" aria-label="Cerrar About LearnFlow">✕</button>
      </header>
      <div class="about-body">
        <p id="aboutLearnFlowDescription" class="about-description">Una plataforma para aprender idiomas con estructura, práctica y música.</p>
        <nav class="about-modules" aria-label="Aplicaciones de LearnFlow">
          <a href="${getAppHref('/deskflow/', 3000)}" data-app-link="deskflow">
            <span class="about-module__mark about-module__mark--portal" aria-hidden="true">L</span>
            <span class="about-module__text"><strong>LearnFlow</strong><span>Portal</span></span>
          </a>
          <a href="${getAppHref('/fluentflow/', 3001)}" data-app-link="fluentflow">
            <span class="about-module__mark about-module__mark--fluent" aria-hidden="true">F</span>
            <span class="about-module__text"><strong>FluentFlow</strong><span>Ruta de inglés por niveles CEFR</span></span>
          </a>
          <a href="${getAppHref('/hubflow/', 3002)}" data-app-link="hubflow">
            <span class="about-module__mark about-module__mark--hub" aria-hidden="true">H</span>
            <span class="about-module__text"><strong>HubFlow</strong><span>Práctica flexible de gramática</span></span>
          </a>
          <a href="${getAppHref('/lyricflow/', 3003)}" data-app-link="lyricflow">
            <span class="about-module__mark about-module__mark--lyric" aria-hidden="true">LF</span>
            <span class="about-module__text"><strong>LyricFlow</strong><span>Aprender con música</span></span>
          </a>
        </nav>
      </div>
      <footer class="about-footer">
        <div class="about-author">
          <div class="about-author__avatar" aria-hidden="true">GS</div>
          <div class="about-author__info">
            <strong>Genil Suárez</strong>
            <span>Diseñado y desarrollado como proyecto personal</span>
          </div>
        </div>
      </footer>
    </section>
  `;
  shell.inert = true;
  document.body.appendChild(overlay);
  closeSidebar();

  const focusable = [...overlay.querySelectorAll('button, a[href]')];
  const close = () => {
    overlay.remove();
    shell.inert = false;
    document.removeEventListener('keydown', onAboutKeydown);
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
  const onAboutKeydown = (keyEvent) => {
    if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); close(); return; }
    if (keyEvent.key !== 'Tab' || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (keyEvent.shiftKey && document.activeElement === first) { keyEvent.preventDefault(); last.focus(); }
    else if (!keyEvent.shiftKey && document.activeElement === last) { keyEvent.preventDefault(); first.focus(); }
  };

  overlay.querySelector('#aboutCloseBtn').addEventListener('click', close);
  overlay.addEventListener('click', (clickEvent) => { if (clickEvent.target === overlay) close(); });
  document.addEventListener('keydown', onAboutKeydown);
  overlay.querySelector('#aboutCloseBtn').focus();
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

  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  const menuToggles = [document.getElementById('menuToggle'), document.getElementById('topbarMenuToggle'), document.getElementById('navigationLauncher')].filter(Boolean);
  menuToggles.forEach((toggle) => toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setSidebarOpen(!sidebar.classList.contains('is-open'));
  }));
  scrim.addEventListener('click', closeSidebar);

  sidebar.addEventListener('click', (event) => {
    const viewControl = event.target.closest('button[data-view]');
    if (viewControl) {
      showView(viewControl.dataset.view);
      return;
    }
    const viewLink = event.target.closest('[data-view-link]');
    if (viewLink) {
      event.preventDefault();
      showView(viewLink.dataset.viewLink);
    }
  });

  document.getElementById('aboutTrigger').addEventListener('click', showAboutLearnFlow);
  document.getElementById('loginTrigger').addEventListener('click', () => { closeSidebar(); lpLogin.open(); });
  lpLogin.onUpdate(updateLoginButton);
  updateLoginButton(lpLogin.getUser());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSidebar();
  });

  const initialView = location.hash.slice(1);
  if (initialView === 'about') {
    showView('resumen', false);
    showAboutLearnFlow();
  } else {
    showView(document.querySelector(`[data-view-panel="${initialView}"]`) ? initialView : 'resumen', false);
  }

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

function updateLoginButton(user) {
  const btn = document.getElementById('loginTrigger');
  if (!btn) return;
  const label = btn.querySelector('.nav-label');
  const icon = btn.querySelector('.nav-icon');
  if (user) {
    if (icon && window.LpNavIcons) window.LpNavIcons.set(icon, 'user');
    if (label) label.textContent = user.name;
    btn.setAttribute('aria-label', user.name + ' — perfil');
  } else {
    if (icon && window.LpNavIcons) window.LpNavIcons.set(icon, 'user');
    if (label) label.textContent = 'Iniciar Sesión';
    btn.setAttribute('aria-label', 'Iniciar sesión');
  }
}

function setupPageContext() {
  const now = new Date();
  document.getElementById('currentDate').textContent = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
}

async function setupSupabaseAuth() {
  lpSupabase.onAuthStateChange((_event, session) => {
    if (!session || !session.user) {
      resetDownloadState();
      if (lpLogin.getUser()?.isSupabaseUser) {
        lpLogin.setUser(null);
      }
      return;
    }
    lpSupabase.fetchProfile().then((profile) => {
      lpLogin.setUserFromSupabase(session.user, profile);
      // Descarga primero (pobla/mezcla el caché local), luego sube el
      // resultado mezclado — así no se pierde nada en ningún sentido.
      downloadOnLogin()
        .then(() => runFullSync({ force: true }))
        .then(() => renderAll());
    });
  });

  const authed = await lpSupabase.isAuthenticated();
  if (authed) {
    downloadOnLogin().then(() => {
      renderAll();
      return runFullSync();
    });
  }
}

setupPageContext();
setupTheme();
setupNavigationMode();
syncSidebarMount();
MOBILE_SIDEBAR_MQ.addEventListener('change', syncSidebarMount);
setupNavigation();
setupActivityFilters();
renderAll();
setupSupabaseAuth();

if (new URLSearchParams(location.search).has('debug')) {
  document.getElementById('dataHealth').hidden = false;
}
document.getElementById('refreshData').addEventListener('click', renderAll);
window.addEventListener('storage', (event) => {
  if (event.key === NAVIGATION_MODE_KEY) {
    setNavigationMode(NAVIGATION_MODES.has(event.newValue) ? event.newValue : 'sidebar');
    return;
  }
  if (/^learnflow:(progress|activity):(fluentflow|hubflow|lyricflow):v1$/.test(event.key || '')) renderAll();
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
      subEl.textContent = hints[current];
      subEl.style.opacity = '1';
    }, 300);
  }, 120000);
})();
