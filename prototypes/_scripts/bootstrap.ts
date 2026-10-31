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
import { readEnv, writeEnv } from '../_server/env.ts';
import { PROTOTYPES, REPO } from '../_server/paths.ts';
import { type Args, CliError, type CommandSpec, isMain, runCommand } from './lib/cli.ts';
import { holderOf, pickPort, readClaims, writeClaim } from './lib/ports.ts';
import {
  ENVIRONMENTS,
  envNames,
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

function run(cmd: string, argv: string[], cwd = PROTOTYPES): string {
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
    throw new CliError(`Node ${MIN_NODE.join('.')} or newer is needed: the scripts run as TypeScript.`, {
      found: process.versions.node,
      fix: 'Install the current LTS from https://nodejs.org or `brew install node`.',
    });
  return process.versions.node;
}

function choosePort(wanted: number | undefined, current: number | undefined, warnings: string[]): number {
  const conductor = process.env.CONDUCTOR_PORT;
  if (conductor) {
    // Conductor owns its workspace ports; they never go in the machine registry.
    const port = Number(conductor);
    const held = holderOf(port);
    if (held && held.cwd !== PROTOTYPES)
      throw new CliError(`Conductor's port ${port} is taken.`, {
        holder: held,
        fix: 'Stop that server; never use another port.',
      });
    return port;
  }
  const choice = pickPort({ dir: PROTOTYPES, wanted, current, claims: readClaims(), holder: holderOf });
  if (!choice.ok) throw new CliError(choice.error, choice.detail);
  warnings.push(...choice.warnings);
  writeClaim(PROTOTYPES, choice.port);
  return choice.port;
}

function writeLaunch(port: number): void {
  const file = join(REPO, '.claude', 'launch.json');
  const launch = JSON.parse(readFileSync(file, 'utf8')) as {
    configurations: { port?: number; url?: string }[];
  };
  for (const c of launch.configurations) {
    if ('port' in c) c.port = port;
    if (c.url) c.url = c.url.replace(/localhost:\d+/, `localhost:${port}`);
  }
  writeFileSync(file, `${JSON.stringify(launch, null, 2)}\n`);
}

function writeConductor(branch: string, warnings: string[]): 'written' | 'kept' {
  if (!/^[\w./-]+$/.test(branch)) throw new CliError('--branch takes a branch name.', { got: branch });
  const file = join(REPO, '.conductor', 'settings.toml');
  const text = readFileSync(join(PROTOTYPES, '_templates', 'conductor', 'settings.toml'), 'utf8').replaceAll(
    '{{branch}}',
    branch,
  );
  if (existsSync(file)) {
    if (readFileSync(file, 'utf8') !== text)
      warnings.push('.conductor/settings.toml differs from the template; kept as is.');
    return 'kept';
  }
  mkdirSync(join(REPO, '.conductor'), { recursive: true });
  writeFileSync(file, text);
  return 'written';
}

function cli(args: string[], input?: string): string {
  const out = vercel(PROTOTYPES, args, input);
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

function link(project: string, warnings: string[]): 'ran' | 'kept' {
  const current = linkedProject(PROTOTYPES);
  if (current === project) return 'kept';
  if (current) warnings.push(`.vercel/project.json pointed at ${current}; relinked to ${project}.`);
  cli(['link', '--yes', '--project', project]);
  return 'ran';
}

/** Sets each value where it is missing; `rotate` names the ones given again, which replace what is there. */
function ensureEnv(
  values: Record<string, string>,
  rotate: Set<string>,
): Record<string, 'set' | 'kept' | 'rotated'> {
  const state: Record<string, 'set' | 'kept' | 'rotated'> = {};
  for (const target of ENVIRONMENTS) {
    const names = envNames(PROTOTYPES, target);
    if (!names)
      throw new CliError(`vercel env ls ${target} failed.`, { fix: 'vercel login, then run this again.' });
    for (const [name, value] of Object.entries(values)) {
      const key = `${name}:${target}`;
      const exists = names.has(name);
      if (exists && !rotate.has(name)) {
        state[key] = 'kept';
        continue;
      }
      const out = setEnv(PROTOTYPES, name, target, value, exists);
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

function provisionReview(project: string, warnings: string[]) {
  const names = envNames(PROTOTYPES, 'production');
  let store: 'created' | 'kept' = 'kept';
  if (!names || !STORE_ENV.every((n) => names.has(n))) {
    const out = vercel(PROTOTYPES, [
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
    ]);
    if (out?.status !== 0)
      throw new CliError('Could not add the Upstash for Redis store.', {
        stderr: out?.stderr.trim().slice(-600),
        fix: `Ask the user to run \`vercel integration add ${UPSTASH}\` once in their terminal (it accepts the Marketplace terms), then run this again.`,
      });
    store = 'created';
  }
  // The local scripts (pnpm people, pnpm comments) read the same store.
  const values = pullValues('production', STORE_ENV);
  const missing = STORE_ENV.filter((n) => !values[n]);
  if (missing.length)
    warnings.push(
      `Could not read ${missing.join(', ')} back; copy them from the store's page on Vercel into prototypes/.env.`,
    );
  writeEnv(PROTOTYPES, values);
  return { store, local: missing.length ? 'partial' : 'written' };
}

function install(skip: boolean): 'ran' | 'skipped' {
  if (skip) return 'skipped';
  run(
    'pnpm',
    existsSync(join(PROTOTYPES, 'pnpm-lock.yaml')) ? ['install', '--frozen-lockfile'] : ['install'],
  );
  return 'ran';
}

/** The key in use after this run: the one given, else the one already in .env. */
function typesafe(given: string | undefined, current: string | undefined): string {
  if (given === undefined) return current ?? '';
  if (!/^[\w.-]{16,}$/.test(given)) throw new CliError('--typesafe-key does not look like an API key.');
  writeEnv(PROTOTYPES, { TYPESAFE_API_KEY: given });
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
  const linked = link(project, warnings);
  const { password, secret, rotated } = gateValues(flags['gate-password'], env);
  writeEnv(PROTOTYPES, { GATE_PASSWORD: password, GATE_SECRET: secret });
  const values: Record<string, string> = { GATE_PASSWORD: password, GATE_SECRET: secret };
  // Comment triage runs on the server, so with the review store on, the key goes to Vercel too.
  if (flags.review && typesafeKey) values.TYPESAFE_API_KEY = typesafeKey;
  if (rotated) warnings.push('The password changed: every visitor signs in again.');
  const result: Record<string, unknown> = {
    vercel: { project, linked, env: ensureEnv(values, new Set(rotated ? ['GATE_PASSWORD'] : [])) },
    share: { password },
  };
  if (!flags.review) return result;
  warnings.push(
    'Redeploy so the new env reaches the site; then pnpm people invite --name "<you>" --role editor.',
  );
  return { ...result, review: provisionReview(project, warnings) };
}

function envIgnored(warnings: string[]): void {
  try {
    execFileSync('git', ['-C', REPO, 'check-ignore', '-q', 'prototypes/.env']);
  } catch {
    warnings.push(
      'prototypes/.env is not gitignored; it holds secrets. Add `.env` to .gitignore before committing.',
    );
  }
}

export function main({ flags }: Args<typeof spec>) {
  if (flags.review && !flags.vercel) throw new CliError('--review needs --vercel <project>.');
  const warnings: string[] = [];
  const node = checkNode();
  const env = readEnv(PROTOTYPES);
  const port = choosePort(flags.port, env.PORT ? Number(env.PORT) : undefined, warnings);
  writeEnv(PROTOTYPES, { PORT: String(port) });
  writeLaunch(port);
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

if (isMain(import.meta.url)) await runCommand(spec, main);
