/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Marked, type Token, type Tokens } from 'marked';
import type { Plugin } from 'vite';
import type { TocEntry } from '../core/doc.ts';
import { frontmatter } from '../core/frontmatter.ts';
import { escapeHtml } from '../core/html.ts';
import { imageSize } from '../core/image.ts';

// `import { html, title, toc, meta } from './x.md?doc'` compiles a Markdown
// document at build time: the frontmatter, the first H1 as the title, a table
// of contents, and the body as HTML. Every image becomes a Vite import, so it
// ships hashed and carries its pixel size, and GitHub alerts become callouts.
// Links to other Markdown files lose their href: nothing serves them here.
// A paragraph that starts with `Controls → …` is a click path: each piece is
// one press in the prototype panel, in order, and the last is the one you set.

const SUFFIX = '?doc';
const ALERT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;

export function markdownDocs(): Plugin {
  return {
    name: 'markdown-docs',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith(SUFFIX)) return null;
      const file = id.slice(0, -SUFFIX.length);
      this.addWatchFile(file);
      return compile(readFileSync(file, 'utf8'), file);
    },
  };
}

const IMG = '\u0000';

function compile(source: string, file: string) {
  const { data, body } = frontmatter(source);
  const ids = new Map<string, number>();
  const slug = (text: string) => {
    const base =
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s-]/gu, '')
        .trim()
        .replace(/\s+/g, '-') || 'section';
    const n = ids.get(base) ?? 0;
    ids.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
  const toc: TocEntry[] = [];
  const images: string[] = [];
  let title = '';

  const md = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const id = slug(text);
        if (depth === 2 || depth === 3) toc.push({ id, text, depth });
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
      paragraph({ tokens }) {
        const path = clickPath(tokens, (t) => this.parser.parseInline(t));
        if (path) return path;
        if (tokens.length === 1 && tokens[0].type === 'image') return this.parser.parseInline(tokens);
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      tablecell(token) {
        const path = clickPath(token.tokens, (t) => this.parser.parseInline(t));
        const tag = token.header ? 'th' : 'td';
        const open = token.align ? `<${tag} align="${token.align}">` : `<${tag}>`;
        const inner = path ?? this.parser.parseInline(token.tokens);
        return `${open}${inner}</${tag}>`;
      },
      image({ href, text }) {
        const n = images.push(href) - 1;
        const size = imageSizeOf(resolve(dirname(file), href));
        const dims = size ? ` width="${size.width}" height="${size.height}"` : '';
        const loading = n === 0 ? 'eager' : 'lazy';
        return (
          `<figure class="doc-figure"><img src="${IMG}${n}${IMG}" alt=""${dims} loading="${loading}" decoding="async">` +
          `<figcaption>${escapeHtml(text)} <a href="${IMG}${n}${IMG}" target="_blank" rel="noreferrer">Full size</a></figcaption></figure>\n`
        );
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (/\.md(#|$)/.test(href)) return inner;
        const external = /^https?:/.test(href) ? ' target="_blank" rel="noreferrer"' : '';
        return `<a href="${escapeHtml(href)}"${external}>${inner}</a>`;
      },
      blockquote(token) {
        const kind = (token as Tokens.Blockquote & { alert?: string }).alert;
        const inner = this.parser.parse(token.tokens);
        if (!kind) return `<blockquote>${inner}</blockquote>\n`;
        const label = kind[0].toUpperCase() + kind.slice(1);
        return `<aside class="doc-callout" data-kind="${kind}"><p class="doc-callout-kind">${label}</p>${inner}</aside>\n`;
      },
    },
  });

  const tokens = md.lexer(body);
  const at = tokens.findIndex((t) => t.type === 'heading' && t.depth === 1);
  if (at >= 0) {
    title = (tokens[at] as Tokens.Heading).text;
    tokens.splice(at, 1);
  }
  for (const t of tokens) if (t.type === 'blockquote') markAlert(t as Tokens.Blockquote);

  const html = md
    .parser(tokens)
    .replace(/<table>/g, '<div class="doc-table"><table>')
    .replace(/<\/table>/g, '</table></div>');

  const imports = images.map((href, n) => `import img${n} from ${JSON.stringify(relative(href))};`);
  const parts = html.split(IMG).map((part, i) => (i % 2 ? `img${part}` : JSON.stringify(part)));
  return [
    ...imports,
    `export const meta = ${JSON.stringify(data)};`,
    `export const title = ${JSON.stringify(title)};`,
    `export const toc = ${JSON.stringify(toc)};`,
    `export const html = ${parts.join(' + ')};`,
  ].join('\n');
}

const relative = (href: string) => (href.startsWith('.') || href.startsWith('/') ? href : `./${href}`);

// `Controls → Review → **Reset to the comps**` on its own line. A sentence may
// follow the last step after `. `. Anything that does not start at Controls
// stays prose, so an arrow in a sentence is not a path. The first step is the
// closed panel's button: DialKit's sliders glyph, not the word.
const PATH_TOKEN = new Set(['text', 'strong', 'em', 'codespan', 'escape']);

/** The inline tokens split at each ` → `, one list per step, and how many arrows there were. */
function splitSteps(tokens: Token[]): { steps: Token[][]; arrows: number } {
  const steps: Token[][] = [[]];
  let arrows = 0;
  for (const token of tokens) {
    if (token.type !== 'text') {
      steps.at(-1)?.push(token);
      continue;
    }
    const parts = token.text.split(' → ');
    arrows += parts.length - 1;
    parts.forEach((part: string, i: number) => {
      if (i > 0) steps.push([]);
      if (part) steps.at(-1)?.push({ type: 'text', raw: part, text: part });
    });
  }
  return { steps, arrows };
}

/** A sentence after the last step (`… → **dark**. Then reload.`) comes off the step and reads as prose. */
function peelFollow(last: Token[]): Token[] {
  const tail = last.at(-1);
  if (tail?.type !== 'text') return [];
  const peeled = tail.text.match(/^([\s\S]*?)\.\s+(\S[\s\S]*)$/);
  if (!peeled) return [];
  if (peeled[1]) tail.text = peeled[1];
  else last.pop();
  return [{ type: 'text', raw: peeled[2], text: peeled[2] }];
}

function clickPath(tokens: Token[], inline: (tokens: Token[]) => string): string | null {
  if (!tokens.length || tokens.some((t) => !PATH_TOKEN.has(t.type))) return null;
  const { steps, arrows } = splitSteps(tokens);
  if (arrows < 1 || steps.some((step) => step.length === 0) || plain(steps[0]) !== 'Controls') return null;
  const last = steps[steps.length - 1];
  const follow = peelFollow(last);
  if (!last.length) return null;
  const items = steps
    .map((step, i) => `<li>${i === 0 ? CONTROLS_MARK : `<span>${inline(step)}</span>`}</li>`)
    .join('');
  const after = follow.length ? `<p class="doc-path-follow">${inline(follow)}</p>` : '';
  return `<ol class="doc-path" aria-label="Click in order">${items}</ol>${after}\n`;
}

// The closed Controls button, from DialKit's ICON_PANEL (viewBox 0 0 16 16).
const CONTROLS_MARK =
  '<span class="doc-path-open"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true" focusable="false">' +
  '<path opacity="0.5" fill="currentColor" d="M6.84766 11.75C6.78583 11.9899 6.75 12.2408 6.75 12.5C6.75 12.7592 6.78583 13.0101 6.84766 13.25H2C1.58579 13.25 1.25 12.9142 1.25 12.5C1.25 12.0858 1.58579 11.75 2 11.75H6.84766ZM14 11.75C14.4142 11.75 14.75 12.0858 14.75 12.5C14.75 12.9142 14.4142 13.25 14 13.25H12.6523C12.7142 13.0101 12.75 12.7592 12.75 12.5C12.75 12.2408 12.7142 11.9899 12.6523 11.75H14ZM3.09766 7.25C3.03583 7.48994 3 7.74075 3 8C3 8.25925 3.03583 8.51006 3.09766 8.75H2C1.58579 8.75 1.25 8.41421 1.25 8C1.25 7.58579 1.58579 7.25 2 7.25H3.09766ZM14 7.25C14.4142 7.25 14.75 7.58579 14.75 8C14.75 8.41421 14.4142 8.75 14 8.75H8.90234C8.96417 8.51006 9 8.25925 9 8C9 7.74075 8.96417 7.48994 8.90234 7.25H14ZM7.59766 2.75C7.53583 2.98994 7.5 3.24075 7.5 3.5C7.5 3.75925 7.53583 4.01006 7.59766 4.25H2C1.58579 4.25 1.25 3.91421 1.25 3.5C1.25 3.08579 1.58579 2.75 2 2.75H7.59766ZM14 2.75C14.4142 2.75 14.75 3.08579 14.75 3.5C14.75 3.91421 14.4142 4.25 14 4.25H13.4023C13.4642 4.01006 13.5 3.75925 13.5 3.5C13.5 3.24075 13.4642 2.98994 13.4023 2.75H14Z"/>' +
  '<circle cx="6" cy="8" r="0.998596" fill="currentColor" stroke="currentColor" stroke-width="1.25"/>' +
  '<circle cx="10.4999" cy="3.5" r="0.998657" fill="currentColor" stroke="currentColor" stroke-width="1.25"/>' +
  '<circle cx="9.75015" cy="12.5" r="0.997986" fill="currentColor" stroke="currentColor" stroke-width="1.25"/>' +
  '</svg><span class="doc-path-name">Controls</span></span>';

const plain = (tokens: Token[]) =>
  tokens
    .map((t) => ('text' in t ? t.text : ''))
    .join('')
    .trim();

// `> [!NOTE]` on the first line of a quote makes it a callout of that kind.
function markAlert(quote: Tokens.Blockquote & { alert?: string }) {
  const first = quote.tokens[0];
  if (first?.type !== 'paragraph') return;
  const para = first as Tokens.Paragraph;
  const lead = para.tokens[0];
  if (lead?.type !== 'text' || !ALERT.test(lead.text)) return;
  quote.alert = lead.text.match(ALERT)![1].toLowerCase();
  lead.text = lead.text.replace(ALERT, '');
  lead.raw = lead.raw.replace(ALERT, '');
  para.text = para.text.replace(ALERT, '');
  if (!lead.text) para.tokens.shift();
  if (!para.tokens.length) quote.tokens.shift();
}

function imageSizeOf(path: string) {
  try {
    return imageSize(readFileSync(path));
  } catch {
    // A missing image fails the build at its Vite import, which names the file; here it only goes unsized.
    return null;
  }
}
