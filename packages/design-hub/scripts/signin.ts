#!/usr/bin/env node
/// <reference types="node" />
// Signing in to Vercel without a terminal. `vercel login` is a device sign-in:
// it prints a link, then waits until someone approves it in a browser. This
// starts it in the background and returns the link at once, so the agent sends
// it to the user as one click; `--wait` then blocks until the CLI is signed in.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from '../server/paths.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';
import { deviceLink } from './lib/deploy.ts';
import { whoami } from './lib/vercel.ts';

export const spec = {
  name: 'signin',
  summary:
    'Sign the Vercel CLI in from a link the user clicks. Returns the link at once; --wait blocks until signed in.',
  flags: {
    wait: {
      type: 'number',
      description:
        'Seconds to wait for the user to approve the link. Absent, return the link without waiting.',
    },
  },
  output: '{ ok, signedIn, user? } or { ok, signedIn: false, url, code, next }',
} as const satisfies CommandSpec;

// A device code lasts about fifteen minutes; reuse a pending one for less than that.
const PENDING_MS = 10 * 60_000;
const LINK_TIMEOUT_MS = 20_000;

type Pending = { pid: number; url: string; code: string; at: number };

function stateDir(): string {
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(config, 'design-hub');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPending(file: string): Pending | null {
  if (!existsSync(file)) return null;
  try {
    const p = JSON.parse(readFileSync(file, 'utf8')) as Pending;
    return Date.now() - p.at < PENDING_MS && alive(p.pid) ? p : null;
  } catch {
    return null;
  }
}

/** Starts `vercel login` detached, its output in a log, and reads the link back from the log. */
async function start(): Promise<Pending> {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  const log = join(dir, 'vercel-login.log');
  const fd = openSync(log, 'w');
  const child = spawn('vercel', ['login'], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const failed = new Promise<Error>((resolve) => child.once('error', resolve));
  child.unref();
  const deadline = Date.now() + LINK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const error = await Promise.race([failed, sleep(250).then(() => null)]);
    if (error)
      throw new CliError('The Vercel CLI is not installed.', {
        fix: 'npm i -g vercel, then run this again.',
      });
    const link = deviceLink(readFileSync(log, 'utf8'));
    if (link) return { pid: child.pid ?? 0, ...link, at: Date.now() };
    if (child.exitCode !== null) break;
  }
  throw new CliError('vercel login printed no sign-in link.', {
    log: readFileSync(log, 'utf8').slice(-600),
    fix: 'Ask the user to run `vercel login` in their terminal.',
  });
}

async function waitFor(seconds: number): Promise<string | null> {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const user = whoami(ROOT);
    if (user || Date.now() >= deadline) return user;
    await sleep(2000);
  }
}

export async function main({ flags }: Args<typeof spec>) {
  const user = whoami(ROOT);
  if (user) return { signedIn: true, user };
  const file = join(stateDir(), 'vercel-login.json');
  let pending = readPending(file);
  if (!pending) {
    pending = await start();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(pending)}\n`);
  }
  const link = { url: pending.url, code: pending.code };
  if (flags.wait === undefined)
    return {
      signedIn: false,
      ...link,
      next: 'Send the user the url to approve in their browser, then run design-hub signin --wait 300.',
    };
  const after = await waitFor(flags.wait);
  if (after) return { signedIn: true, user: after };
  return {
    ok: false,
    signedIn: false,
    ...link,
    error: `Not approved within ${flags.wait}s.`,
    fix: 'Check the user opened the url and chose Allow; run design-hub signin --wait again.',
  };
}
