/**
 * Markdown → DOCX converter
 * Based on markdown-viewer-extension's docx-exporter
 *
 * Architecture:
 * - Unified/remark pipeline for markdown parsing
 * - Plugin system for diagram rendering (plantuml, mermaid, dot, vega-lite, svg)
 * - Each renderer: code → SVG → sharp → PNG buffer
 * - DOCX generation via docx library
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ExternalHyperlink,
  ImageRun,
  TableLayoutType,
  VerticalAlign,
  convertInchesToTwip,
} from 'docx';
import { readFileSync } from 'fs';
import sharp from 'sharp';

// ============================================================================
// Diagram Renderers (same libraries as extension)
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
  svg = svg.replace(
    /(<rect fill="#F5F5F5" height="[^"]*" style="stroke:)#F5F5F5(;stroke-width:[^"]*" width="[^"]*" x="[^"]*" y="[^"]*"\/>)/,
    '$1#999999$2'
  );
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
  const lines = [...svg.matchAll(/<line style="stroke:#999999;stroke-width:1\.5;" x1="([^"]*)" x2="([^"]*)" y1="([^"]*)" y2="([^"]*)"/g)];
  if (lines.length >= 2) {
    const first = lines[0];
    const last = lines[lines.length - 1];
    const leftX = first[1];
    const rightX = last[1];
    const topY = first[3];
    const bottomY = last[4];
    const topLine = `<line style="stroke:#999999;stroke-width:1.5;" x1="${leftX}" x2="${rightX}" y1="${topY}" y2="${topY}"/>`;
    const bottomLine = `<line style="stroke:#999999;stroke-width:1.5;" x1="${leftX}" x2="${rightX}" y1="${bottomY}" y2="${bottomY}"/>`;
    svg = svg.replace('</g></svg>', `${topLine}${bottomLine}</g></svg>`);
  }
  // Add separator line between header (lane names) and content (flow chart)
  const headerMatch = svg.match(/<rect fill="#F5F5F5" height="([\d.]+)"[^>]* y="([\d.]+)"\/>/);
  if (headerMatch) {
    const sepY = String(parseFloat(headerMatch[1]) + parseFloat(headerMatch[2]));
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
 * PlantUML Renderer
 * Uses @markdown-viewer/draw-uml + @markdown-viewer/drawio2svg (same as extension)
 * Note: These packages export TypeScript, so we use tsx loader or fallback to PlantUML server
 */
async function renderPlantUML(dsl) {
  dsl = fixPlantUMLSyntax(dsl);
  try {
    const { textToDrawioXml } = await import('@markdown-viewer/draw-uml');
    const { convert } = await import('@markdown-viewer/drawio2svg');

    // Step 1: PlantUML DSL → DrawIO XML
    const drawioXml = await textToDrawioXml(dsl);

    // Step 2: DrawIO XML → SVG
    const svg = convert(drawioXml);

    return svg;
  } catch (error) {
    // Fallback: Use PlantUML server
    console.warn('Local PlantUML renderer not available, using server fallback:', error.message);
    return await renderPlantUMLServer(dsl);
  }
}

/**
 * PlantUML Server Fallback
 * Uses Kroki.io (newer PlantUML, supports POST, no SVG size limit)
 */
async function renderPlantUMLServer(dsl) {
  dsl = fixPlantUMLSyntax(dsl);
  const response = await fetch('https://kroki.io/plantuml/svg', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: dsl,
  });
  if (!response.ok) {
    throw new Error(`PlantUML server returned ${response.status}`);
  }
  const svg = await response.text();
  return fixPlantUMLSVG(svg);
}

/**
 * Mermaid Renderer
 * Uses mermaid library (same as extension)
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
 * Uses @viz-js/viz (same as extension)
 */
async function renderDot(code) {
  const { instance } = await import('@viz-js/viz');
  const viz = await instance();
  const svgElement = viz.renderSVGElement(code, {
    graphAttributes: { bgcolor: 'transparent' },
  });
  const svgString = new XMLSerializer().serializeToString(svgElement);
  return svgString;
}

/**
 * SVG-to-PNG conversion using sharp (Node.js equivalent of Canvas rendering)
 * Matches extension's calculateCanvasScale: (fontSize/12) * 4.0
 */
async function svgToPng(svgString, scale = 4.0) {
  // Add xmlns if missing
  if (!svgString.includes('xmlns=')) {
    svgString = svgString.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  const svgBuffer = Buffer.from(svgString);

  // Get SVG metadata
  const metadata = await sharp(svgBuffer).metadata();
  const width = Math.ceil((metadata.width || 800) * scale);
  const height = Math.ceil((metadata.height || 600) * scale);

  // Render SVG to PNG
  const pngBuffer = await sharp(svgBuffer)
    .resize(width, height, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();

  return {
    buffer: pngBuffer,
    width,
    height,
  };
}

/**
 * Plugin registry - matches extension's plugin order
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

/**
 * Find diagram plugin for a code block node
 */
function findPlugin(node) {
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
// Image Utilities (from extension's docx-image-utils.ts)
// ============================================================================

/**
 * Calculate image dimensions to fit within page constraints
 * Matches extension's calculateImageDimensions exactly
 */
function calculateImageDimensions(originalWidth, originalHeight) {
  const maxWidthPixels = 576;   // 6 inches * 96 DPI
  const maxHeightPixels = 912;  // 9.5 inches * 96 DPI

  if (originalWidth <= maxWidthPixels && originalHeight <= maxHeightPixels) {
    return { width: originalWidth, height: originalHeight };
  }

  const widthRatio = maxWidthPixels / originalWidth;
  const heightRatio = maxHeightPixels / originalHeight;
  const ratio = Math.min(widthRatio, heightRatio);

  return {
    width: Math.round(originalWidth * ratio),
    height: Math.round(originalHeight * ratio),
  };
}

/**
 * Convert diagram to DOCX ImageRun
 * Matches extension's convertPluginResultToDOCX logic:
 * - Scale to 1/4 of rendered PNG size
 * - Constrain to max 6x9.5 inches
 */
async function diagramToImageRun(plugin, code) {
  try {
    // Render diagram to SVG
    const svg = await plugin.render(code);

    // Convert SVG to PNG (scale = 4.0, same as extension)
    const { buffer, width, height } = await svgToPng(svg, 4.0);

    // Scale to 1/4 (same as extension)
    const scaledWidth = Math.round(width / 4);
    const scaledHeight = Math.round(height / 4);

    // Constrain to page dimensions
    const { width: displayWidth, height: displayHeight } = calculateImageDimensions(scaledWidth, scaledHeight);

    return new ImageRun({
      data: buffer,
      transformation: { width: displayWidth, height: displayHeight },
      type: 'png',
      altText: {
        title: `${plugin.type} Diagram`,
        description: `${plugin.type} diagram`,
        name: `${plugin.type}-diagram`,
      },
    });
  } catch (error) {
    console.warn(`Failed to render ${plugin.type}:`, error.message);
    return null;
  }
}

// ============================================================================
// Theme Configuration (matches extension's default theme)
// ============================================================================

const THEMES = {
  default: {
    primary: '1a73e8',
    text: '202124',
    muted: '5f6368',
    border: 'dadce0',
    codeBg: 'f6f8fa',
    headingBg: 'e8eaed',
    linkColor: '1a73e8',
    headerBg: 'e5e5e5',
    headerText: '171717',
    zebraEven: 'fafafa',
  },
  academic: {
    primary: '1e40af',
    text: '1f2937',
    muted: '6b7280',
    border: 'd1d5db',
    codeBg: 'f9fafb',
    headingBg: 'eff6ff',
    linkColor: '1e40af',
    headerBg: 'e5e5e5',
    headerText: '171717',
    zebraEven: 'f0f9ff',
  },
  warm: {
    primary: 'b45309',
    text: '1c1917',
    muted: '78716c',
    border: 'd6d3d1',
    codeBg: 'fef3c7',
    headingBg: 'fffbeb',
    linkColor: 'b45309',
    headerBg: 'e5e5e5',
    headerText: '171717',
    zebraEven: 'fefce8',
  },
  modern: {
    primary: '7c3aed',
    text: '18181b',
    muted: '71717a',
    border: 'e4e4e7',
    codeBg: 'faf5ff',
    headingBg: 'f5f3ff',
    linkColor: '7c3aed',
    headerBg: 'e5e5e5',
    headerText: '171717',
    zebraEven: 'faf5ff',
  },
};

let currentTheme = THEMES.default;

// ============================================================================
// Markdown Parser (same pipeline as extension)
// ============================================================================

function parseMarkdown(md) {
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath);
  return pipeline.parse(md);
}

// ============================================================================
// Inline Node Conversion (matches extension's docx-inline-converter.ts)
// ============================================================================

function convertInline(node, parentStyle = {}) {
  if (!node) return [];

  switch (node.type) {
    case 'text':
      return [new TextRun({ text: node.value, font: 'Arial', ...parentStyle })];

    case 'strong':
      return (node.children || []).flatMap(c => convertInline(c, { ...parentStyle, bold: true }));

    case 'emphasis':
      return (node.children || []).flatMap(c => convertInline(c, { ...parentStyle, italics: true }));

    case 'delete':
      return (node.children || []).flatMap(c => convertInline(c, { ...parentStyle, strike: true }));

    case 'inlineCode':
      return [new TextRun({
        text: node.value,
        font: 'Courier New',
        size: 18,
        shading: { fill: currentTheme.codeBg },
        ...parentStyle,
      })];

    case 'link': {
      const textRuns = (node.children || []).flatMap(c => convertInline(c, {
        ...parentStyle,
        color: currentTheme.linkColor,
        underline: { type: 'single' },
      }));
      if (textRuns.length === 0) {
        return [new TextRun({ text: node.url, font: 'Arial', ...parentStyle })];
      }
      return [new ExternalHyperlink({ children: textRuns, link: node.url })];
    }

    case 'image':
      return [new TextRun({
        text: `[Image: ${node.alt || node.url}]`,
        font: 'Arial',
        color: currentTheme.muted,
        italics: true,
      })];

    case 'inlineMath':
      return [new TextRun({ text: node.value, font: 'Cambria Math', italics: true })];

    case 'break':
      return [new TextRun({ text: '', break: 1 })];

    case 'htmlInline': {
      const htmlValue = node.value?.trim() || '';
      if (/^<br\s*\/?>$/i.test(htmlValue)) return [new TextRun({ text: '', break: 1 })];
      return [new TextRun({ text: htmlValue.replace(/<[^>]+>/g, ''), font: 'Arial', ...parentStyle })];
    }

    case 'footnoteReference':
      return [new TextRun({ text: `[${node.identifier}]`, font: 'Arial', superScript: true, color: currentTheme.muted })];

    default:
      if (node.value) return [new TextRun({ text: node.value, font: 'Arial', ...parentStyle })];
      if (node.children) return (node.children || []).flatMap(c => convertInline(c, parentStyle));
      return [];
  }
}

function convertInlineNodes(nodes, parentStyle = {}) {
  if (!nodes || !Array.isArray(nodes)) return [];
  return nodes.flatMap(node => convertInline(node, parentStyle));
}

// ============================================================================
// Block Node Conversion (matches extension's docx-exporter.ts)
// ============================================================================

function convertHeading(node) {
  const levels = {
    1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5, 6: HeadingLevel.HEADING_6,
  };
  return new Paragraph({
    children: convertInlineNodes(node.children || []),
    heading: levels[node.depth] || HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
  });
}

function convertParagraph(node) {
  const runs = convertInlineNodes(node.children || []);
  return new Paragraph({
    children: runs.length > 0 ? runs : [new TextRun({ text: '' })],
    spacing: { before: 120, after: 120 },
  });
}

/**
 * Convert table (matches extension's docx-table-converter.ts)
 */
function convertTable(node) {
  const tableRows = (node.children || []).filter(row => row.type === 'tableRow');
  const alignments = node.align || [];
  const rowCount = tableRows.length;
  const defaultMargins = { top: 80, bottom: 80, left: 100, right: 100 };
  const whiteBorder = { style: BorderStyle.SINGLE, size: 0, color: 'FFFFFF' };
  const noneBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

  const rows = tableRows.map((row, rowIndex) => {
    const isHeaderRow = rowIndex === 0;
    const isLastRow = rowIndex === rowCount - 1;
    const cells = (row.children || []).map((cell, colIndex) => {
      if (cell.type !== 'tableCell') return null;

      const paragraphs = [];
      const cellStyle = isHeaderRow ? { bold: true } : {};
      for (const block of (cell.children || [])) {
        if (block.type === 'paragraph') {
          const runs = convertInlineNodes(block.children || [], cellStyle);
          let alignment = AlignmentType.LEFT;
          if (isHeaderRow) alignment = AlignmentType.CENTER;
          else if (alignments[colIndex] === 'center') alignment = AlignmentType.CENTER;
          else if (alignments[colIndex] === 'right') alignment = AlignmentType.RIGHT;
          paragraphs.push(new Paragraph({ children: runs, alignment, spacing: { before: 40, after: 40 } }));
        } else if (block.type === 'text' || block.type === 'inlineCode') {
          const runs = convertInline(block, cellStyle);
          paragraphs.push(new Paragraph({ children: runs, spacing: { before: 40, after: 40 } }));
        }
      }
      if (paragraphs.length === 0) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: '' })], spacing: { before: 40, after: 40 } }));
      }

      // Borders matching extension's style
      const borders = {
        top: isHeaderRow
          ? { style: BorderStyle.SINGLE, size: 1, color: currentTheme.border }
          : whiteBorder,
        bottom: isLastRow
          ? { style: BorderStyle.SINGLE, size: 1, color: currentTheme.border }
          : whiteBorder,
        left: colIndex === 0 ? whiteBorder : noneBorder,
        right: noneBorder,
      };

      // Shading matching extension's style
      let shading;
      if (isHeaderRow) {
        shading = { fill: currentTheme.headerBg };
      } else {
        const bg = ((rowIndex - 1) % 2) === 0 ? 'FFFFFF' : currentTheme.zebraEven;
        if (bg !== 'FFFFFF') shading = { fill: bg };
      }

      return new TableCell({
        children: paragraphs,
        verticalAlign: VerticalAlign.CENTER,
        margins: defaultMargins,
        borders,
        shading,
      });
    }).filter(Boolean);

    return new TableRow({ children: cells, tableHeader: isHeaderRow });
  });

  return new Table({
    rows,
    layout: TableLayoutType.AUTOFIT,
    alignment: AlignmentType.CENTER,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

function convertList(node, depth = 0) {
  const { ordered, children } = node;
  const items = [];

  for (const item of children) {
    const bullet = ordered ? `${items.length + 1}.` : '•';
    const bulletRun = new TextRun({ text: `${bullet}  `, font: 'Arial', bold: true });

    for (const block of (item.children || [])) {
      if (block.type === 'paragraph') {
        items.push(new Paragraph({
          children: [bulletRun, ...convertInlineNodes(block.children || [])],
          indent: { left: convertInchesToTwip(0.25 * depth) },
          spacing: { before: 40, after: 40 },
        }));
      } else if (block.type === 'list') {
        items.push(...convertList(block, depth + 1));
      }
    }

    if (items.length === 0 || (item.children || []).length === 0) {
      items.push(new Paragraph({
        children: [bulletRun, new TextRun({ text: '' })],
        indent: { left: convertInchesToTwip(0.25 * depth) },
        spacing: { before: 40, after: 40 },
      }));
    }
  }

  return items;
}

function convertCodeBlock(node) {
  const lang = node.lang || '';
  const lines = (node.value || '').split('\n');
  return [
    new Paragraph({
      children: [new TextRun({ text: lang ? `[${lang}]` : '[code]', font: 'Arial', size: 16, color: '6b7280' })],
      spacing: { before: 120, after: 0 },
    }),
    ...lines.map(line =>
      new Paragraph({
        children: [new TextRun({ text: line || ' ', font: 'Courier New', size: 17 })],
        shading: { fill: currentTheme.codeBg },
        spacing: { before: 0, after: 0, line: 276 },
        border: {
          top: { color: 'E1E4E8', space: 1, style: BorderStyle.SINGLE, size: 6 },
          bottom: { color: 'E1E4E8', space: 1, style: BorderStyle.SINGLE, size: 6 },
          left: { color: 'E1E4E8', space: 1, style: BorderStyle.SINGLE, size: 6 },
          right: { color: 'E1E4E8', space: 1, style: BorderStyle.SINGLE, size: 6 },
        },
      })
    ),
  ];
}

function convertBlockquote(node) {
  const elements = [];
  for (const block of (node.children || [])) {
    if (block.type === 'paragraph') {
      elements.push(new Paragraph({
        children: [
          new TextRun({ text: '❝ ', font: 'Arial', color: currentTheme.primary, size: 28 }),
          ...convertInlineNodes(block.children || []),
        ],
        indent: { left: convertInchesToTwip(0.5) },
        spacing: { before: 120, after: 120 },
      }));
    } else if (block.type === 'blockquote') {
      elements.push(...convertBlockquote(block));
    }
  }
  if (elements.length === 0) {
    elements.push(new Paragraph({
      children: [new TextRun({ text: '❝ ', font: 'Arial', color: currentTheme.primary, size: 28 })],
      indent: { left: convertInchesToTwip(0.5) },
      spacing: { before: 120, after: 120 },
    }));
  }
  return elements;
}

// ============================================================================
// Main Conversion Function
// ============================================================================

export async function markdownToDocx(md, options = {}) {
  const { themeName = 'default', title } = options;
  currentTheme = THEMES[themeName] || THEMES.default;

  const tree = parseMarkdown(md);
  const content = [];

  for (const node of tree.children) {
    // Check for diagram plugins first (same as extension's convertNodeToDOCX)
    const plugin = findPlugin(node);
    if (plugin) {
      try {
        const imageRun = await diagramToImageRun(plugin, node.value);
        if (imageRun) {
          content.push(new Paragraph({
            children: [imageRun],
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 240 },
          }));
        } else {
          content.push(...convertCodeBlock(node));
        }
      } catch (error) {
        console.warn(`Diagram render failed: ${error.message}`);
        content.push(...convertCodeBlock(node));
      }
      continue;
    }

    switch (node.type) {
      case 'heading':
        content.push(convertHeading(node));
        break;
      case 'paragraph':
        content.push(convertParagraph(node));
        break;
      case 'thematicBreak':
        content.push(new Paragraph({
          border: { bottom: { color: currentTheme.border, space: 1, style: BorderStyle.SINGLE, size: 1 } },
          spacing: { before: 200, after: 200 },
        }));
        break;
      case 'blockquote':
        content.push(...convertBlockquote(node));
        break;
      case 'code':
        content.push(...convertCodeBlock(node));
        break;
      case 'list':
        content.push(...convertList(node));
        break;
      case 'table':
        content.push(convertTable(node));
        content.push(new Paragraph({ spacing: { before: 120, after: 120 } }));
        break;
      case 'html':
        content.push(new Paragraph({
          children: [new TextRun({ text: `[HTML: ${node.value}]`, font: 'Arial', color: currentTheme.muted, italics: true })],
        }));
        break;
      case 'math':
        content.push(new Paragraph({
          children: [new TextRun({ text: `$$ ${node.value} $$`, font: 'Cambria Math', italics: true })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
        }));
        break;
      default:
        break;
    }
  }

  return new Document({
    creator: 'md-viewer-cli',
    title: title || 'Markdown Document',
    description: 'Converted from Markdown using md-viewer-cli',
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
          },
        },
      },
      children: content,
    }],
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 22, color: currentTheme.text },
          paragraph: { spacing: { line: 360 } },
        },
      },
    },
  });
}

export async function markdownToDocxBuffer(filePath, options = {}) {
  const md = readFileSync(filePath, 'utf-8');
  const doc = await markdownToDocx(md, options);
  return Packer.toBuffer(doc);
}
