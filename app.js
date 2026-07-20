import { APPS, ProgressReader, STATUS } from './progress-reader.js';

const APP_CONFIG = Object.freeze({
  fluentflow: {
    name: 'FluentFlow',
    eyebrow: 'Ruta estructurada',
    description: 'Ruta A1–C2 con módulos secuenciales y práctica guiada.',
    unit: 'módulos',
    color: 'purple',
    url: 'https://genilsuarez.github.io/fluentflow/'
  },
  hubflow: {
    name: 'HubFlow',
    eyebrow: 'Práctica temática',
    description: '5 modos por ejercicio incluyendo Battle 2P.',
    unit: 'contenidos',
    color: 'amber',
    url: 'https://genilsuarez.github.io/hubflow/'
  },
  lyricflow: {
    name: 'LyricFlow',
    eyebrow: 'Aprendizaje con música',
    description: 'Entrena escucha y comprensión con canciones y actividades.',
    unit: 'canciones',
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

function rounded(value) {
  return Math.round(value);
}

function appMetric(result, config) {
  if (hasValidProgress(result)) {
    const summary = result.progress.data.summary;
    return `${summary.completedContent} de ${summary.totalContent} ${config.unit}`;
  }
  if (result.progress.status === STATUS.UNAVAILABLE) return `0 ${config.unit} completados`;
  return STATUS_COPY[result.progress.status];
}

function progressLabel(result) {
  if (hasValidProgress(result)) return `${rounded(result.progress.data.summary.progressPct)}%`;
  if (result.progress.status === STATUS.UNAVAILABLE) return '0%';
  return '—';
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

function renderModuleCards() {
  const container = document.getElementById('summaryModules');
  container.replaceChildren();

  APPS.forEach((app) => {
    const config = APP_CONFIG[app];
    const result = getAppResult(app);
    const card = element('article', `module-card module-card--${config.color}`);

    const heading = element('div', 'module-card__heading');
    const mark = element('span', 'module-card__mark', config.name.charAt(0));
    mark.setAttribute('aria-hidden', 'true');
    const titleBox = element('div');
    titleBox.append(element('p', 'section-kicker', config.eyebrow), element('h3', '', config.name));
    heading.append(mark, titleBox);

    const value = element('strong', 'module-card__value', progressLabel(result));
    const metric = element('p', 'module-card__metric', appMetric(result, config));
    const progressValue = hasValidProgress(result) ? rounded(result.progress.data.summary.progressPct) : 0;
    const progress = createProgressBar(progressValue, `Progreso de ${config.name}`);

    const footer = element('div', 'module-card__footer');
    footer.append(createStatusPill(result.progress.status));
    const detail = element('button', 'text-action', 'Detalle');
    detail.type = 'button';
    detail.dataset.view = app;
    appendArrow(detail);
    footer.append(detail);

    card.append(heading, value, metric, progress, footer);
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
    const average = validResults.reduce((total, result) => total + result.progress.data.summary.progressPct, 0) / APPS.length;
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
    const average = validResults.reduce((total, result) => total + result.progress.data.summary.progressPct, 0) / validResults.length;
    const displayValue = rounded(average);
    value.textContent = `${displayValue}%`;
    unit.textContent = `${validResults.length}/3`;
    ring.style.setProperty('--progress', String(displayValue));
    ring.setAttribute('aria-label', `Progreso parcial ${displayValue} por ciento`);
  } else {
    value.textContent = '—';
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
    ? validResults.reduce((total, result) => total + result.progress.data.summary.progressPct, 0) / validResults.length
    : 0;
  completedEl.textContent = String(totalCompleted);
  pctEl.textContent = `${rounded(average)}%`;
}

function renderCefr() {
  const level = document.getElementById('cefrLevel');
  const description = document.getElementById('cefrDescription');
  if (!level || !description) return;
  const cefr = hasValidProgress(fluentflow) ? fluentflow.progress.data.cefr : null;

  if (!cefr) {
    level.textContent = '—';
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

function allValidEvents() {
  return appData.flatMap((result) => result.activity.status === STATUS.READY ? result.activity.data.events.slice(0, 3) : [])
    .sort((first, second) => new Date(second.occurredAt) - new Date(first.occurredAt));
}

function formatDate(isoDate) {
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(isoDate));
}

function readableActivity(activity) {
  return activity.replaceAll('_', ' ').replaceAll('-', ' ');
}

function createActivityItem(event) {
  const config = APP_CONFIG[event.app];
  const item = element('article', 'activity-item');
  const marker = element('span', `activity-item__marker activity-item__marker--${config.color}`);
  marker.textContent = config.name.charAt(0);
  marker.setAttribute('aria-hidden', 'true');

  const body = element('div', 'activity-item__body');
  const appName = element('span', 'activity-item__app', config.name);
  const title = element('h3', '', event.title);
  const detailParts = [readableActivity(event.activity)];
  if (event.scorePct !== null) detailParts.push(`${rounded(event.scorePct)}%`);
  if (event.passed !== null) detailParts.push(event.passed ? 'superado' : 'por repetir');
  body.append(appName, title, element('p', '', detailParts.join(' · ')));

  const time = element('time', 'activity-item__time', formatDate(event.occurredAt));
  time.dateTime = event.occurredAt;
  item.append(marker, body, time);
  return item;
}

function createEmptyState(title, description) {
  const state = element('div', 'empty-state');
  const icon = element('span', 'empty-state__icon', '◇');
  icon.setAttribute('aria-hidden', 'true');
  state.append(icon, element('h3', '', title), element('p', '', description));
  return state;
}

function renderActivityList(container, events, limit) {
  container.replaceChildren();
  const visible = typeof limit === 'number' ? events.slice(0, limit) : events;
  if (visible.length === 0) {
    container.append(createEmptyState('Todavía no hay actividad reciente', 'LearnFlow no inventa ejemplos: aparecerán aquí los eventos válidos publicados por tus módulos.'));
    return;
  }
  visible.forEach((event) => container.append(createActivityItem(event)));
}

function renderActivity() {
  const events = allValidEvents();
  renderActivityList(document.getElementById('recentActivity'), events, 3);
  const filtered = activityFilter === 'all' ? events : events.filter((event) => event.app === activityFilter);
  renderActivityList(document.getElementById('allActivity'), filtered);
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
      card.append(element('p', 'continue-card__label', 'Último contenido válido'), element('h3', '', last.title));
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

function renderModuleDetail(app) {
  const config = APP_CONFIG[app];
  const result = getAppResult(app);
  const container = document.querySelector(`[data-app-detail="${app}"]`);
  container.replaceChildren();

  const actionBar = element('div', `module-detail__action module-detail__action--${config.color}`);
  const desc = Array.isArray(config.description)
    ? (() => { const d = document.createDocumentFragment(); config.description.forEach(line => d.append(element('p', '', line))); return d; })()
    : element('p', '', config.description);
  actionBar.append(desc, createAppLink(app, `Abrir ${config.name}`, true));

  const statsSection = element('section', 'section-block');
  const statsHeading = element('div', 'section-heading');
  const statsTitle = element('h2', '');
  statsTitle.append(element('span', 'section-kicker', 'En números'), document.createTextNode(' Métricas'));
  statsHeading.append(statsTitle);
  statsSection.append(statsHeading);

  const stats = element('div', 'detail-stats');
  const progressStat = element('article', 'detail-stat');
  progressStat.append(element('span', '', 'Progreso'), element('strong', '', progressLabel(result)), createStatusPill(result.progress.status));
  const contentStat = element('article', 'detail-stat');
  contentStat.append(element('span', '', 'Completado'), element('strong', '', hasValidProgress(result) ? `${result.progress.data.summary.completedContent} / ${result.progress.data.summary.totalContent}` : '—'), element('p', '', config.unit));
  const attemptedStat = element('article', 'detail-stat');
  attemptedStat.append(element('span', '', 'Iniciado'), element('strong', '', hasValidProgress(result) ? String(result.progress.data.summary.attemptedContent) : '—'), element('p', '', `de ${hasValidProgress(result) ? result.progress.data.summary.totalContent : '—'} ${config.unit}`));
  stats.append(progressStat, contentStat, attemptedStat);
  statsSection.append(stats);

  const insight = element('section', 'detail-insight');
  insight.append(element('p', 'section-kicker', app === 'fluentflow' ? 'Lectura CEFR' : app === 'hubflow' ? 'Práctica temática' : 'Progreso por canción'));
  if (app === 'fluentflow') {
    const cefr = hasValidProgress(result) ? result.progress.data.cefr : null;
    insight.append(element('h2', '', cefr ? `Ruta ${cefr.level}` : 'Ruta CEFR no disponible'), element('p', '', cefr ? `${cefr.completedModules} de ${cefr.totalModules} módulos del nivel completados.` : 'Sin datos de nivel desde FluentFlow.'));
  } else if (app === 'hubflow') {
    insight.append(element('h2', '', 'Cada contenido conserva su propia regla'), element('p', '', 'Proyección publicada por HubFlow; sin interpretación de prefijos o scores internos.'));
  } else {
    const summary = hasValidProgress(result) ? result.progress.data.summary : null;
    const activityText = summary && summary.completedActivities !== null && summary.totalActivities !== null
      ? `${summary.completedActivities} de ${summary.totalActivities} actividades completadas.`
      : 'Desglose disponible cuando LyricFlow lo publique.';
    insight.append(element('h2', '', 'Canciones como unidad'), element('p', '', activityText));
  }

  const activity = element('section', 'section-block');
  activity.append(element('div', 'section-heading'));
  const heading = activity.firstElementChild;
  const headingText = element('div');
  headingText.append(element('span', 'section-kicker', 'Desde este módulo'), element('h2', '', 'Actividad reciente'));
  heading.append(headingText);
  const list = element('div', 'activity-list');
  const events = result.activity.status === STATUS.READY ? [...result.activity.data.events].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)) : [];
  renderActivityList(list, events, 3);
  activity.append(list);

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
    bannerTitle.textContent = last.title || `Continuar en ${config.name}`;
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
    link.href = isUnifiedLocal ? `/${app}/` : isLocal ? `http://${host}:${localPorts[app]}/` : APP_CONFIG[app].url;
    if (isLocal) link.removeAttribute('rel');
    else link.rel = 'noopener';
  });
}

function renderAll() {
  appData = reader.readAll();
  renderGlobalProgress();
  renderHeaderStats();
  renderCefr();
  renderModuleCards();
  renderContinue();
  APPS.forEach(renderModuleDetail);
  renderActivity();
  renderDataHealth();
  renderPrimaryContinue();
  prepareAppLinks();
}

const NAVIGATION_MODE_KEY = 'lp-navigation-mode';
const NAVIGATION_MODES = new Set(['sidebar', 'floating']);

function setSidebarOpen(open) {
  const sidebar = document.getElementById('sidebar');
  const scrim = document.getElementById('sidebarScrim');
  const toggles = [document.getElementById('menuToggle'), document.getElementById('topbarMenuToggle'), document.getElementById('navigationLauncher')].filter(Boolean);
  sidebar.classList.toggle('is-open', open);
  scrim.hidden = !open;
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
        <div>
          <p class="about-eyebrow">LearnFlow · Plataforma</p>
          <h2 id="aboutLearnFlowTitle">About LearnFlow</h2>
        </div>
        <button class="about-close" id="aboutCloseBtn" type="button" aria-label="Cerrar About LearnFlow">✕</button>
      </header>
      <p id="aboutLearnFlowDescription" class="about-description">Una plataforma para aprender idiomas con estructura, práctica y música.</p>
      <nav class="about-modules" aria-label="Aplicaciones de LearnFlow">
        <a href="${getAppHref('/deskflow/', 3000)}" data-app-link="deskflow"><strong>LearnFlow</strong><span>Portal</span></a>
        <a href="${getAppHref('/fluentflow/', 3001)}" data-app-link="fluentflow"><strong>FluentFlow</strong><span>Ruta de inglés por niveles CEFR</span></a>
        <a href="${getAppHref('/hubflow/', 3002)}" data-app-link="hubflow"><strong>HubFlow</strong><span>Práctica flexible de gramática</span></a>
        <a href="${getAppHref('/lyricflow/', 3003)}" data-app-link="lyricflow"><strong>LyricFlow</strong><span>Aprender con música</span></a>
      </nav>
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
  menuToggles.forEach((toggle) => toggle.addEventListener('click', () => {
    setSidebarOpen(!sidebar.classList.contains('is-open'));
  }));
  scrim.addEventListener('click', closeSidebar);
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
      const icon = toggle.querySelector('span[aria-hidden]');
      const label = toggle.querySelector('.theme-toggle__label');
      if (icon) icon.textContent = isDark ? '☀️' : '🌙';
      if (label) label.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
      toggle.setAttribute('aria-label', isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
    });
    document.querySelector('meta[name="theme-color"]').content = isDark ? '#1a1714' : '#faf7f2';
  };

  toggles.forEach((toggle) => toggle.addEventListener('click', () => {
    document.documentElement.classList.add('theme-transitioning');
    const newTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    if (newTheme === 'dark') document.documentElement.dataset.theme = 'dark';
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('lp-theme', newTheme);
    update();
    window.setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350);
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
    if (icon) icon.textContent = '👤';
    if (label) label.textContent = user.name;
    btn.setAttribute('aria-label', user.name + ' — perfil');
  } else {
    if (icon) icon.textContent = '👤';
    if (label) label.textContent = 'Iniciar Sesión';
    btn.setAttribute('aria-label', 'Iniciar sesión');
  }
}

function setupPageContext() {
  const now = new Date();
  document.getElementById('currentDate').textContent = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
}

setupPageContext();
setupTheme();
setupNavigationMode();
setupNavigation();
setupActivityFilters();
renderAll();

if (new URLSearchParams(location.search).has('debug')) {
  document.getElementById('dataHealth').hidden = false;
}
document.getElementById('refreshData').addEventListener('click', renderAll);
window.addEventListener('storage', (event) => {
  if (event.key === NAVIGATION_MODE_KEY) {
    setNavigationMode(NAVIGATION_MODES.has(event.newValue) ? event.newValue : 'sidebar');
    return;
  }
  if (/^learnflow:(progress|activity):(fluentflow|hubflow|lyricflow):v[12]$/.test(event.key || '')) renderAll();
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
