/**
 * LP Completion Settings — panel de Ajustes → Configuración avanzada que
 * controla, para las 3 apps de contenido, el % de completitud del nivel CEFR
 * activo que exige la regla de avance (lp-completion-config.js, importado por
 * lp-progress-summary.js en las 4 apps). Mismo gate de acceso que
 * lp-fluentflow-settings.js: localhost o el email admin.
 *
 * DeskFlow-only: es el único lugar de la plataforma con esta UI; las demás
 * apps solo leen el umbral guardado.
 *
 *   lpCompletionSettings.updateSectionVisibility()
 *   lpCompletionSettings.open(event, options)
 */
import { DEFAULT_THRESHOLDS, getThresholds, setThresholds } from './lp-completion-config.js';
import { isAuthenticated, syncSettings, fetchSettings } from './lp-supabase.js';

const ADVANCED_EMAIL = 'genil.suarez@gmail.com';
const SCHEMA_VERSION = 1;

const APPS = [
  { app: 'fluentflow', label: 'FluentFlow' },
  { app: 'lyricflow', label: 'LyricFlow' },
  { app: 'hubflow', label: 'HubFlow' },
];

function canAccess() {
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.indexOf('192.168.') === 0) return true;
  const user = window.lpLogin && window.lpLogin.getUser && window.lpLogin.getUser();
  return !!(user && user.email && user.email.trim().toLowerCase() === ADVANCED_EMAIL);
}

function updateSectionVisibility() {
  const section = document.getElementById('settingsSectionCompletion');
  if (section) section.hidden = !canAccess();
}

function renderStepperRow(app, label, value) {
  return (
    `<div class="lp-cc-row" data-app="${app}">` +
    `<span class="lp-cc-row__label">${label}<span class="lp-cc-row__hint">Umbral para avanzar de nivel</span></span>` +
    '<div class="lp-cc-stepper">' +
    `<button type="button" class="lp-cc-stepper__btn" data-step="-5" aria-label="Reducir ${label}">−</button>` +
    `<span class="lp-cc-stepper__value">${value}%</span>` +
    `<button type="button" class="lp-cc-stepper__btn" data-step="5" aria-label="Aumentar ${label}">+</button>` +
    '</div></div>'
  );
}

function renderBody(thresholds) {
  return (
    '<div class="lp-cc-panel">' +
    APPS.map(({ app, label }) => renderStepperRow(app, label, thresholds[app])).join('') +
    '</div>'
  );
}

async function open(event, options = {}) {
  if (!canAccess()) return;

  document.getElementById('completionSettings')?.remove();
  const opener = event && event.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
  const inertTargets = options.inertElements || [];
  if (options.beforeOpen) options.beforeOpen();
  inertTargets.forEach((el) => { if (el) el.inert = true; });

  // Trae el último valor guardado en la nube antes de mostrar el form —
  // así un admin que edita desde dos dispositivos ve siempre el más reciente.
  try {
    if (await isAuthenticated()) {
      const remote = await fetchSettings('global');
      if (remote?.settings?.completionThresholds) {
        setThresholds(remote.settings.completionThresholds);
      }
    }
  } catch (e) {
    /* sin red o sin sesión — sigue con lo local */
  }

  // Estado en memoria: los steppers solo tocan `draft`. Nada se persiste
  // (localStorage ni Supabase) hasta pulsar "Guardar" — un click por
  // stepper ya no dispara una escritura + sync por cada tap.
  const saved = getThresholds();
  const draft = { ...saved };
  let dirty = false;

  const overlay = document.createElement('div');
  overlay.id = 'completionSettings';
  overlay.className = 'lp-settings-overlay';
  overlay.innerHTML =
    '<section class="lp-settings-modal" role="dialog" aria-modal="true" aria-labelledby="completionSettingsTitle">' +
    '<header class="lp-settings-header">' +
    '<h2 id="completionSettingsTitle">Configuración avanzada · Completitud</h2>' +
    '<button class="lp-settings-close" id="completionSettingsCloseBtn" type="button" aria-label="Cerrar sin guardar">✕</button>' +
    '</header>' +
    '<div class="lp-settings-body">' + renderBody(draft) + '</div>' +
    '<div class="lp-cc-actions">' +
    '<p class="lp-cc-status" id="completionSettingsStatus" aria-live="polite"></p>' +
    '<button type="button" class="lp-cc-save" id="completionSettingsSaveBtn" disabled>Guardar</button>' +
    '</div>' +
    '<footer class="lp-cc-footer">% del nivel CEFR activo que cada app debe alcanzar para que el nivel compartido avance.</footer>' +
    '</section>';
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    inertTargets.forEach((el) => { if (el) el.inert = false; });
    document.removeEventListener('keydown', onKeydown);
    if (options.onClose) options.onClose();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  }

  function onKeydown(keyEvent) {
    if (keyEvent.key === 'Escape') {
      keyEvent.preventDefault();
      close();
    }
  }

  const closeBtn = overlay.querySelector('#completionSettingsCloseBtn');
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (clickEvent) => {
    if (clickEvent.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown);

  const statusEl = overlay.querySelector('#completionSettingsStatus');
  const saveBtn = overlay.querySelector('#completionSettingsSaveBtn');

  function markDirty() {
    dirty = true;
    saveBtn.disabled = false;
    statusEl.textContent = 'Cambios sin guardar';
    statusEl.removeAttribute('data-state');
    closeBtn.setAttribute('aria-label', 'Descartar cambios y cerrar');
  }

  overlay.querySelectorAll('.lp-cc-row').forEach((row) => {
    const app = row.dataset.app;
    const valueEl = row.querySelector('.lp-cc-stepper__value');
    row.querySelectorAll('.lp-cc-stepper__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = Math.max(0, Math.min(100, draft[app] + Number(btn.dataset.step)));
        draft[app] = next;
        valueEl.textContent = `${next}%`;
        markDirty();
      });
    });
  });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    statusEl.textContent = 'Guardando…';
    const thresholds = setThresholds(draft);
    Object.assign(saved, thresholds);
    dirty = false;
    closeBtn.setAttribute('aria-label', 'Cerrar');

    if (!(await isAuthenticated())) {
      statusEl.textContent = 'Guardado en este dispositivo';
      statusEl.dataset.state = 'ok';
      return;
    }
    const result = await syncSettings('global', { completionThresholds: thresholds }, SCHEMA_VERSION);
    statusEl.textContent = result.synced ? 'Guardado y sincronizado con la nube' : 'Guardado en este dispositivo (no se pudo sincronizar)';
    statusEl.dataset.state = result.synced ? 'ok' : '';
  });

  closeBtn.focus();
}

function resetToDefaults() {
  return setThresholds(DEFAULT_THRESHOLDS);
}

window.lpCompletionSettings = { open, updateSectionVisibility, resetToDefaults };
export { open, updateSectionVisibility, resetToDefaults };
