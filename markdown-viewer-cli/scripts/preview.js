/**
 * Live preview HTTP server
 * Serves rendered markdown with auto-refresh via WebSocket or polling
 */
import { createServer } from 'http';
import { readFileSync, watch } from 'fs';
import { resolve } from 'path';
import { renderToHtml, getDefaultCSS } from './render.js';

const TEMPLATE = (title, body, css, script) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <style>${css}</style>
  <style>
    .reload-bar {
      position: fixed; bottom: 0; left: 0; right: 0;
      background: #2563eb; color: white; text-align: center;
      padding: 4px; font-size: 12px; opacity: 0; transition: opacity 0.3s;
      z-index: 9999;
    }
    .reload-bar.show { opacity: 1; }
  </style>
</head>
<body>
${body}
<div class="reload-bar" id="reloadBar">🔄 File changed — reloading…</div>
${script}
</body>
</html>`;

const AUTO_REFRESH_SCRIPT = `
<script>
  let lastContent = '';
  setInterval(async () => {
    try {
      const res = await fetch('/__raw__');
      const text = await res.text();
      if (text !== lastContent) {
        if (lastContent) {
          document.getElementById('reloadBar').classList.add('show');
          setTimeout(() => location.reload(), 200);
        }
        lastContent = text;
      }
    } catch {}
  }, 1000);
</script>
`;

/**
 * Start a live preview server for a markdown file
 */
export async function startPreview(filePath, options = {}) {
  const { port = 8899, open = false, theme = 'default' } = options;
  const absPath = resolve(filePath);

  const css = getDefaultCSS();

  const server = createServer(async (req, res) => {
    // Raw content endpoint for polling
    if (req.url === '/__raw__') {
      try {
        const md = readFileSync(absPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(md);
      } catch (err) {
        res.writeHead(500);
        res.end('Error reading file');
      }
      return;
    }

    // Main page
    try {
      const md = readFileSync(absPath, 'utf-8');
      const body = await renderToHtml(md);
      const title = filePath.split('/').pop();
      const html = TEMPLATE(title, body, css, AUTO_REFRESH_SCRIPT);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(TEMPLATE('Error', `<pre style="color:red">${err.message}</pre>`, css, ''));
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  📖  Preview: ${url}`);
    console.log(`  📄  File: ${absPath}`);
    console.log(`  🔄  Auto-refresh enabled (polling every 1s)`);
    console.log(`  ⌃C  to stop\n`);

    if (open) {
      import('child_process').then(({ exec }) => {
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} ${url}`);
      }).catch(() => {});
    }
  });

  return server;
}
