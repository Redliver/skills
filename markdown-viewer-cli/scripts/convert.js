/**
 * Markdown → DOCX converter
 * Based on the docx-exporter from markdown-viewer-extension
 * Uses the `docx` library for Word document generation
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
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
  convertInchesToTwip,
} from 'docx';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

// Theme colors
const THEMES = {
  default: {
    primary: '2563eb',
    text: '1a1a1a',
    muted: '6b7280',
    border: 'd1d5db',
    codeBg: 'f3f4f6',
    headingBg: 'eff6ff',
  },
  academic: {
    primary: '1e40af',
    text: '1f2937',
    muted: '6b7280',
    border: 'd1d5db',
    codeBg: 'f9fafb',
    headingBg: 'eff6ff',
  },
  warm: {
    primary: 'b45309',
    text: '1c1917',
    muted: '78716c',
    border: 'd6d3d1',
    codeBg: 'fef3c7',
    headingBg: 'fffbeb',
  },
  modern: {
    primary: '7c3aed',
    text: '18181b',
    muted: '71717a',
    border: 'e4e4e7',
    codeBg: 'faf5ff',
    headingBg: 'f5f3ff',
  },
};

/**
 * Parse markdown to AST using remark
 */
async function parseMarkdown(md) {
  const pipeline = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath);

  const tree = pipeline.parse(md);
  return tree;
}

/**
 * Create a styled paragraph with alignment
 */
function makeParagraph(text, options = {}) {
  const { align, indent, style } = options;
  return new Paragraph({
    text: text || '',
    alignment: align,
    indent: indent,
    style: style,
  });
}

/**
 * Convert inline AST node to TextRun or ExternalHyperlink
 */
function convertInline(node, theme) {
  if (node.type === 'text') {
    return new TextRun({ text: node.value, font: 'Arial' });
  }
  if (node.type === 'strong') {
    const children = node.children.flatMap(c => convertInline(c, theme));
    return children.map(child => {
      if (child instanceof TextRun) {
        return new TextRun({ ...child.options, bold: true });
      }
      return child;
    });
  }
  if (node.type === 'emphasis') {
    const children = node.children.flatMap(c => convertInline(c, theme));
    return children.map(child => {
      if (child instanceof TextRun) {
        return new TextRun({ ...child.options, italics: true });
      }
      return child;
    });
  }
  if (node.type === 'inlineCode') {
    return new TextRun({
      text: node.value,
      font: 'Courier New',
      size: 18, // 9pt
    });
  }
  if (node.type === 'link') {
    const text = node.children.map(c => c.value || '').join('');
    return new ExternalHyperlink({
      children: [new TextRun({ text, style: 'Hyperlink', font: 'Arial' })],
      link: node.url,
    });
  }
  if (node.type === 'delete') {
    const children = node.children.flatMap(c => convertInline(c, theme));
    return children.map(child => {
      if (child instanceof TextRun) {
        return new TextRun({ ...child.options, strike: true });
      }
      return child;
    });
  }
  if (node.type === 'math') {
    return new TextRun({ text: node.value, font: 'Cambria Math', italics: true });
  }
  if (node.type === 'image') {
    try {
      const src = node.url;
      if (src.startsWith('http://') || src.startsWith('https://')) {
        return new TextRun({ text: `[Image: ${node.alt || src}]`, font: 'Arial', color: theme.muted });
      }
      const imgData = readFileSync(resolve(src));
      return new ImageRun({ data: imgData, transformation: { width: 400, height: 300 } });
    } catch {
      return new TextRun({ text: `[Image: ${node.alt || node.url}]`, font: 'Arial', color: theme.muted });
    }
  }
  if (node.type === 'footnoteReference') {
    return new TextRun({ text: `[${node.identifier}]`, font: 'Arial', superScript: true, color: theme.muted });
  }
  if (node.type === 'htmlInline') {
    return new TextRun({ text: node.value, font: 'Arial' });
  }
  // Fallback
  return new TextRun({ text: node.value || '', font: 'Arial' });
}

/**
 * Convert a paragraph-like node (paragraph, heading, blockquote) children to runs
 */
function childrenToRuns(children, theme) {
  return children.flatMap(c => {
    const runs = convertInline(c, theme);
    return Array.isArray(runs) ? runs : [runs];
  });
}

/**
 * Convert AST table to docx Table
 */
function convertTable(node, theme) {
  const { children: rows } = node;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, ri) =>
      new TableRow({
        children: row.children.map(cell => {
          const cellChildren = cell.children.flatMap(block =>
            block.children ? childrenToRuns(block.children, theme) : [new TextRun({ text: '', font: 'Arial' })]
          );
          return new TableCell({
            children: [new Paragraph({ children: cellChildren, spacing: { before: 60, after: 60 } })],
            shading: ri === 0 ? { fill: theme.headingBg } : undefined,
          });
        }),
      })
    ),
  });
}

/**
 * Convert AST list to docx paragraphs with numbering
 */
function convertList(node, depth = 0) {
  const { ordered, children } = node;
  return children.map((item, i) => {
    const bullet = ordered ? `${i + 1}. ` : '•  ';
    const itemText = item.children
      .filter(b => b.type === 'paragraph')
      .flatMap(b => b.children)
      .map(c => c.value || '')
      .join('');
    return new Paragraph({
      children: [
        new TextRun({ text: bullet, font: 'Arial', bold: true }),
        new TextRun({ text: itemText, font: 'Arial' }),
      ],
      indent: { left: convertInchesToTwip(0.25 * depth) },
      spacing: { before: 40, after: 40 },
    });
  });
}

// Global theme reference for code blocks
let theme = THEMES.default;

/**
 * Convert code block to docx paragraph with monospace font
 */
function convertCodeBlock(node) {
  const lang = node.lang || '';
  const lines = node.value.split('\n');
  return [
    new Paragraph({
      children: [
        new TextRun({
          text: lang ? `[${lang}]` : '[code]',
          font: 'Arial',
          size: 16,
          color: '6b7280',
        }),
      ],
      spacing: { before: 120, after: 0 },
    }),
    ...lines.map(line =>
      new Paragraph({
        children: [
          new TextRun({
            text: line || ' ',
            font: 'Courier New',
            size: 17, // 8.5pt
          }),
        ],
        shading: { fill: theme.codeBg },
        spacing: { before: 0, after: 0, line: 276 },
      })
    ),
  ];
}

/**
 * Main conversion function: Markdown string → docx Document
 */
export async function markdownToDocx(md, options = {}) {
  const { themeName = 'default', title } = options;
  theme = THEMES[themeName] || THEMES.default;

  const tree = await parseMarkdown(md);

  const content = [];
  let i = 0;

  for (const node of tree.children) {
    switch (node.type) {
      case 'heading': {
        const levels = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        };
        content.push(
          new Paragraph({
            children: childrenToRuns(node.children, theme),
            heading: levels[node.depth] || HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 120 },
          })
        );
        break;
      }

      case 'paragraph': {
        content.push(
          new Paragraph({
            children: childrenToRuns(node.children, theme),
            spacing: { before: 120, after: 120 },
          })
        );
        break;
      }

      case 'thematicBreak':
        content.push(
          new Paragraph({
            border: {
              bottom: { color: theme.border, space: 1, style: BorderStyle.SINGLE, size: 1 },
            },
            spacing: { before: 200, after: 200 },
          })
        );
        break;

      case 'blockquote': {
        const quoteChildren = node.children
          .filter(b => b.type === 'paragraph')
          .flatMap(b => b.children);
        content.push(
          new Paragraph({
            children: [
              new TextRun({ text: '❝ ', font: 'Arial', color: theme.primary, size: 28 }),
              ...childrenToRuns(quoteChildren, theme),
            ],
            indent: { left: convertInchesToTwip(0.5) },
            spacing: { before: 120, after: 120 },
          })
        );
        break;
      }

      case 'code':
        content.push(...convertCodeBlock(node));
        break;

      case 'list':
        content.push(...convertList(node));
        break;

      case 'table':
        content.push(convertTable(node, theme));
        // Add spacing after table
        content.push(new Paragraph({ spacing: { before: 120, after: 120 } }));
        break;

      case 'html':
        content.push(
          new Paragraph({
            children: [new TextRun({ text: `[HTML: ${node.value}]`, font: 'Arial', color: theme.muted, italics: true })],
          })
        );
        break;

      case 'definition':
        content.push(
          new Paragraph({
            children: [
              new TextRun({ text: `${node.label}: `, font: 'Arial', bold: true }),
              new TextRun({ text: node.title || node.url || '', font: 'Arial' }),
            ],
          })
        );
        break;

      case 'math':
        content.push(
          new Paragraph({
            children: [
              new TextRun({ text: `$$$$ ${node.value} $$$$`, font: 'Cambria Math', italics: true }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
          })
        );
        break;

      default:
        // Skip unknown nodes silently
        break;
    }
    i++;
  }

  const doc = new Document({
    creator: 'md-viewer-cli',
    title: title || 'Markdown Document',
    description: 'Converted from Markdown using md-viewer-cli',
    sections: [{ children: content }],
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 22, // 11pt
            color: theme.text,
          },
          paragraph: {
            spacing: { line: 360 }, // 1.5 line spacing
          },
        },
      },
    },
  });

  return doc;
}

/**
 * Convert markdown file to docx buffer
 */
export async function markdownToDocxBuffer(filePath, options = {}) {
  const md = readFileSync(filePath, 'utf-8');
  const doc = await markdownToDocx(md, options);
  return Packer.toBuffer(doc);
}
