/**
 * Markdown → HTML rendering pipeline
 * Based on the unified/remark/rehype architecture from markdown-viewer-extension
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import rehypeExternalLinks from 'rehype-external-links';

/**
 * Render markdown string to HTML fragment (no document wrapper)
 */
export async function renderToHtml(md, options = {}) {
  const { math = true, highlight = true } = options;

  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype);

  if (math) {
    pipeline.use(rehypeKatex, { output: 'html' });
  }

  if (highlight) {
    pipeline.use(rehypeHighlight);
  }

  pipeline
    .use(rehypeSlug)
    .use(rehypeExternalLinks, { target: '_blank', rel: ['nofollow'] })
    .use(rehypeStringify);

  const result = await pipeline.process(md);
  return String(result);
}

/**
 * Render markdown string to full HTML document with styling
 */
export async function renderToDocument(md, options = {}) {
  const { title } = options;

  const bodyHtml = await renderToHtml(md, options);
  const css = getDefaultCSS();

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Markdown Preview'}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github-dark.min.css">
  <style>${css}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Get the CSS for styling rendered markdown
 */
export function getDefaultCSS() {
  return `
/* Markdown Viewer CLI - Theme */
:root {
  --bg: #0d1117;
  --fg: #c9d1d9;
  --border: #30363d;
  --accent: #58a6ff;
  --code-bg: #161b22;
  --table-stripe: #161b22;
  --blockquote-fg: #8b949e;
}

* { box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  line-height: 1.6;
  color: var(--fg);
  background: var(--bg);
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem;
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
  color: #f0f6fc;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  line-height: 1.25;
}
h1 { font-size: 2em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }

p { margin: 1em 0; }

a {
  color: var(--accent);
  text-decoration: none;
}
a:hover { text-decoration: underline; }

/* Lists */
ul, ol { padding-left: 2em; }
li { margin: 0.25em 0; }
li input[type="checkbox"] { margin-right: 0.5em; }

/* Code */
code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.85em;
  background: var(--code-bg);
  padding: 0.2em 0.4em;
  border-radius: 4px;
}

pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1rem;
  overflow-x: auto;
}
pre code {
  background: transparent;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.5;
}

/* Tables */
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}
th, td {
  border: 1px solid var(--border);
  padding: 8px 12px;
  text-align: left;
}
th {
  background: var(--code-bg);
  font-weight: 600;
}
tr:nth-child(even) { background: var(--table-stripe); }

/* Blockquote */
blockquote {
  border-left: 4px solid var(--accent);
  color: var(--blockquote-fg);
  margin: 1em 0;
  padding: 0.5em 1em;
  background: rgba(88, 166, 255, 0.05);
}

/* Horizontal rule */
hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 2em 0;
}

/* Images */
img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

/* KaTeX */
.katex-display { margin: 1em 0; }

/* Task lists */
ul.contains-task-list { list-style-type: none; padding-left: 0; }
.task-list-item { margin: 0.25em 0; }
`;
}
