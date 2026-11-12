#!/usr/bin/env node
/// <reference types="node" />
// `design-hub skills`: the project-facing miles-* skills from this package
// into the project's .claude/skills/, replacing what is there. The skills
// ship with the package so a version bump updates them; a project never
// edits its copies. `miles-design-hub` stays out: it starts a project from
// outside one and is installed globally.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PACKAGE_SKILLS, SKILLS } from '../server/paths.ts';
import type { Args, CommandSpec } from './lib/cli.ts';

export const spec = {
  name: 'skills',
  summary: "Install or update the project's miles-* skills from this package into .claude/skills/.",
  flags: {},
  output: '{ ok, installed: [name], into }',
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

export function main(_args: Args<typeof spec>) {
  return { installed: installSkills(), into: SKILLS };
}
