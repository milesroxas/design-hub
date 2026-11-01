#!/usr/bin/env node
/// <reference types="node" />
// The design-hub command line: one binary, one subcommand per file in this
// folder. Every subcommand keeps the contract in lib/cli.ts: flags only, no
// prompts, one JSON object on stdout, `--help` for its schema. `dev`,
// `preview` and `open` are the exceptions: they run a server and print
// Vite's log. `hook <name>` is for Claude Code's settings.json and prints
// hook JSON or nothing.
import * as bootstrap from './bootstrap.ts';
import * as calibrate from './calibrate.ts';
import * as check from './check.ts';
import * as commands from './commands.ts';
import * as comments from './comments.ts';
import * as dev from './dev.ts';
import * as elyx from './elyx.ts';
import * as fixturesPull from './fixtures-pull.ts';
import * as guard from './guard.ts';
import { HOOKS, runHook } from './hook.ts';
import { type CommandSpec, type Result, runCommand } from './lib/cli.ts';
import * as create from './new.ts';
import * as people from './people.ts';
import * as preflight from './preflight.ts';
import * as releaseCheck from './release-check.ts';
import * as skillHint from './skill-hint.ts';
import * as skills from './skills.ts';
import * as visualMatch from './visual-match.ts';

type Command = { spec: CommandSpec; main: (args: any) => Result | Promise<Result> };

// `guide` is `new --guide`; `open` is `dev` with the browser.
const COMMANDS: Record<string, Command> = {
  bootstrap,
  new: create,
  guide: {
    spec: create.spec,
    main: (args) => create.main({ ...args, flags: { ...args.flags, guide: true } }),
  },
  dev,
  open: { spec: dev.openSpec, main: dev.openMain },
  build: { spec: dev.buildSpec, main: dev.build },
  preview: { spec: dev.previewSpec, main: dev.previewBuilt },
  check,
  guard,
  preflight,
  people,
  comments,
  calibrate,
  'fixtures-pull': fixturesPull,
  'visual-match': visualMatch,
  elyx,
  skills,
  'skill-hint': skillHint,
  'release-check': releaseCheck,
  commands,
};

function usage(): void {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: 'Name a command.',
        commands: [...Object.keys(COMMANDS), 'hook'],
        fix: 'design-hub commands lists every schema; design-hub <command> --help prints one.',
      },
      null,
      2,
    ),
  );
}

export async function cli([name, ...rest]: string[]): Promise<void> {
  if (name === 'hook') return HOOKS.includes(rest[0] as (typeof HOOKS)[number]) ? runHook(rest[0]) : usage();
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    usage();
    if (name && name !== '--help' && name !== '-h') process.exitCode = 1;
    return;
  }
  return runCommand(command.spec, command.main, rest);
}

await cli(process.argv.slice(2));
