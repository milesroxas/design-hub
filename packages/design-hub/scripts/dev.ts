#!/usr/bin/env node
/// <reference types="node" />
// `design-hub dev`, `build`, `preview` and `open`: Vite on the hub's config
// (vite/plugin.ts), with the project as the content. `dev` streams Vite's own
// output rather than one JSON object, because a server never finishes.
import { spawn } from 'node:child_process';
import { createServer, build as viteBuild, preview as vitePreview } from 'vite';
import { devPort, readEnv } from '../server/env.ts';
import { ROOT } from '../server/paths.ts';
import { hubConfig } from '../vite/plugin.ts';
import { ensurePort } from './bootstrap.ts';
import type { Args, CommandSpec } from './lib/cli.ts';

export const spec = {
  name: 'dev',
  summary:
    "Serve the hub, every prototype and the review panel: on $DESIGN_HUB_PORT or $CONDUCTOR_PORT when a harness sets one, else this folder's port in .env, claimed on first run.",
  flags: { open: { type: 'boolean', description: 'Open the browser once the server is up.' } },
  output: "Vite's own log; the command runs until stopped.",
} as const satisfies CommandSpec;

export const buildSpec = {
  name: 'build',
  summary: 'Build the deployable site into dist/.',
  flags: {},
  output: '{ ok, outDir }',
} as const satisfies CommandSpec;

export const previewSpec = {
  name: 'preview',
  summary: 'Serve dist/ as built, on the same port as `design-hub dev`.',
  flags: {},
  output: "Vite's own log; the command runs until stopped.",
} as const satisfies CommandSpec;

export const openSpec = {
  name: 'open',
  summary: 'Start the hub and open it in the browser; what the project launcher double-click runs.',
  flags: {},
  output: "Vite's own log; the command runs until stopped.",
} as const satisfies CommandSpec;

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => {})
    .unref();
}

/** A port before Vite starts; a new claim is said on stderr, beside Vite's own log. */
function settlePort(): void {
  const { port, claimed, warnings } = ensurePort();
  for (const warning of warnings) console.error(`design-hub: ${warning}`);
  if (claimed) console.error(`design-hub: claimed port ${port} for this folder and wrote it to .env.`);
}

async function serve(open: boolean): Promise<void> {
  settlePort();
  const server = await createServer(hubConfig({ root: ROOT }, 'serve'));
  await server.listen();
  server.printUrls();
  if (open) openBrowser(`http://localhost:${devPort(readEnv(ROOT))}/`);
  await new Promise<void>((resolve) => {
    server.httpServer?.on('close', resolve);
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void server.close().then(resolve);
      });
  });
}

/** Builds dist/; `ok: false` carries the error, so preflight can report it. */
export async function build(): Promise<{ ok: boolean; outDir: string; error?: string }> {
  const config = hubConfig({ root: ROOT }, 'build');
  const outDir = config.build?.outDir ?? 'dist';
  try {
    await viteBuild({ ...config, logLevel: 'warn' });
    return { ok: true, outDir };
  } catch (error) {
    return { ok: false, outDir, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function previewBuilt() {
  settlePort();
  const server = await vitePreview(hubConfig({ root: ROOT }, 'build'));
  server.printUrls();
  await new Promise(() => {});
  return { stopped: true };
}

export async function main({ flags }: Args<typeof spec>) {
  await serve(flags.open);
  return { stopped: true };
}

export async function openMain() {
  await serve(true);
  return { stopped: true };
}
