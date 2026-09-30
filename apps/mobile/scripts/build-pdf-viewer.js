/**
 * Builds android/app/src/main/assets/pdfviewer.html: a fully offline, view-only PDF viewer.
 * pdf.js (library + worker) is inlined, so no network request is ever made and nothing is cached to disk.
 * The PDF bytes arrive from React Native via postMessage and are rendered to <canvas> in memory.
 *
 * Run after updating pdfjs-dist:   npm run build:pdfviewer
 */
const fs = require('fs');
const path = require('path');

const dist = path.dirname(require.resolve('pdfjs-dist/package.json'));
const lib = fs.readFileSync(path.join(dist, 'legacy/build/pdf.min.mjs'), 'utf8');
const worker = fs.readFileSync(path.join(dist, 'legacy/build/pdf.worker.min.mjs'), 'utf8');
const version = require('pdfjs-dist/package.json').version;

// Inline <script> content must not contain "</script". In JS, "<\/script" means the same thing.
const inline = (s) => s.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src blob: data:">
<style>
  html,body{margin:0;background:#f4f5f7;color:#667085;font:14px sans-serif;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
  #pages{display:flex;flex-direction:column;align-items:center;gap:10px;padding:10px 0}
  canvas{background:#fff;box-shadow:0 4px 12px rgba(16,24,40,.12);border-radius:4px;max-width:96vw;height:auto}
  #msg{text-align:center;padding:40px 16px}
</style>
</head>
<body>
<div id="msg">Opening…</div>
<div id="pages"></div>
<!-- pdf.js ${version} worker (text only, turned into a blob: worker below) -->
<script id="pdf-worker" type="text/plain">${inline(worker)}</script>
<!-- pdf.js ${version} library: sets globalThis.pdfjsLib -->
<script type="module">${inline(lib)}</script>
<script type="module">
  const post = (m) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m));
  const workerCode = document.getElementById('pdf-worker').textContent;
  const workerUrl = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function render(b64) {
    const msg = document.getElementById('msg');
    const pages = document.getElementById('pages');
    pages.innerHTML = '';
    try {
      const doc = await pdfjsLib.getDocument({ data: b64ToBytes(b64), enableXfa: false }).promise;
      msg.textContent = '';
      const dpr = window.devicePixelRatio || 1;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = (window.innerWidth * 0.96 / base.width) * dpr;
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = (viewport.width / dpr) + 'px';
        pages.appendChild(canvas);
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      }
      post({ type: 'done', pages: doc.numPages });
    } catch (e) {
      msg.textContent = 'Could not open this PDF.';
      post({ type: 'error', message: String(e && e.message || e) });
    }
  }

  const onMessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'load') render(m.data);
    } catch {}
  };
  window.addEventListener('message', onMessage);
  document.addEventListener('message', onMessage); // Android WebView delivers here
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  post({ type: 'ready' });
</script>
</body>
</html>
`;

const out = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'pdfviewer.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024 / 1024).toFixed(2)} MB, pdf.js ${version})`);
