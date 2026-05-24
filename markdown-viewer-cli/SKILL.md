---
name: markdown-viewer-cli
description: Markdown CLI tool — render to HTML, convert to DOCX, live preview.
  Unified/remark/rehype pipeline with GFM, KaTeX math, syntax highlighting, and themed DOCX export.
metadata:
  source: https://github.com/markdown-viewer/markdown-viewer-extension
---

# Markdown Viewer CLI (mdv)

This skill bundles a portable CLI tool (`mdv`) in the `scripts/` subdirectory.
**Requires Node.js 18+.** Run the setup script first to install dependencies.

## Quick Start

```bash
# Run setup (one-time)
# Windows:
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
# macOS/Linux:
bash scripts/setup.sh

# Then use the CLI (from this directory):
mdv render input.md --view
mdv convert input.md -t academic
mdv preview input.md --open
```

## Directory Structure

```
this-skill-directory/
├── mdv.bat                Windows: mdv render file.md
├── mdv                    Unix:    ./mdv render file.md
├── SKILL.md
├── scripts/
│   ├── mdv.js             Entry point (node scripts/mdv.js ...)
│   ├── render.js          Markdown → HTML pipeline
│   ├── convert.js         Markdown → DOCX pipeline
│   ├── preview.js         Live preview HTTP server
│   ├── package.json       Dependencies
│   ├── setup.ps1          Windows setup + CLI dependency installer
│   └── setup.sh           Unix setup + CLI dependency installer
└── references/
    └── diagram-syntax.md  PlantUML/Mermaid/DOT cheat sheet
```

## Commands

| Command | Description |
|---------|-------------|
| `render` | Render Markdown to HTML (full page or fragment) |
| `convert` | Convert Markdown to Word (.docx) with themed styling |
| `preview` | Start live preview server with auto-refresh |
| `themes` | List available DOCX themes |
| `batch` | Batch convert all .md files in a directory |

### render

```
mdv render <file> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <path>` | `<file>.html` | Output file path |
| `--view` | — | Open in default browser |
| `--no-math` | enabled | Disable KaTeX math rendering |
| `--no-breaks` | enabled | Disable GFM line breaks |
| `--fragment` | — | Output HTML fragment only |

### convert

```
mdv convert <file> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-o, --output <path>` | `<file>.docx` | Output DOCX path |
| `-t, --theme <name>` | `default` | DOCX theme |
| `--title <title>` | filename | Document title |

**Themes:** `default` (blue), `academic` (navy), `warm` (amber), `modern` (purple)

### preview

```
mdv preview <file> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <number>` | `8899` | Server port |
| `--open` | — | Open browser automatically |

### batch

```
mdv batch <dir> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--format <fmt>` | `html` | `html` or `docx` |
| `-t, --theme <name>` | `default` | DOCX theme |

## Features

- **Diagrams:** PlantUML, Mermaid.js, Graphviz (DOT) rendered inline to SVG/PNG
- **Math:** KaTeX (LaTeX in `$$` / `$` delimiters)
- **Syntax highlighting:** highlight.js for code blocks
- **GFM:** Tables, task lists, strikethrough, autolinks
- **DOCX themes:** 4 color themes

## Diagram Fences

| Language | Fence | Renderer |
|----------|-------|----------|
| PlantUML | ` ```plantuml ` / ` ```puml ` | Local draw-uml, fallback kroki.io |
| Mermaid | ` ```mermaid ` | Local mermaid.js |
| Graphviz | ` ```dot ` / ` ```graphviz ` | Local @viz-js/viz |

## Cross-Platform Notes

- **Windows:** `mdv render file.md` (uses `mdv.bat` → `scripts/mdv.js`)
- **macOS/Linux:** `./mdv render file.md` (uses `mdv` shell script → `scripts/mdv.js`, `chmod +x` if needed)
- All paths are relative to this skill directory — no hardcoded paths
- For system-wide access, add this directory to your PATH
