#!/usr/bin/env node
/// <reference types="node" />
// pnpm commands: every script's schema in one JSON list, so an agent finds
// what it can run, and with which flags, without reading any source. Each
// schema is the command's own `spec`, the same one its --help prints.
import * as bootstrap from './bootstrap.ts';
import * as calibrate from './calibrate.ts';
import * as comments from './comments.ts';
import * as elyx from './elyx.ts';
import * as fixturesPull from './fixtures-pull.ts';
import * as guard from './guard.ts';
import { type CommandSpec, isMain, runCommand, schema } from './lib/cli.ts';
import * as create from './new.ts';
import * as people from './people.ts';
import * as preflight from './preflight.ts';
import * as releaseCheck from './release-check.ts';
import * as skillHint from './skill-hint.ts';
import * as visualMatch from './visual-match.ts';

export const COMMANDS: CommandSpec[] = [
  bootstrap,
  create,
  guard,
  preflight,
  people,
  comments,
  calibrate,
  fixturesPull,
  visualMatch,
  elyx,
  skillHint,
  releaseCheck,
].map((m) => m.spec);

export const spec = {
  name: 'commands',
  summary: "List every script's schema: its flags, arguments and output.",
  flags: {},
  output: '{ ok, commands: [schema] }',
} as const satisfies CommandSpec;

if (isMain(import.meta.url)) await runCommand(spec, () => ({ commands: COMMANDS.map(schema) }));
