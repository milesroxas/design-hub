#!/usr/bin/env node
/// <reference types="node" />
// `design-hub check`: TypeScript over the project, then Biome. Both binaries
// come with this package, so a project installs neither; Biome runs on the
// package's config, so every project is checked the same way.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PACKAGE, ROOT } from '../server/paths.ts';
import { biomeBin, tscBin } from './lib/bin.ts';
import type { Args, CommandSpec } from './lib/cli.ts';

export const spec = {
  name: 'check',
  summary: 'TypeScript and Biome over the project. Must pass before a change is done.',
  flags: { fix: { type: 'boolean', description: 'Let Biome format and apply its safe fixes first.' } },
  output: '{ ok, types: { ok, output? }, lint: { ok, output? } }',
} as const satisfies CommandSpec;

const BIOME_CONFIG = join(PACKAGE, 'configs', 'biome');

type Run = { ok: boolean; output?: string };

function node(script: string, args: string[]): Run {
  const out = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8' });
  const output = `${out.stdout}${out.stderr}`.trim();
  return out.status === 0 ? { ok: true } : { ok: false, output: output.split('\n').slice(-40).join('\n') };
}

export const typecheck = () => node(tscBin(), ['--noEmit', '-p', ROOT]);

export function lint(fix: boolean): Run {
  return node(biomeBin(), ['check', ...(fix ? ['--write'] : []), '--config-path', BIOME_CONFIG, ROOT]);
}

export function main({ flags }: Args<typeof spec>) {
  const lintRun = lint(flags.fix);
  const types = typecheck();
  return { ok: types.ok && lintRun.ok, types, lint: lintRun };
}
