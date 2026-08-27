// DeskFlow — dev server config (learnctl/gateway) + production build pipeline.
// Ships to GitHub Pages via CD Deploy, which runs `npm run build` and
// publishes dist/ (see .github/workflows/cd-deploy.yml).
// Truly-static pass-through files (manifest.json, icons, robots.txt,
// sitemap.xml, 404.html, privacy.html, lp-theme.js…) live in public/ — Vite
// copies that dir to dist/ verbatim and leaves any HTML reference to it
// untouched (no hashing), which matters for manifest.json: its icon paths
// are plain JSON strings Vite can't rewrite, so the referenced icons must
// stay at the exact same relative location as the manifest itself.
// lp-theme.js also needs to stay unbundled/unhashed: it's the one script
// that must run synchronously, before first paint, to avoid a theme flash —
// bundling it into main.js would defer it like everything else.
import { gatewayRedirectPlugin } from './scripts/vite-gateway-redirect.mjs';
import { stripDevSourcemapPlugin } from './scripts/vite-strip-dev-sourcemap.mjs';

export default {
  // GitHub Pages serves this repo at /deskflow/ — CD Deploy sets
  // VITE_APP_BASE_URL; local ad-hoc builds default to root.
  base: process.env.VITE_APP_BASE_URL || '/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: true,
    cssMinify: 'esbuild',
    minify: 'esbuild',
    target: 'es2018',
  },
  server: {
    headers: {
      // Avoid Cache-Control: no-store — it disables bfcache, so history.back()
      // from exercises always cold-reloads the dashboard in local dev.
      // max-age=0 + must-revalidate still prevents stale JS after restarts.
      'Cache-Control': 'max-age=0, must-revalidate',
    },
  },
  plugins: [
    gatewayRedirectPlugin({ app: 'deskflow' }),
    noCachePlugin(),
    fullReloadPlugin(),
    stripDevSourcemapPlugin(),
  ],
};

function noCachePlugin() {
  return {
    name: 'no-cache-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((_req, res, next) => {
        const origSetHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) => {
          if (/^(etag|last-modified)$/i.test(name)) return res;
          if (/^cache-control$/i.test(name)) {
            return origSetHeader(name, 'max-age=0, must-revalidate');
          }
          return origSetHeader(name, value);
        };
        next();
      });
    },
  };
}

function fullReloadPlugin() {
  return {
    name: 'full-reload-js',
    apply: 'serve',
    handleHotUpdate({ file, server }) {
      if (file.endsWith('.js') || file.endsWith('.html')) {
        server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}
