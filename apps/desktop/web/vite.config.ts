import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** The same strict Content-Security-Policy as the desktop app, for the production web app. */
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "font-src 'self'",
    "manifest-src 'self'",
    // The web app only talks to the server it was loaded from.
    "connect-src 'self' wss: ws:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    name: 'cellmate-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

// `npm run web`: the UI in a normal browser at http://localhost:5300 (dev).
// `npm run build:web`: the web app (iPhone: Safari > Add to Home Screen), served by the server at /app/.
export default defineConfig({
  root: __dirname,
  base: '/app/',
  plugins: [react(), cspPlugin()],
  server: { port: 5300, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});