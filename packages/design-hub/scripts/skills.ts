#!/usr/bin/env node
/// <reference types="node" />
// `design-hub skills`: the project-facing miles-* skills from this package
// into the project's .claude/skills/, replacing what is there. The skills
// ship with the package so a version bump updates them; a project never
// edits its copies. `miles-design-hub` stays out: it starts a project from
// outside one and is installed globally. It also adds the package.json
// scripts a newer version's skills call, since an upgrade never touches the
// project's own files and a skill that runs `pnpm share` needs the script.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_SKILLS, ROOT, SKILLS } from '../server/paths.ts';
import type { Args, CommandSpec } from './lib/cli.ts';
import { withSessionHook } from './lib/update.ts';

export const spec = {
  name: 'skills',
  summary:
    "Install or update the project's miles-* skills from this package into .claude/skills/, add any package.json script they call that the project lacks, and the session-start upgrade hook.",
  flags: {},
  output:
    '{ ok, installed: [name], into, scripts: { added: [name] }, hooks: { sessionStart: added | kept } }',
} as const satisfies CommandSpec;

const GLOBAL_ONLY = new Set(['miles-design-hub']);
/** Skills the package no longer ships, removed from a project on update. miles-conductor became miles-worktrees in 0.2.0. */
const RETIRED = ['miles-conductor'];

export function installSkills(from = PACKAGE_SKILLS, into = SKILLS): string[] {
  const names = readdirSync(from, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('miles-') && !GLOBAL_ONLY.has(d.name))
    .map((d) => d.name)
    .sort();
  mkdirSync(into, { recursive: true });
  for (const name of RETIRED) rmSync(join(into, name), { recursive: true, force: true });
  for (const name of names) {
    const dest = join(into, name);
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    cpSync(join(from, name), dest, { recursive: true });
  }
  return names;
}

/** The scripts a project's package.json carries, as the template writes them. The skills call them by these names. */
export const SCRIPTS: Record<string, string> = {
  dev: 'design-hub dev',
  build: 'design-hub build',
  preview: 'design-hub preview',
  export: 'design-hub export',
  bootstrap: 'design-hub bootstrap',
  new: 'design-hub new',
  tracks: 'design-hub tracks',
  guide: 'design-hub guide',
  check: 'design-hub check',
  fix: 'design-hub check --fix',
  guard: 'design-hub guard',
  preflight: 'design-hub preflight',
  signin: 'design-hub signin',
  share: 'design-hub share',
  comments: 'design-hub comments',
  people: 'design-hub people',
  calibrate: 'design-hub calibrate',
  'fixtures-pull': 'design-hub fixtures-pull',
  'visual-match': 'design-hub visual-match',
  elyx: 'design-hub elyx',
  skills: 'design-hub skills',
  commands: 'design-hub commands',
};

/** Adds each missing script to the project's package.json; a script the project already has is never changed. */
export function addScripts(file = join(ROOT, 'package.json')): string[] {
  if (!existsSync(file)) return [];
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  const added = Object.keys(SCRIPTS).filter((name) => !(name in scripts));
  if (!added.length) return [];
  for (const name of added) scripts[name] = SCRIPTS[name];
  pkg.scripts = scripts;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  return added;
}

/** Adds the SessionStart upgrade hook to .claude/settings.json when it is missing; other hooks are never changed. */
export function addSessionHook(file = join(ROOT, '.claude', 'settings.json')): 'added' | 'kept' {
  const settings = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const next = withSessionHook(settings);
  if (!next) return 'kept';
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return 'added';
}

export function main(_args: Args<typeof spec>) {
  return {
    installed: installSkills(),
    into: SKILLS,
    scripts: { added: addScripts() },
    hooks: { sessionStart: addSessionHook() },
  };
}
