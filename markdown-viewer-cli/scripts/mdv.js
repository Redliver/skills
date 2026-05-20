#!/usr/bin/env node

/**
 * mdv - Markdown Viewer CLI
 *
 * A local CLI tool for rendering Markdown and converting to Word documents.
 * Inspired by markdown-viewer-extension (https://github.com/markdown-viewer/markdown-viewer-extension)
 *
 * Usage:
 *   mdv render <file.md>           Render to HTML and save/view
 *   mdv convert <file.md>          Convert to DOCX (Word)
 *   mdv preview <file.md>          Live preview with auto-refresh
 *   mdv themes                     List available DOCX themes
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename, dirname, extname, join } from 'path';
import { renderToHtml, renderToDocument, getDefaultCSS } from './render.js';
import { markdownToDocx, markdownToDocxBuffer } from './convert.js';
import { startPreview } from './preview.js';

const program = new Command();

program
  .name('mdv')
  .description('Markdown Viewer CLI — render and convert Markdown files')
  .version('1.0.0');

// ─── render ────────────────────────────────────────────────────────────
program
  .command('render')
  .argument('<file>', 'Markdown file to render')
  .option('-o, --output <path>', 'Output file path (default: <input>.html)')
  .option('--view', 'Open in default browser after rendering')
  .option('--no-math', 'Disable KaTeX math rendering')
  .option('--no-breaks', 'Disable GFM line breaks')
  .option('--fragment', 'Output HTML fragment (no document wrapper)')
  .description('Render Markdown to HTML')
  .action(async (file, opts) => {
    const absPath = resolve(file);
    if (!existsSync(absPath)) {
      console.error(`❌ File not found: ${file}`);
      process.exit(1);
    }

    const md = readFileSync(absPath, 'utf-8');
    const title = basename(file, extname(file));

    try {
      let html;
      if (opts.fragment) {
        html = await renderToHtml(md, { math: opts.math, breaks: opts.breaks });
      } else {
        html = await renderToDocument(md, { title });
      }

      const outPath = opts.output || absPath.replace(/\.md$/i, '.html');
      writeFileSync(outPath, html, 'utf-8');
      console.log(`✅ Rendered: ${outPath}`);

      if (opts.view) {
        const { exec } = await import('child_process');
        const cmd = process.platform === 'darwin' ? 'open' :
          process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} "${outPath}"`);
      }
    } catch (err) {
      console.error(`❌ Render failed: ${err.message}`);
      process.exit(1);
    }
  });

// ─── convert ───────────────────────────────────────────────────────────
program
  .command('convert')
  .argument('<file>', 'Markdown file to convert')
  .option('-o, --output <path>', 'Output DOCX file path')
  .option('-t, --theme <name>', 'DOCX theme (default, academic, warm, modern)', 'default')
  .option('--title <title>', 'Document title')
  .description('Convert Markdown to Word document (.docx)')
  .action(async (file, opts) => {
    const absPath = resolve(file);
    if (!existsSync(absPath)) {
      console.error(`❌ File not found: ${file}`);
      process.exit(1);
    }

    const outPath = opts.output || absPath.replace(/\.md$/i, '.docx');
    const title = opts.title || basename(file, extname(file));

    console.log(`⏳ Converting ${file} → ${outPath} ...`);

    try {
      const buffer = await markdownToDocxBuffer(absPath, {
        themeName: opts.theme,
        title,
      });
      writeFileSync(outPath, buffer);
      console.log(`✅ Converted: ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(`❌ Conversion failed: ${err.message}`);
      process.exit(1);
    }
  });

// ─── preview ───────────────────────────────────────────────────────────
program
  .command('preview')
  .argument('<file>', 'Markdown file to preview')
  .option('-p, --port <number>', 'Port number', '8899')
  .option('--open', 'Open browser automatically')
  .description('Start live preview server with auto-refresh')
  .action(async (file, opts) => {
    const absPath = resolve(file);
    if (!existsSync(absPath)) {
      console.error(`❌ File not found: ${file}`);
      process.exit(1);
    }

    await startPreview(absPath, {
      port: parseInt(opts.port, 10),
      open: opts.open,
    });
  });

// ─── themes ────────────────────────────────────────────────────────────
program
  .command('themes')
  .description('List available DOCX themes')
  .action(() => {
    console.log(`
  Available DOCX themes:

    🎨 default    — Clean blue accent (GitHub-style)
    📚 academic   — Formal navy blue for papers
    🌅 warm       — Warm amber tones
    💜 modern     — Purple accent, modern feel

  Usage: mdv convert file.md --theme academic
`);
  });

// ─── batch ─────────────────────────────────────────────────────────────
program
  .command('batch')
  .argument('<dir>', 'Directory containing .md files')
  .option('--format <fmt>', 'Output format: html or docx', 'html')
  .option('-t, --theme <name>', 'DOCX theme (for docx format)', 'default')
  .description('Batch convert all .md files in a directory')
  .action(async (dir, opts) => {
    const absDir = resolve(dir);
    if (!existsSync(absDir)) {
      console.error(`❌ Directory not found: ${dir}`);
      process.exit(1);
    }

    const { readdirSync } = await import('fs');
    const files = readdirSync(absDir).filter(f => f.endsWith('.md'));
    if (files.length === 0) {
      console.log('No .md files found.');
      return;
    }

    console.log(`Found ${files.length} markdown files\n`);

    for (const file of files) {
      const inputPath = join(absDir, file);
      const ext = opts.format === 'docx' ? '.docx' : '.html';
      const outPath = join(absDir, file.replace(/\.md$/i, ext));

      try {
        if (opts.format === 'docx') {
          const buffer = await markdownToDocxBuffer(inputPath, { themeName: opts.theme });
          writeFileSync(outPath, buffer);
          console.log(`  ✅ ${file} → ${basename(outPath)} (${(buffer.length / 1024).toFixed(1)} KB)`);
        } else {
          const md = readFileSync(inputPath, 'utf-8');
          const title = basename(file, '.md');
          const html = await renderToDocument(md, { title });
          writeFileSync(outPath, html, 'utf-8');
          console.log(`  ✅ ${file} → ${basename(outPath)}`);
        }
      } catch (err) {
        console.error(`  ❌ ${file}: ${err.message}`);
      }
    }

    console.log(`\nDone!`);
  });

program.parse();
