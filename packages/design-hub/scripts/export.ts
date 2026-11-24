#!/usr/bin/env node
/// <reference types="node" />
// `design-hub export <slug>`: a brand prototype's artboards as files. It
// starts the hub on a free port, opens the prototype in headless Chrome with
// ?export (artboards only, real size, motion off), waits for fonts and
// images, then writes each artboard as a PNG or the presented ones into one
// PDF. The format decides by default: posts, stories, previews and banners
// are PNG; slides and print are PDF.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, relative, resolve } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import {
  type As,
  type Board,
  chromeCandidates,
  exportUrl,
  fileNames,
  pdfFiles,
  plan,
} from '../core/export.ts';
import { PROTOTYPES, ROOT } from '../server/paths.ts';
import { hubConfig } from '../vite/plugin.ts';
import { type Browser, launch, within } from './lib/cdp.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';

export const spec = {
  name: 'export',
  summary: "Write a prototype's artboards to files: PNG for posts, PDF for slides and print.",
  positionals: [
    { name: 'prototype', description: 'The prototype folder, e.g. sample-social', required: true },
  ],
  flags: {
    as: {
      type: 'string',
      choices: ['auto', 'png', 'pdf'],
      default: 'auto',
      description:
        "auto: each artboard's format decides. png: every artboard a PNG. pdf: every artboard into one PDF.",
    },
    scale: {
      type: 'number',
      default: 1,
      description: 'PNG pixel density: 1 for the exact size platforms ask for, 2 for retina.',
    },
    dials: {
      type: 'string',
      description:
        'The dial state to export, as JSON by panel: {"Review":{"fixtures":"longest"}}. Default: the committed defaults.',
    },
    theme: {
      type: 'string',
      choices: ['light', 'dark'],
      description: 'The theme, when the artboards follow it.',
    },
    out: { type: 'string', description: 'Folder for the files. Default: exports/<prototype>/.' },
  },
  output: '{ ok, files: [path], artboards }',
} as const satisfies CommandSpec;

const READY_TIMEOUT_MS = 30_000;
const POLL_MS = 150;
const SERVER_CLOSE_MS = 5_000;
const VIEWPORT = { width: 2400, height: 1600 };

const READ_BOARDS = `JSON.stringify([...document.querySelectorAll('[data-artboard]')].map((el, index) => {
  el.dataset.index = String(index);
  const r = el.getBoundingClientRect();
  return { index, name: el.dataset.name, format: el.dataset.format, output: el.dataset.output,
    x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
}))`;

function findChrome(): string {
  const found = chromeCandidates(process.platform, process.env).find((p) => existsSync(p));
  if (!found)
    throw new CliError('No Chrome, Chromium or Edge found to render the artboards.', {
      fix: 'Install Google Chrome, or set CHROME_PATH to a Chromium-based browser.',
    });
  return found;
}

/** The hub on a free port, for this one export. */
async function startHub(): Promise<{ server: ViteDevServer; origin: string }> {
  const config = hubConfig({ root: ROOT }, 'build');
  const server = await createServer({
    ...config,
    logLevel: 'error',
    // One page, read once: no file watcher, no hot reload, so nothing outlives the export.
    server: { ...config.server, port: 0, strictPort: false, hmr: false, open: false, watch: null, ws: false },
  });
  await server.listen();
  const address = server.httpServer?.address() as AddressInfo | null | undefined;
  if (!address) throw new CliError('The hub did not start for export.');
  return { server, origin: `http://localhost:${address.port}` };
}

async function evaluate<T>(browser: Browser, expression: string): Promise<T> {
  const { result } = await browser.send<{ result: { value: T } }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return result.value;
}

async function waitReady(browser: Browser): Promise<void> {
  const until = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < until) {
    if (await evaluate<boolean>(browser, "document.documentElement.dataset.exportReady === '1'")) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new CliError('The prototype never finished loading for export.', {
    errors: browser.errors.slice(0, 5),
    fix: 'Open the prototype with ?export in the browser and fix what its console says. Export needs a Board from @kit/Artboard.',
  });
}

/** One PNG per artboard; the page's device scale (--scale) sets the pixel density. */
async function writePngs(browser: Browser, slug: string, boards: Board[], dir: string) {
  const names = fileNames(slug, boards, 'png');
  const files: string[] = [];
  for (const [i, b] of boards.entries()) {
    const { data } = await browser.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      clip: { x: b.x, y: b.y, width: b.width, height: b.height, scale: 1 },
      captureBeyondViewport: true,
    });
    const file = join(dir, names[i]);
    writeFileSync(file, Buffer.from(data, 'base64'));
    files.push(file);
  }
  return files;
}

/** One PDF per format: every other artboard is hidden while that format prints. */
async function writePdfs(browser: Browser, slug: string, boards: Board[], dir: string) {
  // Print lays out at each page's own size; the screenshot viewport would shrink it.
  await browser.send('Emulation.clearDeviceMetricsOverride');
  const files: string[] = [];
  for (const { format, file } of pdfFiles(slug, boards)) {
    await evaluate(
      browser,
      `document.querySelectorAll('[data-artboard]').forEach((el) => {
        el.style.display = el.dataset.format === ${JSON.stringify(format)} && ${JSON.stringify(boards.map((b) => b.index))}.includes(Number(el.dataset.index)) ? '' : 'none';
      })`,
    );
    const { data } = await browser.send<{ data: string }>('Page.printToPDF', {
      printBackground: true,
      preferCSSPageSize: true,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
    });
    const path = join(dir, file);
    writeFileSync(path, Buffer.from(data, 'base64'));
    files.push(path);
  }
  return files;
}

function checkFlags(slug: string, flags: Args<typeof spec>['flags']) {
  if (!existsSync(join(PROTOTYPES, slug, 'index.tsx'))) throw new CliError(`No prototype called ${slug}.`);
  if (!(flags.scale >= 1 && flags.scale <= 4)) throw new CliError('--scale takes 1 to 4.');
  if (flags.dials) {
    try {
      JSON.parse(flags.dials);
    } catch {
      throw new CliError('--dials takes JSON by panel name.', {
        example: '{"Review":{"fixtures":"longest"}}',
      });
    }
  }
}

async function render(
  browser: Browser,
  url: string,
  flags: Args<typeof spec>['flags'],
  slug: string,
  dir: string,
) {
  await browser.send('Emulation.setDeviceMetricsOverride', {
    ...VIEWPORT,
    deviceScaleFactor: flags.scale,
    mobile: false,
  });
  await browser.send('Page.navigate', { url });
  await waitReady(browser);
  const boards = JSON.parse(await evaluate<string>(browser, READ_BOARDS)) as Board[];
  if (!boards.length)
    throw new CliError(`${slug} has no artboards to export.`, {
      fix: 'Export reads <Artboard> elements inside a <Board> from @kit/Artboard.',
    });
  const { png, pdf } = plan(boards, flags.as as As);
  mkdirSync(dir, { recursive: true });
  const files = await writePngs(browser, slug, png, dir);
  if (pdf.length) files.push(...(await writePdfs(browser, slug, pdf, dir)));
  return { files, artboards: boards.length };
}

export async function main({ positionals: [slug], flags }: Args<typeof spec>) {
  checkFlags(slug, flags);
  const chrome = findChrome();
  const dir = resolve(ROOT, flags.out ?? join('exports', slug));
  const { server, origin } = await startHub();
  let browser: Browser | undefined;
  try {
    browser = await launch(chrome);
    const url = exportUrl(origin, slug, { dials: flags.dials, theme: flags.theme });
    const { files, artboards } = await render(browser, url, flags, slug, dir);
    return { files: files.map((f) => relative(ROOT, f)), artboards };
  } finally {
    await browser?.close();
    await within(server.close(), SERVER_CLOSE_MS);
  }
}
