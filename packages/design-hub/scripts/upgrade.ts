#!/usr/bin/env node
/// <reference types="node" />
// Keeping a project on the newest Design Hub without anyone remembering to.
// The SessionStart hook (`design-hub hook update`) runs this when a Claude
// session opens in the project: it asks npm for `latest` (cached an hour),
// and when that is newer than node_modules it installs it and runs the new
// version's `design-hub skills`, so the session starts on current skills,
// scripts and hooks. It fails open: offline, a slow registry or a failed
// install leaves the session as it was and tells the agent.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readEnv } from '../server/env.ts';
import { ROOT } from '../server/paths.ts';
import type { Args, CommandSpec } from './lib/cli.ts';
import {
  type Cached,
  cachedLatest,
  decide,
  type Facts,
  type Outcome,
  PACKAGE_NAME,
  report,
} from './lib/update.ts';

export const spec = {
  name: 'upgrade',
  summary:
    'Upgrade this project to the newest Design Hub and refresh its skills, scripts and hooks. The SessionStart hook runs it on every new session.',
  flags: {
    check: { type: 'boolean', description: 'Only report whether a newer version exists.' },
  },
  output: '{ ok, installed, latest, decision, outcome? }',
} as const satisfies CommandSpec;

const LOCK_STALE_MS = 10 * 60_000;
const INSTALL_TIMEOUT_MS = 150_000;

const configDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'design-hub');

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function facts(latest: string | null): Facts {
  const pkg = readJson<Record<string, Record<string, string> | undefined>>(join(ROOT, 'package.json'));
  const installed = readJson<{ version?: string }>(join(ROOT, 'node_modules', PACKAGE_NAME, 'package.json'));
  const flag = process.env.DESIGN_HUB_AUTO_UPDATE ?? readEnv(ROOT).DESIGN_HUB_AUTO_UPDATE;
  return {
    spec: pkg?.dependencies?.[PACKAGE_NAME] ?? pkg?.devDependencies?.[PACKAGE_NAME] ?? null,
    installed: installed?.version ?? null,
    latest,
    disabled: flag === '0' || flag === 'false',
  };
}

/** Asks npm for `latest`; null on any failure. */
async function fetchLatest(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? ((await res.json()) as { version: string }).version : null;
  } catch {
    return null;
  }
}

/** npm's `latest`, from a cache shared by every project on the machine unless `fresh`. Null when npm is unreachable. */
async function latestVersion(fresh: boolean): Promise<string | null> {
  const file = join(configDir(), 'latest.json');
  const cached = readJson<Cached>(file);
  const hit = fresh ? null : cachedLatest(cached, Date.now());
  if (hit) return hit;
  const version = await fetchLatest();
  if (!version) return cached?.version ?? null;
  mkdirSync(configDir(), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version, at: Date.now() })}\n`);
  return version;
}

/** One upgrade per project at a time: two sessions opened together must not install over each other. */
function lock(): (() => void) | null {
  const dir = join(configDir(), 'locks');
  const file = join(dir, `${createHash('sha1').update(ROOT).digest('hex').slice(0, 16)}.lock`);
  mkdirSync(dir, { recursive: true });
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs > LOCK_STALE_MS) rmSync(file, { force: true });
  try {
    writeFileSync(file, String(process.pid), { flag: 'wx' });
  } catch {
    return null;
  }
  return () => rmSync(file, { force: true });
}

function dirtyPaths(): Set<string> {
  const out = spawnSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
  if (out.status !== 0) return new Set();
  return new Set(
    out.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3)),
  );
}

function run(cmd: string, argv: string[]): string | null {
  const out = spawnSync(cmd, argv, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: INSTALL_TIMEOUT_MS,
    env: process.env,
  });
  if (out.error) return out.error.message;
  if (out.status !== 0)
    return `${cmd} ${argv[0]} exited ${out.status}: ${(out.stderr || out.stdout).trim().slice(-400)}`;
  return null;
}

/** Installs `to` and runs that version's own `skills`, so the newest skills, scripts and hooks land. */
function install(from: string, to: string): Outcome {
  const before = dirtyPaths();
  const error =
    run('pnpm', ['add', `${PACKAGE_NAME}@^${to}`]) ??
    run(join(ROOT, 'node_modules', '.bin', 'design-hub'), ['skills']);
  if (error) return { kind: 'failed', from, to, error };
  const now = facts(to).installed;
  if (now !== to)
    return { kind: 'failed', from, to, error: `node_modules has ${now ?? 'nothing'} after the install` };
  const changed = [...dirtyPaths()].filter((p) => !before.has(p)).sort();
  return { kind: 'upgraded', from, to, changed };
}

async function attempt(fresh: boolean, checkOnly: boolean) {
  const latest = await latestVersion(fresh);
  const f = facts(latest);
  const decision = decide(f);
  if (checkOnly) return { f, decision, outcome: null };
  if ('skip' in decision) {
    const outcome: Outcome | null =
      decision.available && f.installed
        ? { kind: 'available', from: f.installed, to: decision.available }
        : null;
    return { f, decision, outcome };
  }
  const release = lock();
  if (!release) return { f, decision: { skip: 'another session is upgrading this project' }, outcome: null };
  try {
    return { f, decision, outcome: install(f.installed as string, decision.upgrade) };
  } finally {
    release();
  }
}

/** SessionStart: says nothing unless something changed or is waiting. */
export async function upgradeHook(): Promise<void> {
  const { outcome } = await attempt(false, false);
  if (!outcome) return;
  const { systemMessage, additionalContext } = report(outcome);
  console.log(
    JSON.stringify({
      systemMessage,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
    }),
  );
}

export async function main({ flags }: Args<typeof spec>) {
  const { f, decision, outcome } = await attempt(true, flags.check);
  return {
    ok: outcome?.kind !== 'failed',
    installed: f.installed,
    latest: f.latest,
    decision,
    ...(outcome ? { outcome, ...report(outcome) } : {}),
  };
}
