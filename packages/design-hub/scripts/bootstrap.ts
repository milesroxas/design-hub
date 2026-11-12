#!/usr/bin/env node
/// <reference types="node" />
// The mechanical setup of a project: what a prose step would skip or
// improvise on some runs, where the failure is silent (a port another project
// owns, a missing env var). Judgment stays in the skills.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harnessPort, readEnv, writeEnv } from '../server/env.ts';
import { ROOT, TEMPLATES } from '../server/paths.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';
import { holderOf, pickPort, readClaims, writeClaim } from './lib/ports.ts';
import {
  ENVIRONMENTS,
  envNames,
  linkedOrg,
  linkedProject,
  STORE_ENV,
  setEnv,
  type Target,
  vercel,
} from './lib/vercel.ts';

export const spec = {
  name: 'bootstrap',
  summary: 'Set the project up on this machine, and optionally on Vercel. Safe to run again.',
  flags: {
    port: {
      type: 'number',
      description: 'Use this port. Refused when another process holds it or another project claims it.',
    },
    'no-install': { type: 'boolean', description: 'Skip pnpm install.' },
    'typesafe-key': { type: 'string', description: "Turn TypeSafe's Jev checks on with this API key." },
    conductor: { type: 'boolean', description: 'Write .conductor/settings.toml for Conductor workspaces.' },
    branch: { type: 'string', default: 'main', description: 'The branch Conductor workspaces land on.' },
    vercel: { type: 'string', description: 'Link this Vercel project and set the password gate env on it.' },
    team: {
      type: 'string',
      description:
        'The Vercel team (its slug) the project lives in or is created in. Absent, the CLI’s current team.',
    },
    'gate-password': {
      type: 'string',
      description: 'The share password (8+ characters). Given again, it rotates.',
    },
    review: {
      type: 'boolean',
      description: 'Provision the review store (Upstash Redis) on the Vercel project.',
    },
  },
  output: '{ ok, node, port, install, typesafe, conductor?, vercel?, share?, review?, warnings }',
} as const satisfies CommandSpec;

const MIN_NODE = [22, 18] as const;
const UPSTASH = 'upstash/upstash-kv';

function run(cmd: string, argv: string[], cwd = ROOT): string {
  const out = spawnSync(cmd, argv, { cwd, encoding: 'utf8', env: process.env });
  if (out.error) throw new CliError(`${cmd} is not installed.`, { command: [cmd, ...argv].join(' ') });
  if (out.status !== 0)
    throw new CliError(`${cmd} ${argv[0]} failed.`, {
      command: [cmd, ...argv].join(' '),
      stderr: out.stderr.trim(),
    });
  return out.stdout;
}

function checkNode(): string {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1]))
    throw new CliError(`Node ${MIN_NODE.join('.')} or newer is needed.`, {
      found: process.versions.node,
      fix: 'Install the current LTS from https://nodejs.org or `brew install node`.',
    });
  return process.versions.node;
}

function choosePort(wanted: number | undefined, current: number | undefined, warnings: string[]): number {
  const harness = harnessPort();
  if (harness) {
    // The harness owns its worktree ports; they never go in the machine registry.
    const held = holderOf(harness.port);
    if (held && held.cwd !== ROOT)
      throw new CliError(`Port ${harness.port} from $${harness.from} is taken.`, {
        holder: held,
        fix: 'Stop that server; never use another port.',
      });
    return harness.port;
  }
  const choice = pickPort({ dir: ROOT, wanted, current, claims: readClaims(), holder: holderOf });
  if (!choice.ok) throw new CliError(choice.error, choice.detail);
  warnings.push(...choice.warnings);
  writeClaim(ROOT, choice.port);
  return choice.port;
}

/** Settles the port and records it where the dev server and the preview tools read it. */
function settlePort(wanted: number | undefined, current: number | undefined, warnings: string[]): number {
  const port = choosePort(wanted, current, warnings);
  // A harness port belongs to that run; .env keeps the folder's own claim.
  if (!harnessPort()) writeEnv(ROOT, { PORT: String(port) });
  writeLaunch(port);
  return port;
}

function envPort(env: Record<string, string>): number | undefined {
  return env.PORT ? Number(env.PORT) : undefined;
}

/**
 * What `design-hub dev`, `open` and `preview` run first, so a fresh clone or
 * worktree starts in any harness without a bootstrap: the harness's port when
 * it gave one, else this folder's claim, else a free port claimed now. A .env
 * copied from another checkout carries that checkout's claim, so this folder
 * gets its own. `claimed` is true when the port is new.
 */
export function ensurePort(): { port: number; claimed: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const harness = harnessPort();
  if (harness) return { port: harness.port, claimed: false, warnings };
  const current = envPort(readEnv(ROOT));
  if (current !== undefined && readClaims()[ROOT] === current)
    return { port: current, claimed: false, warnings };
  const port = settlePort(undefined, current, warnings);
  return { port, claimed: port !== current, warnings };
}

type Launch = {
  version: string;
  configurations: {
    name: string;
    runtimeExecutable?: string;
    runtimeArgs?: string[];
    port?: number;
    url?: string;
  }[];
};

/** Claude Code's preview servers for this folder: start the hub, or attach to one already running. */
function defaultLaunch(port: number): Launch {
  return {
    version: '0.0.1',
    configurations: [
      { name: 'prototypes', runtimeExecutable: 'pnpm', runtimeArgs: ['dev'], port },
      { name: 'prototypes-attach', url: `http://localhost:${port}`, port },
    ],
  };
}

/**
 * Keeps .claude/launch.json on this folder's port, writing it when missing.
 * It is per folder like .env, and gitignored, so worktrees never conflict on it.
 */
function writeLaunch(port: number): void {
  const file = join(ROOT, '.claude', 'launch.json');
  if (!existsSync(file)) {
    mkdirSync(join(ROOT, '.claude'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(defaultLaunch(port), null, 2)}\n`);
    return;
  }
  const launch = JSON.parse(readFileSync(file, 'utf8')) as Launch;
  for (const c of launch.configurations) {
    if ('port' in c) c.port = port;
    if (c.url) c.url = c.url.replace(/localhost:\d+/, `localhost:${port}`);
  }
  writeFileSync(file, `${JSON.stringify(launch, null, 2)}\n`);
}

function writeConductor(branch: string, warnings: string[]): 'written' | 'kept' {
  if (!/^[\w./-]+$/.test(branch)) throw new CliError('--branch takes a branch name.', { got: branch });
  const file = join(ROOT, '.conductor', 'settings.toml');
  const text = readFileSync(join(TEMPLATES, 'conductor', 'settings.toml'), 'utf8').replaceAll(
    '{{branch}}',
    branch,
  );
  if (existsSync(file)) {
    if (readFileSync(file, 'utf8') !== text)
      warnings.push('.conductor/settings.toml differs from the template; kept as is.');
    return 'kept';
  }
  mkdirSync(join(ROOT, '.conductor'), { recursive: true });
  writeFileSync(file, text);
  return 'written';
}

function cli(args: string[], input?: string): string {
  const out = vercel(ROOT, args, input);
  if (!out)
    throw new CliError('The Vercel CLI is not installed.', { fix: 'npm i -g vercel, then vercel login.' });
  if (out.status !== 0)
    throw new CliError(`vercel ${args.slice(0, 2).join(' ')} failed.`, {
      stderr: out.stderr.trim().slice(-600),
      fix: /log ?in|credentials|token/i.test(out.stderr)
        ? 'Ask the user to run `vercel login` in their terminal.'
        : undefined,
    });
  return out.stdout;
}

function link(project: string, team: string | undefined, warnings: string[]): 'ran' | 'kept' {
  const current = linkedProject(ROOT);
  if (current === project) return 'kept';
  if (current) warnings.push(`.vercel/project.json pointed at ${current}; relinked to ${project}.`);
  // A new project is created in the scope given; without one the CLI's current team wins, which
  // is whichever team the user last switched to, not necessarily where this project belongs.
  cli(['link', '--yes', '--project', project, ...(team ? ['--scope', team] : [])]);
  return 'ran';
}

/** Sets each value where it is missing; `rotate` names the ones given again, which replace what is there. */
function ensureEnv(
  values: Record<string, string>,
  rotate: Set<string>,
): Record<string, 'set' | 'kept' | 'rotated'> {
  const state: Record<string, 'set' | 'kept' | 'rotated'> = {};
  for (const target of ENVIRONMENTS) {
    const names = envNames(ROOT, target);
    if (!names)
      throw new CliError(`vercel env ls ${target} failed.`, { fix: 'vercel login, then run this again.' });
    for (const [name, value] of Object.entries(values)) {
      const key = `${name}:${target}`;
      const exists = names.has(name);
      if (exists && !rotate.has(name)) {
        state[key] = 'kept';
        continue;
      }
      const out = setEnv(ROOT, name, target, value, exists);
      if (out?.status !== 0)
        throw new CliError(`vercel env add ${name} ${target} failed.`, { stderr: out?.stderr.trim() });
      state[key] = exists ? 'rotated' : 'set';
    }
  }
  return state;
}

// A password a reviewer can type from a message: lowercase letters and digits, no look-alikes.
function readablePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(12), (b) => alphabet[b % alphabet.length]).join('');
}

/** Reads one environment's values into memory and deletes the file, keeping only `names`. */
function pullValues(target: Target, names: readonly string[]): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'hub-env-'));
  try {
    const file = join(dir, '.env');
    cli(['env', 'pull', file, `--environment=${target}`, '--yes']);
    const pulled = readEnv(dir);
    return Object.fromEntries(names.filter((n) => pulled[n]).map((n) => [n, pulled[n]]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `--scope` for the commands that name the project instead of reading the link. */
const scopeArgs = (team: string | undefined) => {
  const scope = team ?? linkedOrg(ROOT);
  return scope ? ['--scope', scope] : [];
};

/**
 * Vercel Authentication is on for every new project on a team, and it sends each
 * visitor to a Vercel login before the gate. The gate is the protection, so it goes
 * off. Idempotent: disabling twice is fine.
 */
function protection(project: string, team: string | undefined): 'off' {
  cli(['project', 'protection', 'disable', project, '--sso', ...scopeArgs(team)]);
  return 'off';
}

function provisionReview(project: string, team: string | undefined, warnings: string[]) {
  const names = envNames(ROOT, 'production');
  let store: 'created' | 'kept' = 'kept';
  if (!names || !STORE_ENV.every((n) => names.has(n))) {
    const out = vercel(ROOT, [
      'integration',
      'add',
      UPSTASH,
      '--name',
      `${project}-review`,
      '-e',
      'production',
      '-e',
      'preview',
      '-e',
      'development',
      '--no-env-pull',
      // Unlike env and deploy, this command ignores the project link and takes the CLI's current team.
      ...scopeArgs(team),
    ]);
    if (out?.status !== 0)
      throw new CliError('Could not add the Upstash for Redis store.', {
        stderr: out?.stderr.trim().slice(-600),
        fix: `Ask the user to run \`vercel integration add ${UPSTASH}\` once in their terminal (it accepts the Marketplace terms), then run this again.`,
      });
    store = 'created';
  }
  // The local commands (design-hub people, design-hub comments) read the same store.
  const values = pullValues('production', STORE_ENV);
  const missing = STORE_ENV.filter((n) => !values[n]);
  if (missing.length)
    warnings.push(
      `Could not read ${missing.join(', ')} back; copy them from the store's page on Vercel into .env.`,
    );
  writeEnv(ROOT, values);
  return { store, local: missing.length ? 'partial' : 'written' };
}

function install(skip: boolean): 'ran' | 'skipped' {
  if (skip) return 'skipped';
  run('pnpm', existsSync(join(ROOT, 'pnpm-lock.yaml')) ? ['install', '--frozen-lockfile'] : ['install']);
  return 'ran';
}

/** The key in use after this run: the one given, else the one already in .env. */
function typesafe(given: string | undefined, current: string | undefined): string {
  if (given === undefined) return current ?? '';
  if (!/^[\w.-]{16,}$/.test(given)) throw new CliError('--typesafe-key does not look like an API key.');
  writeEnv(ROOT, { TYPESAFE_API_KEY: given });
  return given;
}

/** The gate's values: the password given, kept, or made, and the secret kept or made. */
export function gateValues(given: string | undefined, env: Record<string, string>) {
  const password = given ?? env.GATE_PASSWORD ?? readablePassword();
  if (password.length < 8) throw new CliError('--gate-password needs 8 characters or more.');
  const secret = env.GATE_SECRET || randomBytes(32).toString('base64');
  return { password, secret, rotated: given !== undefined && given !== env.GATE_PASSWORD };
}

function setUpVercel(
  project: string,
  flags: Args<typeof spec>['flags'],
  env: Record<string, string>,
  typesafeKey: string,
  warnings: string[],
) {
  const linked = link(project, flags.team, warnings);
  const { password, secret, rotated } = gateValues(flags['gate-password'], env);
  writeEnv(ROOT, { GATE_PASSWORD: password, GATE_SECRET: secret });
  const values: Record<string, string> = { GATE_PASSWORD: password, GATE_SECRET: secret };
  // Comment triage runs on the server, so with the review store on, the key goes to Vercel too.
  if (flags.review && typesafeKey) values.TYPESAFE_API_KEY = typesafeKey;
  if (rotated) warnings.push('The password changed: every visitor signs in again.');
  const result: Record<string, unknown> = {
    vercel: {
      project,
      linked,
      protection: protection(project, flags.team),
      env: ensureEnv(values, new Set(rotated ? ['GATE_PASSWORD'] : [])),
    },
    share: { password },
  };
  if (!flags.review) return result;
  warnings.push(
    'Redeploy so the new env reaches the site; then design-hub people invite --name "<you>" --role editor.',
  );
  return { ...result, review: provisionReview(project, flags.team, warnings) };
}

function envIgnored(warnings: string[]): void {
  try {
    execFileSync('git', ['-C', ROOT, 'check-ignore', '-q', '.env']);
  } catch {
    warnings.push('.env is not gitignored; it holds secrets. Add `.env` to .gitignore before committing.');
  }
  // Projects made before 0.2.0 committed it; each worktree then rewrites a tracked file.
  const tracked = spawnSync('git', ['-C', ROOT, 'ls-files', '--error-unmatch', '.claude/launch.json'], {
    stdio: 'ignore',
  });
  if (tracked.status === 0)
    warnings.push(
      '.claude/launch.json is committed but holds this folder’s port. Run `git rm --cached .claude/launch.json` and add it to .gitignore.',
    );
}

export function main({ flags }: Args<typeof spec>) {
  if (flags.review && !flags.vercel) throw new CliError('--review needs --vercel <project>.');
  const warnings: string[] = [];
  const node = checkNode();
  const env = readEnv(ROOT);
  const port = settlePort(flags.port, envPort(env), warnings);
  const installed = install(flags['no-install']);
  const typesafeKey = typesafe(flags['typesafe-key'], env.TYPESAFE_API_KEY);
  const result: Record<string, unknown> = {
    node,
    port,
    install: installed,
    typesafe: typesafeKey ? 'on' : 'off',
  };
  if (flags.conductor) result.conductor = writeConductor(flags.branch, warnings);
  if (flags.vercel) Object.assign(result, setUpVercel(flags.vercel, flags, env, typesafeKey, warnings));
  envIgnored(warnings);
  return { ...result, warnings };
}
