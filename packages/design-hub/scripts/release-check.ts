#!/usr/bin/env node
/// <reference types="node" />
// The gate before a repo is published: no tracked file may contain a
// term from the list, case-insensitive (a client's name, a person's name).
// Tracked means `git ls-files`, so an untracked plan never trips it and a
// gitignored secret never hides a hit. It also runs a real cold
// `design-hub export` (scripts/lib/export-smoke.ts), which `pnpm test`
// skips on a machine without Chrome: here no Chrome is a failure.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../server/paths.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';
import { exportSmoke } from './lib/export-smoke.ts';

export const spec = {
  name: 'release-check',
  summary: 'Fail when any tracked file contains one of the given terms.',
  flags: { term: { type: 'list', description: 'A term to refuse, case-insensitive. Repeat for more.' } },
  output: '{ ok, terms, files, hits: { <file>: [terms] }, export: { ran, files | reason } }',
} as const satisfies CommandSpec;

export async function main({ flags }: Args<typeof spec>) {
  const terms = flags.term.map((t) => t.toLowerCase()).filter(Boolean);
  if (!terms.length) throw new CliError('Give at least one --term.');
  const files = execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const hits: Record<string, string[]> = {};
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), 'utf8').toLowerCase();
    } catch {
      continue;
    }
    const found = terms.filter((t) => text.includes(t));
    if (found.length) hits[file] = found;
  }
  // The entry this process runs (scripts/cli.ts or dist/scripts/cli.js) exports the same way a project does.
  const exported = await exportSmoke(process.argv[1]);
  const ok = Object.keys(hits).length === 0 && exported.ran;
  return {
    ok,
    terms,
    files: files.length,
    hits,
    export: exported,
    ...(exported.ran ? {} : { fix: `Install Chrome, or set CHROME_PATH: ${exported.reason}` }),
  };
}
