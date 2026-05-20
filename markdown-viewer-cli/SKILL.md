---
name: markdown-viewer-cli
description: "Markdown CLI tool — render to HTML, convert to DOCX, live preview. Unified/remark/rehype pipeline with GFM, KaTeX math, syntax highlighting, and themed DOCX export."
version: 1.0.0
author: Redliver
license: MIT
tags: [markdown, cli, nodejs, docx, unified, remark, rehype]
triggers:
  - Converting Markdown to HTML or DOCX
  - Rendering Markdown with math/code highlighting
  - Building Markdown processing pipelines
  - Live preview of Markdown files
related_skills:
  - unified-markdown-pipeline
---

# Markdown Viewer CLI

Local CLI tool for rendering Markdown to HTML, converting to Word (DOCX), and live preview. No server required — pure CLI commands.

## Quick Start

```bash
# Install dependencies
cd markdown-viewer-cli/scripts && npm install

# Render Markdown → HTML
node mdv.js render input.md

# Convert Markdown → DOCX
node mdv.js convert input.md

# Live preview (auto-refresh)
node mdv.js preview input.md
```

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `render` | MD → HTML (full document or fragment) | `node mdv.js render doc.md --view` |
| `convert` | MD → DOCX with themed styling | `node mdv.js convert doc.md --theme academic` |
| `preview` | Live HTTP preview with auto-refresh | `node mdv.js preview doc.md -p 8899` |
| `batch` | Batch convert all .md in a directory | `node mdv.js batch ./docs --format docx` |
| `themes` | List available DOCX themes | `node mdv.js themes` |

## Render Options

```
mdv render <file> [options]

  -o, --output <path>    Output file path (default: <input>.html)
  --view                 Open in browser after rendering
  --no-math              Disable KaTeX math rendering
  --no-breaks            Disable GFM line breaks
  --fragment             Output HTML fragment (no document wrapper)
```

## Convert Options

```
mdv convert <file> [options]

  -o, --output <path>    Output DOCX path
  -t, --theme <name>     Theme: default | academic | warm | modern
  --title <title>        Document title
```

## DOCX Themes

| Theme | Style |
|-------|-------|
| `default` | Clean blue accent (GitHub-style) |
| `academic` | Formal navy blue for papers |
| `warm` | Warm amber tones |
| `modern` | Purple accent, modern feel |

## Architecture

```
scripts/
├── mdv.js           CLI entry (commander)
├── render.js        MD → HTML pipeline (unified/remark/rehype)
├── convert.js       MD → DOCX (remark AST → docx lib)
└── preview.js       Live preview HTTP server
```

## Pipeline

```
Markdown → [remark-parse] → MDAST
  → [remark-gfm] → MDAST+GFM (tables, tasks, strikethrough)
  → [remark-math] → MDAST+Math ($...$, $$...$$)
  → [remark-rehype] → HAST (bridge!)
  → [rehype-highlight] → code syntax highlighting
  → [rehype-katex] → math rendering
  → [rehype-slug] → heading IDs
  → [rehype-stringify] → HTML
```

**Critical**: `remark-rehype` is the bridge between remark (MDAST) and rehype (HAST). Without it, you get `"Cannot compile heading node"` errors.

## Key Dependencies

- `unified`, `remark-parse`, `remark-gfm`, `remark-math` — Markdown parsing
- `remark-rehype` — MDAST → HAST bridge (required!)
- `rehype-highlight`, `rehype-katex`, `rehype-slug`, `rehype-stringify` — HTML rendering
- `docx` — Word document generation
- `commander` — CLI argument parsing

## Pitfalls

1. **Missing `remark-rehype`**: Causes `"Cannot compile heading node"` — always include it between remark and rehype plugins
2. **`docx` exports**: v9 does NOT export `EquationRun`, `MathRun`, `MathFraction`, etc. Only import what exists
3. **KaTeX in DOCX**: Falls back to plain text (no native math rendering via docx lib)
4. **Cold start**: First npm module loading can be slow — subsequent calls are fast
5. **Node warnings**: Use `NODE_NO_WARNINGS=1` to suppress experimental warnings
6. **China npm mirror**: Use `npm install --registry https://registry.npmmirror.com`

## npm install (China)

```bash
npm install --registry https://registry.npmmirror.com
```
