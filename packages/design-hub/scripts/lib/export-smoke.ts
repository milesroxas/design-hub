/// <reference types="node" />
// A real `design-hub export` of one brand prototype on a cold cache: a
// throwaway project with the package's brand template, the CLI run in a
// child process of its own (ROOT is fixed when paths.ts loads), and the
// PNG it writes checked. Export is the one command that starts the hub
// with no one watching, so a break in it shows only when someone runs it.
// `scripts/export.test.ts` runs this when Chrome is found and skips with the
// reason when it is not; `release-check` runs it and fails without Chrome.
import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromeCandidates } from '../../core/export.ts';
import { TEMPLATES } from '../../server/paths.ts';

/** `root` is the throwaway project, removed before this returns. */
export type Smoke = { ran: true; files: string[]; root: string } | { ran: false; reason: string };

const SLUG = 'smoke-post';
const TIMEOUT_MS = 180_000;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** The browser export would use, or null. */
export const findChrome = () =>
  chromeCandidates(process.platform, process.env).find((p) => existsSync(p)) ?? null;

/** A project with one brand prototype from the package's template, and the kit file the hub imports. */
function project(): string {
  // Real, as the CLI reads $DESIGN_HUB_ROOT, so the files it names are relative to this folder.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-export-')));
  mkdirSync(join(root, 'kit'), { recursive: true });
  writeFileSync(join(root, 'kit', 'tokens.css'), ':root { --t: 1; }\n');
  const dir = join(root, 'prototypes', SLUG);
  cpSync(join(TEMPLATES, 'brand'), dir, { recursive: true });
  const vars: Record<string, string> = {
    title: 'Smoke post',
    slug: SLUG,
    created: '2030-01-01',
    kind: 'exploration',
    feature: "''",
    track: 'brand',
  };
  for (const name of readdirSync(dir)) {
    let text = readFileSync(join(dir, name), 'utf8');
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, v);
    writeFileSync(join(dir, name), text);
  }
  return root;
}

const run = (cli: string, root: string) =>
  new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile(
      process.execPath,
      [cli, 'export', SLUG, '--out', join(root, 'exports')],
      { cwd: root, env: { ...process.env, DESIGN_HUB_ROOT: root }, timeout: TIMEOUT_MS, encoding: 'utf8' },
      (error, stdout, stderr) =>
        done({ code: error ? Number((error as { code?: unknown }).code ?? 1) || 1 : 0, stdout, stderr }),
    );
  });

/**
 * Exports the brand template's one artboard through `cli` (the CLI entry:
 * the source `scripts/cli.ts` or the built `dist/scripts/cli.js`) and
 * checks a PNG came out. Not run without Chrome, saying so. Throws, with
 * what the command printed, when the export fails. Leaves nothing behind.
 */
export async function exportSmoke(cli: string): Promise<Smoke> {
  if (!findChrome())
    return { ran: false, reason: 'No Chrome, Chromium or Edge found; set CHROME_PATH to one.' };
  const root = project();
  try {
    const { code, stdout, stderr } = await run(cli, root);
    let out: { ok?: boolean; files?: string[] } = {};
    try {
      out = JSON.parse(stdout);
    } catch {}
    const files = (out.files ?? []).map((f) => join(root, f));
    const pngs = files.filter((f) => existsSync(f) && readFileSync(f).subarray(0, 4).equals(PNG));
    if (code !== 0 || out.ok !== true || !pngs.length)
      throw new Error(`design-hub export failed (exit ${code}):\n${stdout}\n${stderr}`.trim());
    return { ran: true, files: (out.files ?? []).map(String), root };
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
