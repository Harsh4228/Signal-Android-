import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/** Strict Content-Security-Policy in production builds (dev needs inline scripts for hot reload). */
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'none'",
    // pdf.js: web worker + WebAssembly image decoders. No 'unsafe-eval'.
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "font-src 'self'",
    // the user chooses their own server, so allow http(s)/ws(s) connections
    'connect-src http: https: ws: wss:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'meetme-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), cspPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
});
