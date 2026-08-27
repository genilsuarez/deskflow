/**
 * Vite dev plugin — strip the inline base64 sourcemap Vite appends to every
 * .js response in dev mode.
 *
 * DeskFlow/HubFlow/LyricFlow have no build step: these plain scripts pass
 * through Vite's dev transform untouched (content in === content out), so
 * the sourcemap maps the file to itself — pure dead weight. Combined with
 * fullReloadPlugin (which forces a full page reload on any .js/.html change
 * instead of patching modules), the inline map is never actually consulted
 * by the browser either way.
 *
 * A `transform` hook returning `map: null` doesn't suppress this — Vite's
 * core transform pipeline stitches its own sourcemap for the request
 * independently of what plugin transform hooks return. So this strips the
 * comment at the raw HTTP response level instead — the `configureServer`
 * middleware is registered to run *after* Vite's own middlewares (via the
 * returned-function form) so it sees the final bytes Vite already wrote.
 *
 * Effect measured on DeskFlow's lp-login.js: 216KB served → 39KB (matches
 * the file on disk exactly). Repeated across ~15 scripts per page, this was
 * a meaningful chunk of local dev load time — not present in production
 * (GitHub Pages serves the raw static file, no Vite involved).
 *
 * Middleware order matters here: Vite's own transform middleware calls
 * `res.end()` directly and never calls `next()`, so a middleware registered
 * to run *after* it (the `configureServer` returned-function pattern) is
 * simply never reached — the chain short-circuits before getting there.
 * Instead this registers early (plain `configureServer`, no returned
 * function) and patches `res.write`/`res.end` on the response object itself,
 * then calls `next()` — so whichever later middleware (Vite's) eventually
 * calls `res.write`/`res.end`, it's calling the patched version.
 */
const SOURCEMAP_COMMENT_RE = /\n?\/\/# sourceMappingURL=data:application\/json;base64,[A-Za-z0-9+/=]+\s*$/;

export function stripDevSourcemapPlugin() {
  return {
    name: 'strip-dev-sourcemap',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url || '').split('?')[0];
        if (!path.endsWith('.js')) return next();

        const chunks = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);

        res.write = (chunk) => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return true;
        };
        res.end = (chunk) => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          const body = Buffer.concat(chunks).toString('utf8');
          const stripped = body.replace(SOURCEMAP_COMMENT_RE, '');
          if (stripped !== body) res.removeHeader('Content-Length');
          origWrite(stripped);
          return origEnd();
        };
        next();
      });
    },
  };
}
