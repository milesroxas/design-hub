#!/usr/bin/env node
/// <reference types="node" />
// `design-hub commands`: every command's schema in one JSON list, so an agent
// finds what it can run, and with which flags, without reading any source.
// Each schema is the command's own `spec`, the same one its --help prints.
import * as bootstrap from './bootstrap.ts';
import * as calibrate from './calibrate.ts';
import * as check from './check.ts';
import * as comments from './comments.ts';
import * as dev from './dev.ts';
import * as elyx from './elyx.ts';
import * as fixturesPull from './fixtures-pull.ts';
import * as guard from './guard.ts';
import { type CommandSpec, schema } from './lib/cli.ts';
import * as create from './new.ts';
import * as people from './people.ts';
import * as preflight from './preflight.ts';
import * as releaseCheck from './release-check.ts';
import * as skillHint from './skill-hint.ts';
import * as skills from './skills.ts';
import * as visualMatch from './visual-match.ts';

export const spec = {
  name: 'commands',
  summary: "List every command's schema: its flags, arguments and output.",
  flags: {},
  output: '{ ok, commands: [schema] }',
} as const satisfies CommandSpec;

export const COMMANDS: CommandSpec[] = [
  bootstrap.spec,
  dev.spec,
  dev.buildSpec,
  dev.previewSpec,
  dev.openSpec,
  create.spec,
  check.spec,
  guard.spec,
  preflight.spec,
  people.spec,
  comments.spec,
  calibrate.spec,
  fixturesPull.spec,
  visualMatch.spec,
  elyx.spec,
  skills.spec,
  skillHint.spec,
  releaseCheck.spec,
  spec,
];

export const main = () => ({ commands: COMMANDS.map(schema) });
