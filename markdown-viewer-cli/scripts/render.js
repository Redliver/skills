/**
 * Markdown → HTML rendering pipeline
 * Based on markdown-viewer-extension's architecture
 *
 * Architecture:
 * - Unified/remark/rehype pipeline for markdown → HTML
 * - Diagram plugins render code blocks to inline base64 PNG images
 * - CSS matches extension's default theme
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
import { visit } from 'unist-util-visit';
import sharp from 'sharp';

// ============================================================================
// Diagram Renderers (same as convert.js)
// ============================================================================

/**
 * PlantUML DSL passes through as-is. 
 * The deprecated #color:activity; syntax works on all modern PlantUML servers
 * (Kroki v1.2026.1+, plantuml.com). No transformation needed.
 */
function fixPlantUMLSyntax(dsl) { return dsl; }

/**
 * Fix swimlane borders in Kroki SVG output.
 * Kroki's PlantUML renders swimlane area rects with stroke matching fill
 * (invisible borders) and omits top/bottom frame lines.
 */
function fixPlantUMLSVG(svg) {
  // 1. Make header rect border visible: stroke="#F5F5F5" -> "#999999"
  svg = svg.replace(
    /(<rect fill="#F5F5F5" height="[^"]*" style="stroke:)#F5F5F5(;stroke-width:[^"]*" width="[^"]*" x="[^"]*" y="[^"]*"\/>)/,
    '$1#999999$2'
  );
  // 2. Make swimlane area rect borders visible: stroke=fill -> stroke=fill but with visible color
  // Change stroke of colored swimlane rects from matching fill to a darker shade
  svg = svg.replace(
    /(<rect fill="#E8F5E9" height="[^"]*" style="stroke:)#E8F5E9(;stroke-width:[^"]*" width="[^"]*" x="[^"]*" y="[^"]*"\/>)/,
    '$1#A5D6A7$2'
  );
  svg = svg.replace(
    /(<rect fill="#E3F2FD" height="[^"]*" style="stroke:)#E3F2FD(;stroke-width:[^"]*" width="[^"]*" x="[^"]*" y="[^"]*"\/>)/,
    '$1#90CAF9$2'
  );
  svg = svg.replace(
    /(<rect fill="#FFF3E0" height="[^"]*" style="stroke:)#FFF3E0(;stroke-width:[^"]*" width="[^"]*" x="[^"]*" y="[^"]*"\/>)/,
    '$1#FFCC80$2'
  );
  svg = svg.replace(
    /(<rect fill="#FCE4EC" height="[^"]*" style="stroke:)#FCE4EC(;stroke-width:[^"]*" width="[^"]*" x="[^"]*" y="[^"]*"\/>)/,
    '$1#F48FB1$2'
  );
  // 3. Extract coordinates for border lines
  const lines = [...svg.matchAll(/<line style="stroke:#999999;stroke-width:1\.5;" x1="([^"]*)" x2="([^"]*)" y1="([^"]*)" y2="([^"]*)"/g)];
  if (lines.length >= 2) {
    const first = lines[0];
    const last = lines[lines.length - 1];
    const leftX = first[1];
    const rightX = last[1];
    const topY = first[3];
    const bottomY = last[4];
    // Top border line
    const topLine = `<line style="stroke:#999999;stroke-width:1.5;" x1="${leftX}" x2="${rightX}" y1="${topY}" y2="${topY}"/>`;
    // Bottom border line
    const bottomLine = `<line style="stroke:#999999;stroke-width:1.5;" x1="${leftX}" x2="${rightX}" y1="${bottomY}" y2="${bottomY}"/>`;
    svg = svg.replace('</g></svg>', `${topLine}${bottomLine}</g></svg>`);
  }
  // 4. Add separator line between header (lane names) and content (flow chart).
  //    The header rect bottom edge is at y + height. Parse it from the first rect.
  const headerMatch = svg.match(/<rect fill="#F5F5F5" height="([\d.]+)"[^>]* y="([\d.]+)"\/>/);
  if (headerMatch) {
    const sepY = String(parseFloat(headerMatch[1]) + parseFloat(headerMatch[2]));
    // Also extract the header width to find the right edge
    const widthMatch = svg.match(/<rect fill="#F5F5F5" height="[^"]*" style="[^"]*" width="([\d.]+)" x="([\d.]+)" y="[^"]*"\/>/);
    if (widthMatch) {
      const sepRight = String(parseFloat(widthMatch[1]) + parseFloat(widthMatch[2]));
      const sepLine = `<line style="stroke:#999999;stroke-width:1.5;" x1="${widthMatch[2]}" x2="${sepRight}" y1="${sepY}" y2="${sepY}"/>`;
      svg = svg.replace('</g></svg>', `${sepLine}</g></svg>`);
    }
  }
  return svg;
}

/**
 * PlantUML Renderer with server fallback
 */
async function renderPlantUML(dsl) {
  dsl = fixPlantUMLSyntax(dsl);
  try {
    const { textToDrawioXml } = await import('@markdown-viewer/draw-uml');
    const { convert } = await import('@markdown-viewer/drawio2svg');
    const drawioXml = await textToDrawioXml(dsl);
    return convert(drawioXml);
  } catch (error) {
    const response = await fetch('https://kroki.io/plantuml/svg', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: dsl,
    });
    if (!response.ok) throw new Error(`PlantUML server returned ${response.status}`);
    const svg = await response.text();
    return fixPlantUMLSVG(svg);
  }
}

/**
 * Mermaid Renderer
 */
async function renderMermaid(code) {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: 'default',
    themeVariables: {
      fontFamily: "'SimSun', 'Times New Roman', Times, serif",
      background: 'transparent',
    },
  });
  const diagramId = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  const { svg } = await mermaid.render(diagramId, code);
  return svg;
}

/**
 * Graphviz DOT Renderer
 */
async function renderDot(code) {
  const { instance } = await import('@viz-js/viz');
  const viz = await instance();
  const svgElement = viz.renderSVGElement(code, {
    graphAttributes: { bgcolor: 'transparent' },
  });
  return new XMLSerializer().serializeToString(svgElement);
}

/**
 * SVG-to-PNG conversion using sharp
 * Returns base64 data URI
 */
async function svgToDataUri(svgString, scale = 4.0) {
  if (!svgString.includes('xmlns=')) {
    svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  const svgBuffer = Buffer.from(svgString);
  const metadata = await sharp(svgBuffer).metadata();
  const width = Math.ceil((metadata.width || 800) * scale);
  const height = Math.ceil((metadata.height || 600) * scale);

  const pngBuffer = await sharp(svgBuffer)
    .resize(width, height, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  const base64 = pngBuffer.toString('base64');
  return `data:image/png;base64,${base64}`;
}

/**
 * Plugin registry
 */
const DIAGRAM_PLUGINS = {
  plantuml: {
    languages: ['plantuml', 'puml'],
    render: renderPlantUML,
  },
  mermaid: {
    languages: ['mermaid'],
    render: renderMermaid,
  },
  dot: {
    languages: ['dot', 'graphviz'],
    render: renderDot,
  },
};

function findDiagramPlugin(node) {
  if (node.type !== 'code' || !node.lang) return null;
  const lang = node.lang.toLowerCase();
  for (const [type, plugin] of Object.entries(DIAGRAM_PLUGINS)) {
    if (plugin.languages.includes(lang)) {
      return { type, ...plugin };
    }
  }
  return null;
}

// ============================================================================
// Remark Plugin for Diagram Rendering
// ============================================================================

function remarkDiagramRenderer() {
  return async (tree) => {
    const transformations = [];

    visit(tree, 'code', (node, index, parent) => {
      if (!parent || index === undefined) return;
      const plugin = findDiagramPlugin(node);
      if (!plugin) return;

      transformations.push(async () => {
        try {
          const svg = await plugin.render(node.value);
          const dataUri = await svgToDataUri(svg);

          parent.children[index] = {
            type: 'html',
            value: `<div class="diagram-block" data-plugin-type="${plugin.type}" data-plugin-rendered="true">
              <img src="${dataUri}" alt="${plugin.type} diagram" />
            </div>`,
          };
        } catch (error) {
          console.warn(`Diagram render failed for ${plugin.type}:`, error.message);
        }
      });
    });

    for (const transform of transformations) {
      await transform();
    }
  };
}

// ============================================================================
// HTML Rendering
// ============================================================================

export async function renderToHtml(md, options = {}) {
  const { math = true, highlight = true } = options;

  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkDiagramRenderer)
    .use(remarkRehype, { allowDangerousHtml: true });

  if (math) {
    pipeline.use(rehypeKatex, { output: 'html' });
  }

  if (highlight) {
    pipeline.use(rehypeHighlight);
  }

  pipeline
    .use(rehypeSlug)
    .use(rehypeExternalLinks, { target: '_blank', rel: ['nofollow'] })
    .use(rehypeStringify, { allowDangerousHtml: true });

  const result = await pipeline.process(md);
  return String(result);
}

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
<div id="markdown-page">
  <div id="markdown-content" class="table-layout-center">
${bodyHtml}
  </div>
</div>
</body>
</html>`;
}

/**
 * CSS matching extension's default theme
 */
export function getDefaultCSS() {
  return `
:root {
  --color-bg-body: #f5f5f5;
  --color-bg-surface: #ffffff;
  --color-primary: #1a73e8;
  --color-text-primary: #202124;
  --color-text-secondary: #5f6368;
  --color-border: #dadce0;
}

html, body {
  margin: 0;
  padding: 0;
  height: auto;
  min-height: 100%;
  overflow: auto;
  background-color: var(--color-bg-body);
}

#markdown-page {
  max-width: 1060px;
  margin: 0 auto;
}

#markdown-content {
  background: var(--color-bg-surface);
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.1);
  margin: 0 auto;
  padding: 40px;
  box-sizing: border-box;
}

#markdown-content h1, #markdown-content h2, #markdown-content h3,
#markdown-content h4, #markdown-content h5, #markdown-content h6 {
  scroll-margin-top: 12px;
  color: var(--color-text-primary);
  font-weight: 600;
  line-height: 1.25;
}

#markdown-content h1 {
  font-size: 2em;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.3em;
}

#markdown-content h2 {
  font-size: 1.5em;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.3em;
}

#markdown-content h3 { font-size: 1.25em; }
#markdown-content h4 { font-size: 1em; }

#markdown-content p {
  margin: 13px 0;
  color: var(--color-text-primary);
  line-height: 1.6;
}

#markdown-content a {
  color: var(--color-primary);
  text-decoration: none;
  cursor: pointer;
}

#markdown-content a:hover {
  text-decoration: underline;
}

#markdown-content code {
  border-radius: 3px;
  padding: 2px 5px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 0.85em;
  background: #f6f8fa;
}

#markdown-content pre {
  border-radius: 6px;
  padding: 13px;
  overflow: auto;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  background: #f6f8fa;
  border: 1px solid var(--color-border);
}

#markdown-content pre code {
  background-color: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 0.85em;
}

#markdown-content table {
  border-collapse: collapse;
  margin: 13px auto;
  overflow: auto;
}

#markdown-content.table-layout-left table {
  width: auto;
  margin-left: 0;
  margin-right: auto;
}

#markdown-content.table-layout-center table {
  width: auto;
}

#markdown-content.table-layout-center-full-width table {
  width: 100%;
  margin-left: auto;
  margin-right: auto;
}

#markdown-content table th,
#markdown-content table td {
  padding: 8pt;
  border: 1px solid rgb(163, 163, 163);
}

#markdown-content table th {
  background-color: rgb(229, 229, 229);
  color: rgb(23, 23, 23);
  font-weight: bold;
}

#markdown-content table tr:nth-child(2n) {
  background-color: rgb(250, 250, 250);
}

#markdown-content table tr:nth-child(2n+1) {
  background-color: rgb(255, 255, 255);
}

#markdown-content blockquote {
  border-left: 4px solid rgb(223, 226, 229);
  padding: 1px 13px;
  margin: 0;
  color: var(--color-text-secondary);
}

#markdown-content blockquote > :first-child {
  margin-top: 0;
}

#markdown-content blockquote > :last-child {
  margin-bottom: 0;
}

#markdown-content ul, #markdown-content ol {
  padding-left: 20px;
}

#markdown-content ol {
  list-style-type: decimal;
}

#markdown-content li {
  margin: 4px 0;
}

#markdown-content hr {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 24px 0;
}

#markdown-content img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
}

#markdown-content .diagram-block {
  margin: 20px auto;
  text-align: center;
  max-width: 100%;
  overflow: visible;
}

#markdown-content .diagram-block img {
  max-width: 100%;
  height: auto;
}

#markdown-content .katex-display {
  margin: 1em 0;
}

#markdown-content ul.contains-task-list {
  list-style-type: none;
  padding-left: 0;
}

#markdown-content .task-list-item {
  margin: 4px 0;
}

@media print {
  #markdown-page {
    max-width: 100%;
  }

  #markdown-content {
    box-shadow: none;
    padding: 20px;
  }

  #markdown-content .diagram-block img {
    max-width: 100% !important;
    max-height: 400px !important;
  }

  #markdown-content table, #markdown-content pre {
    break-inside: avoid;
  }
}
`;
}
