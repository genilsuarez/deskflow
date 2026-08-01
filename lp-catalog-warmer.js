// Warms learnflow:catalog:<app>:v1 directly from each app's own catalog
// source when it's missing — e.g. a device that has logged out (guest reset
// wipes learnflow:progress:*/learnflow:activity:*, but the catalog key
// survives that) yet has never opened FluentFlow/HubFlow/LyricFlow directly
// on this browser, so that app never got the chance to stamp its own
// catalog key. Same-origin fetch/import, no auth required — catalog size is
// public. Only writes when the key is absent; never overrides an app's own
// fresher publish.

const CATALOG_SOURCES = Object.freeze({
  fluentflow: { kind: 'json', url: '/fluentflow/data/learningModules.json' },
  hubflow: { kind: 'module', url: '/hubflow/data/catalog.js', exportName: 'MODULES' },
  lyricflow: { kind: 'module', url: '/lyricflow/songs/picker-data.js', exportName: 'default' },
});

function catalogKeyFor(app) {
  return `learnflow:catalog:${app}:v1`;
}

function hasCatalogTotal(app) {
  try {
    const raw = localStorage.getItem(catalogKeyFor(app));
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Number.isInteger(parsed?.totalContent) && parsed.totalContent > 0;
  } catch {
    return false;
  }
}

async function fetchCatalogTotal(source) {
  if (source.kind === 'json') {
    const res = await fetch(source.url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data.length : null;
  }
  const mod = await import(/* @vite-ignore */ source.url);
  const list = source.exportName === 'default' ? mod.default : mod[source.exportName];
  return Array.isArray(list) ? list.length : null;
}

async function warmCatalogTotal(app) {
  if (hasCatalogTotal(app)) return false;
  const source = CATALOG_SOURCES[app];
  if (!source) return false;
  try {
    const total = await fetchCatalogTotal(source);
    if (!Number.isInteger(total) || total <= 0) return false;
    localStorage.setItem(
      catalogKeyFor(app),
      JSON.stringify({ totalContent: total, updatedAt: new Date().toISOString() })
    );
    return true;
  } catch {
    return false;
  }
}

export async function warmAllCatalogTotals() {
  const changed = await Promise.all(Object.keys(CATALOG_SOURCES).map(warmCatalogTotal));
  return changed.some(Boolean);
}
