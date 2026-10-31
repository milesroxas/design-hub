#!/usr/bin/env node
/// <reference types="node" />
// The Elyx add-on, one way only: tokens.css stays the single source and
// design-system/ is generated from it, so the two never disagree. A designer
// consumes it as a read-only Elyx dependency. Two-way sync is refused on
// purpose: Elyx rounds colours to 8 bits, keeps one font of a stack, cannot
// hold shadows, rings, easings or durations, and rewrites files on save, so
// anything read back would quietly change or delete tokens.
// Needs the Elyx CLI: npm install --global @elyx-design/cli
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { PROTOTYPES, REPO } from '../_server/paths.ts';
import { type Args, CliError, type CommandSpec, isMain, runCommand } from './lib/cli.ts';
import { block, classify, type TokenKind, toHex } from './lib/css-tokens.ts';

export const spec = {
  name: 'elyx',
  summary: 'Generate the Elyx design-system project from _kit/tokens.css, or check it has not drifted.',
  flags: {
    check: { type: 'boolean', description: 'Fail when design-system/ differs from a fresh generation.' },
  },
  output: '{ ok, out, tokens, skipped, diagnostics } or { ok, drift }',
} as const satisfies CommandSpec;

const TOKENS = join(PROTOTYPES, '_kit', 'tokens.css');
const OUT = join(REPO, 'design-system');
const SOURCE = 'prototypes/_kit/tokens.css';

function elyx(cwd: string, args: string[]): string {
  const run = spawnSync('elyx', args, { cwd, encoding: 'utf8' });
  if (run.error)
    throw new CliError('The Elyx CLI is not installed.', { fix: 'npm install --global @elyx-design/cli' });
  if (run.status !== 0)
    throw new CliError(`elyx ${args[0]} failed.`, { stderr: (run.stderr || run.stdout).trim().slice(-800) });
  return run.stdout;
}

const header = (what: string) =>
  `// GENERATED from ${SOURCE}${what} by \`pnpm elyx\`.\n// Do not edit: change tokens.css and run it again.\n`;
const members = (rows: [string, string][]) => rows.map(([n, v]) => `  ${n}: ${v}`).join(',\n');

export function plan(css: string) {
  const light = block(css, ':root');
  const dark = block(css, '.dark-mode');
  const groups: Record<TokenKind, [string, string][]> = { color: [], radius: [], length: [], font: [] };
  const skipped: string[] = [];
  for (const [name, value] of light) {
    const c = classify(name, value);
    if (c.kind === 'skip') skipped.push(`--${name}: ${c.why}`);
    else groups[c.kind].push([name, c.value]);
  }
  const colors = new Set(groups.color.map(([n]) => n));
  const darkColors: [string, string][] = [];
  for (const [name, value] of dark) {
    if (!light.has(name))
      throw new CliError(`--${name} is set in .dark-mode but not on :root.`, {
        fix: 'Give it a light value.',
      });
    if (!colors.has(name)) {
      skipped.push(`--${name} (.dark-mode): not a colour token`);
      continue;
    }
    const hex = toHex(value);
    if (!hex) throw new CliError(`--${name}: the dark value ${value} is not a colour.`);
    darkColors.push([name, hex]);
  }
  const family = groups.font.find(([n]) => n === 'font')?.[1];
  const files: Record<string, string> = {
    // Hex encoding stops Elyx rewriting every colour as rgb() percentages on save.
    'elyx.json': `${JSON.stringify(
      {
        color: { encoding: 'hex' },
        ...(family ? { defaults: { text: { font: { family: JSON.parse(family), style: 'Regular' } } } } : {}),
        exports: { './tokens/*': './tokens/*' },
      },
      null,
      2,
    )}\n`,
    'tokens/colors.elyx': `import "tokens/colors.dark.elyx" as dark\n\n${header('')}file {}\n\n@variants(dark.darkColors)\nexport colors = tokens {\n${members(groups.color)}\n}\n`,
    'tokens/colors.dark.elyx': `import "tokens/colors.elyx" as base\n\n${header(' (.dark-mode)')}@context(theme="dark")\nfile {}\n\nexport darkColors = tokens : base.colors {\n${members(darkColors)}\n}\n`,
  };
  if (groups.radius.length)
    files['tokens/radius.elyx'] =
      `${header('')}file {}\n\nexport radius = tokens {\n${members(groups.radius)}\n}\n`;
  if (groups.length.length)
    files['tokens/lengths.elyx'] =
      `${header('')}file {}\n\nexport lengths = tokens {\n${members(groups.length)}\n}\n`;
  if (groups.font.length)
    files['tokens/typography.elyx'] =
      `${header('')}file {}\n\nexport fonts = tokens {\n${members(groups.font)}\n}\n`;
  return {
    files,
    light,
    dark,
    counts: {
      colors: groups.color.length,
      dark: darkColors.length,
      radius: groups.radius.length,
      lengths: groups.length.length,
      fonts: groups.font.length,
    },
    skipped,
  };
}

const README = `# Design system (generated)

An Elyx token project generated from \`${SOURCE}\` by \`pnpm elyx\`. Never edit it here: change \`tokens.css\` and run \`pnpm elyx\` again. \`pnpm elyx --check\` fails when this folder has drifted.

Use it from a designer's Elyx project as a read-only dependency, so a save in Elyx can never write back:

\`\`\`json
{ "dependencies": { "hub": "path:../design-system" } }
\`\`\`

Then \`elyx deps fetch\`, and \`import "@hub/tokens/colors.elyx"\`. Commit \`elyx.lock\`, ignore \`elyx_deps/\`, and fetch again after each regeneration.

Shadows, focus rings, easings and durations have no Elyx token type and are left out; \`tokens.css\` keeps them.
`;

/** Writes the project into `out`, normalizes it the way the Elyx app saves, and proves it matches tokens.css. */
function generate(out: string) {
  const { files, light, dark, counts, skipped } = plan(readFileSync(TOKENS, 'utf8'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'tokens'), { recursive: true });
  for (const [path, text] of Object.entries(files)) writeFileSync(join(out, path), text);
  writeFileSync(join(out, 'README.md'), README);
  for (const path of Object.keys(files).filter((p) => p.endsWith('.elyx')))
    elyx(out, ['normalize', '-w', path]);
  const diagnostics = JSON.parse(elyx(out, ['diagnostics', '.'])) as { errors?: number };
  if (diagnostics.errors)
    throw new CliError('Elyx reports errors in the generated project.', { diagnostics });
  const problems = roundTrip(out, light, dark);
  if (problems.length) throw new CliError('The Elyx export does not match tokens.css.', { problems });
  return { counts, skipped, diagnostics };
}

const bytes = (hex: string) =>
  [0, 2, 4, 6].map((i) => (i < hex.length - 1 ? Number.parseInt(hex.slice(1 + i, 3 + i), 16) : 255));
function exported(value: string): number[] | null {
  const m = value.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Math.round(Number(m[4] ?? 1) * 255)] : null;
}

type ExportedToken = { name: string; value: string; context: { theme?: string } };

/** A token whose bytes differ from tokens.css, or null when they match or cannot be compared. */
export function mismatch(t: ExportedToken, source: string | undefined): string | null {
  const hex = source ? toHex(source) : null;
  const got = exported(t.value);
  if (!hex || !got || bytes(hex).join() === got.join()) return null;
  return `${t.context.theme === 'dark' ? 'dark' : 'light'} ${t.name}: ${source} became ${t.value}`;
}

/** Colours in tokens.css that the export dropped; Elyx drops what it cannot hold without an error. */
function dropped(theme: string, declared: Map<string, string>, seen: Set<string>): string[] {
  return [...declared]
    .filter(([name, value]) => classify(name, value).kind === 'color' && !seen.has(name))
    .map(([name]) => `${theme} ${name}: missing`);
}

/** Every colour in tokens.css is in the export with the same bytes, in both themes. */
function roundTrip(out: string, light: Map<string, string>, dark: Map<string, string>): string[] {
  const tokens = (
    JSON.parse(elyx(out, ['tokens', 'tokens/colors.elyx', '--format', 'json'])) as { tokens: ExportedToken[] }
  ).tokens;
  const darkTokens = tokens.filter((t) => t.context.theme === 'dark');
  const lightTokens = tokens.filter((t) => t.context.theme !== 'dark');
  return [
    ...lightTokens.map((t) => mismatch(t, light.get(t.name))),
    // A dark token without an override inherits the light value.
    ...darkTokens.map((t) => mismatch(t, dark.get(t.name) ?? light.get(t.name))),
    ...dropped('light', light, new Set(lightTokens.map((t) => t.name))),
    ...dropped('dark', dark, new Set(darkTokens.map((t) => t.name))),
  ].filter((p): p is string => p !== null);
}

const listFiles = (dir: string, base = dir): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory()
          ? d.name === 'elyx_deps'
            ? []
            : listFiles(join(dir, d.name), base)
          : [relative(base, join(dir, d.name))],
      )
    : [];

export function main({ flags }: Args<typeof spec>) {
  if (!flags.check) {
    const result = generate(OUT);
    return {
      out: relative(REPO, OUT),
      tokens: result.counts,
      skipped: result.skipped,
      diagnostics: result.diagnostics,
    };
  }
  const tmp = mkdtempSync(join(tmpdir(), 'hub-elyx-'));
  try {
    generate(tmp);
    const files = new Set([...listFiles(tmp), ...listFiles(OUT)]);
    const drift = [...files].filter((f) => {
      const a = join(tmp, f);
      const b = join(OUT, f);
      return !existsSync(a) || !existsSync(b) || readFileSync(a, 'utf8') !== readFileSync(b, 'utf8');
    });
    return { ok: drift.length === 0, drift, fix: drift.length ? 'pnpm elyx' : undefined };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) await runCommand(spec, main);
