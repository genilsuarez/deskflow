/**
 * Reporte de errores no capturados (scripts/lp-analytics.js → evento GA4 `exception`).
 * Ejecuta el script canónico en un vm con window/document falsos y comprueba:
 * se reporta, se sanea (sin dominio ni query), se deduplica, tiene tope y el
 * ruido conocido se ignora. Copia idéntica en cada app vía copy-shared.sh.
 */
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Cada app tiene su copia de lp-analytics.js en un sitio distinto; el canónico
// está junto a este archivo. Se prueba la primera que exista.
const CANDIDATES = ['./lp-analytics.js', '../lp-analytics.js', '../js/lp-analytics.js', '../public/lp-analytics.js'];
const found = CANDIDATES.map((c) => fileURLToPath(new URL(c, import.meta.url))).find((f) => existsSync(f));
if (!found) {
  console.error('✗ no se encontró lp-analytics.js');
  process.exit(1);
}
const src = readFileSync(found, 'utf8');

function load() {
  const listeners = {};
  const window = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
  };
  window.dataLayer = [];
  const ctx = {
    window,
    document: { createElement: () => ({}), head: { appendChild() {} } },
    localStorage: { getItem: () => null },
    console: { warn() {} },
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  // gtag empuja `arguments` a dataLayer; los eventos son los que empiezan por 'event'.
  const eventsNow = () => window.dataLayer.map((a) => [...a]).filter((a) => a[0] === 'event' && a[1] === 'exception').map((a) => a[2]);
  const fire = (type, ev) => (listeners[type] || []).forEach((fn) => fn(ev));
  return { window, fire, eventsNow };
}

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) return;
  failed++;
  console.error(`✗ ${name} ${detail}`);
}


{
  const { fire, eventsNow } = load();
  fire('error', { message: 'boom', filename: 'https://x.github.io/app/js/a.js?v=1#h', lineno: 7 });
  const [e] = eventsNow();
  check('reporta error', !!e);
  check('saneado: sin dominio ni query', e && e.description === 'boom @ /app/js/a.js:7', JSON.stringify(e));
  check('fatal en error', e && e.fatal === true);
}
{
  const { fire, eventsNow } = load();
  fire('error', { message: 'x', filename: 'a.js', lineno: 1 });
  fire('error', { message: 'x', filename: 'a.js', lineno: 1 });
  check('deduplica el mismo error', eventsNow().length === 1);
  for (let i = 0; i < 20; i++) fire('error', { message: 'distinto ' + i, filename: 'a.js', lineno: i });
  check('tope de 5 por carga', eventsNow().length === 5, String(eventsNow().length));
}
{
  const { fire, eventsNow } = load();
  fire('error', { message: 'Script error.', filename: '', lineno: 0 });
  fire('error', { message: 'ResizeObserver loop completed with undelivered notifications.', filename: 'a.js', lineno: 1 });
  fire('error', { message: 'boom', filename: 'chrome-extension://abc/x.js', lineno: 1 });
  fire('error', { message: '', filename: 'img.png', lineno: 0 });
  check('ignora ruido conocido y errores de recurso', eventsNow().length === 0, JSON.stringify(eventsNow()));
}
{
  const { fire, eventsNow } = load();
  fire('unhandledrejection', { reason: new Error('sync roto') });
  fire('unhandledrejection', { reason: 'texto plano' });
  const ev = eventsNow();
  check('reporta promesas rechazadas', ev.length === 2 && ev[0].description === 'unhandledrejection: sync roto' && ev[0].fatal === false, JSON.stringify(ev));
  const { fire: f2, eventsNow: e2 } = load();
  f2('error', { message: 'a'.repeat(300), filename: '', lineno: 0 });
  check('descripción ≤ 100 chars (límite GA4)', e2()[0].description.length === 100);
}

if (failed) process.exit(1);
console.log('✅ Reporte de errores (lp-analytics) — OK');
