/// <reference types="node" />
// The project's .env as key: value pairs, for the scripts and the dev server.
// Vite reads the same file on its own (vite.config.ts). No dotenv:
// the file is a flat list and a dependency for it would be the kind of
// gravity this repo avoids.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ENV_FILE = '.env';

export function readEnv(dir: string): Record<string, string> {
  const file = join(dir, ENV_FILE);
  if (!existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    env[line.slice(0, at).trim()] = line
      .slice(at + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, '$2');
  }
  return env;
}

// Rewrites one key in place and keeps every other line, comments included,
// so a second run changes nothing.
export function writeEnv(dir: string, updates: Record<string, string>): void {
  const file = join(dir, ENV_FILE);
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const pending = { ...updates };
  const next = lines.map((line) => {
    const key = line.match(/^\s*([A-Z0-9_]+)\s*=/)?.[1];
    if (!key || !(key in pending)) return line;
    const value = pending[key];
    delete pending[key];
    return `${key}=${value}`;
  });
  while (next.length && next.at(-1)?.trim() === '') next.pop();
  for (const [key, value] of Object.entries(pending)) next.push(`${key}=${value}`);
  const text = next.join('\n').replace(/\n*$/, '\n');
  writeFileSync(file, text, { mode: 0o600 });
}

/** The variables a harness (Conductor, T3 Code, a script) may hand a worktree its port in, first wins. */
const HARNESS_PORT_VARS = ['DESIGN_HUB_PORT', 'CONDUCTOR_PORT'] as const;

function asPort(value: string | undefined): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

/**
 * The port a harness gave this process, and the variable it came in. A
 * harness owns these ports: they never enter the machine registry. A bare
 * `PORT` is not one: shells and other tools export it for their own servers.
 */
export function harnessPort(
  processEnv: Record<string, string | undefined> = process.env,
): { port: number; from: (typeof HARNESS_PORT_VARS)[number] } | null {
  for (const from of HARNESS_PORT_VARS) {
    const port = asPort(processEnv[from]);
    if (port !== undefined) return { port, from };
  }
  return null;
}

/**
 * The dev server's port: the harness's when one gave it, because its Open
 * button points there; else the PORT in .env, which `design-hub dev` and
 * `design-hub bootstrap` claim for this folder.
 */
export function devPort(
  fileEnv: Record<string, string>,
  processEnv: Record<string, string | undefined> = process.env,
): number | undefined {
  return harnessPort(processEnv)?.port ?? asPort(fileEnv.PORT);
}
