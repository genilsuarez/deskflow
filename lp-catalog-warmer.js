// Warms learnflow:catalog:<app>:v1 directly from each app's own catalog
// source when it's missing or incomplete — e.g. a device that has logged out
// (guest reset wipes learnflow:progress:*/learnflow:activity:*, but the
// catalog key survives that) yet has never opened FluentFlow/HubFlow/LyricFlow
// directly on this browser, so that app never got the chance to stamp its own
// catalog key (total + id list). Same-origin fetch/import, no auth required —
// catalog contents are public. Only writes when the key is missing totalContent
// or ids; never overrides an app's own fresher publish.

const CATALOG_SOURCES = Object.freeze({
  fluentflow: { kind: 'json', url: '/fluentflow/data/learningModules.json' },
  hubflow: { kind: 'module', url: '/hubflow/data/catalog.js', exportName: 'MODULES' },
  lyricflow: { kind: 'module', url: '/lyricflow/songs/picker-data.js', exportName: 'default' },
});

function catalogKeyFor(app) {
  return `learnflow:catalog:${app}:v1`;
}

// ids además de totalContent: recomputeProgressDocumentSummary() (lp-progress-summary.js)
// los usa para podar content_ids huérfanos que el cloud-merge de Supabase une sin
// podar. Una clave con solo totalContent (de una versión previa de este warmer)
// también cuenta como "necesita warm" para adquirir ids sin esperar a que el
// usuario abra esa app directamente.
function needsWarm(app) {
  try {
    const raw = localStorage.getItem(catalogKeyFor(app));
    if (!raw) return true;
    const parsed = JSON.parse(raw);
    const hasTotal = Number.isInteger(parsed?.totalContent) && parsed.totalContent > 0;
    const hasIds = Array.isArray(parsed?.ids) && parsed.ids.length > 0;
    return !hasTotal || !hasIds;
  } catch {
    return true;
  }
}

async function fetchCatalogInfo(source) {
  let list;
  if (source.kind === 'json') {
    // cache: 'default' — los catálogos cambian rara vez y GitHub Pages sirve
    // ETag/Last-Modified, así que un 304 evita re-descargarlos. needsWarm() ya
    // corta la mayoría de visitas antes de llegar aquí.
    const res = await fetch(source.url, { cache: 'default' });
    if (!res.ok) return null;
    list = await res.json();
  } else {
    const mod = await import(/* @vite-ignore */ source.url);
    list = source.exportName === 'default' ? mod.default : mod[source.exportName];
  }
  if (!Array.isArray(list)) return null;
  const ids = list.map((item) => item?.id).filter((id) => typeof id === 'string' && id.length > 0);
  return { total: list.length, ids };
}

async function warmCatalogTotal(app) {
  if (!needsWarm(app)) return false;
  const source = CATALOG_SOURCES[app];
  if (!source) return false;
  try {
    const info = await fetchCatalogInfo(source);
    if (!info || !Number.isInteger(info.total) || info.total <= 0 || info.ids.length === 0) return false;
    localStorage.setItem(
      catalogKeyFor(app),
      JSON.stringify({ totalContent: info.total, ids: info.ids, updatedAt: new Date().toISOString() })
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
