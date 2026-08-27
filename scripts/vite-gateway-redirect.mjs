/**
 * Vite dev plugin — redirect direct visits to internal upstream ports
 * (3001, 3100, …) to the public gateway at localhost:3000/<app>/.
 * Skips proxied requests (gateway sets x-forwarded-host).
 */
export function gatewayRedirectPlugin({ app, publicPort = 3000 } = {}) {
  if (!app) throw new Error('gatewayRedirectPlugin requires { app }');

  return {
    name: 'learn-platform-gateway-redirect',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.headers['x-forwarded-host']) return next();

        const host = req.headers.host || '';
        const port = host.includes(':') ? host.split(':').pop() : '';
        if (!port || port === String(publicPort)) return next();

        const hostname = host.split(':')[0] || 'localhost';
        const suffix = req.url || '/';
        const location = `http://${hostname}:${publicPort}/${app}${suffix.startsWith('/') ? suffix : '/' + suffix}`;

        res.writeHead(308, { Location: location, 'Cache-Control': 'no-store' });
        res.end();
      });
    },
  };
}
