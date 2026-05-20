---
name: unified-markdown-pipeline
description: Build Markdown processing tools (CLI, export, preview) using the unified/remark/rehype ecosystem. Covers MD→HTML rendering, MD→DOCX conversion, and common gotchas. Use when building any tool that parses, transforms, or exports Markdown.
tags: [markdown, nodejs, unified, remark, rehype, docx, cli]
---

# Unified Markdown Pipeline

Build Markdown processing tools using the unified/remark/rehype ecosystem in Node.js.

## Core Pipeline Architecture

```
Markdown → [remark-parse] → MDAST → [remark-gfm] → MDAST+GFM → [remark-rehype] → HAST → [rehype-*] → HTML
```

**Critical**: `remark-rehype` is the bridge between remark (MDAST) and rehype (HAST). Without it, you get `"Cannot compile heading node"` errors because rehype plugins expect HAST nodes, not MDAST nodes.

## Minimal MD → HTML Pipeline

```javascript
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';     // ← REQUIRED bridge
import rehypeStringify from 'rehype-stringify';

const html = await unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)        // MDAST → HAST
  .use(rehypeStringify)
  .process(md);
```

## Full Feature Pipeline

```javascript
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeKatex from 'rehype-katex';
import rehypeExternalLinks from 'rehype-external-links';

const html = await unified()
  .use(remarkParse)
  .use(remarkGfm)           // tables, task lists, strikethrough, autolinks
  .use(remarkMath)          // $...$ and $$...$$ math
  .use(remarkRehype)        // ← bridge
  .use(rehypeHighlight)     // code syntax highlighting
  .use(rehypeSlug)          // heading IDs
  .use(rehypeKatex, { output: 'html' })  // math rendering
  .use(rehypeExternalLinks, { target: '_blank' })
  .use(rehypeStringify)
  .process(md);
```

## MD → DOCX Conversion

Parse with remark, then walk the AST to build `docx` library objects:

```javascript
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

// Parse to AST (NOT pipeline.run — use pipeline.parse)
const tree = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .parse(markdownString);     // returns MDAST tree directly

// Walk tree.children and convert each node type
const content = [];
for (const node of tree.children) {
  switch (node.type) {
    case 'heading':
      content.push(new Paragraph({
        children: node.children.map(c => new TextRun({ text: c.value || '' })),
        heading: HeadingLevel.HEADING_1,
      }));
      break;
    case 'paragraph':
      content.push(new Paragraph({
        children: convertInlineChildren(node.children),
      }));
      break;
    // table, list, code, blockquote, etc.
  }
}

const doc = new Document({ sections: [{ children: content }] });
const buffer = await Packer.toBuffer(doc);
```

### docx Library Gotchas

- **Check actual exports**: `docx` v9 does NOT export `EquationRun`, `MathRun`, `MathFraction`, `MathRadical`, `MathSuperScript`, `MathSubScript`, `MathNary`. Only import what exists.
- **Correct imports**: `Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ExternalHyperlink, ImageRun, convertInchesToTwip`
- **ExternalHyperlink**: `new ExternalHyperlink({ children: [new TextRun(...)], link: url })`
- **Inline code**: Use `TextRun({ text, font: 'Courier New' })` — no special docx inline code type.

## Common Gotchas

| Problem | Cause | Fix |
|---------|-------|-----|
| `Cannot compile heading node` | Missing `remark-rehype` | Add `.use(remarkRehype)` between remark and rehype plugins |
| `Cannot compile unknown node` | Same as above | Same fix |
| `remark-breaks` + `rehype-raw` conflict | Version incompatibility | Remove `rehype-raw` or `remark-breaks` |
| `rehype-document` version 8 not found | Latest is v7 | Use `rehype-document@^7.0.3` |
| `docx` import errors | Non-existent exports | Check `npm view docx exports` or try minimal import |
| Slow first conversion | npm module cold start | Normal — subsequent calls are fast |

## Chinese Network (npm install)

```bash
npm install --registry https://registry.npmmirror.com
```

## Project Structure Pattern

```
tool/
├── bin/
│   └── tool.js           # CLI entry (commander)
├── lib/
│   ├── render.js          # MD → HTML pipeline
│   ├── convert.js         # MD → DOCX conversion
│   └── preview.js         # HTTP preview server (optional)
├── package.json
└── README.md
```

## Key Dependencies

```json
{
  "unified": "^11.0.4",
  "remark-parse": "^11.0.0",
  "remark-gfm": "^4.0.0",
  "remark-math": "^6.0.0",
  "remark-rehype": "^11.0.0",
  "rehype-stringify": "^10.0.0",
  "rehype-highlight": "^7.0.1",
  "rehype-slug": "^6.0.0",
  "rehype-katex": "^7.0.1",
  "rehype-external-links": "^3.0.0",
  "highlight.js": "^11.10.0",
  "katex": "^0.16.11",
  "docx": "^9.5.1",
  "commander": "^12.1.0"
}
```
