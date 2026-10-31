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

/**
 * The dev server's port. Inside a Conductor workspace, Conductor's own port
 * wins, because its Open button always points there; everywhere else it is
 * the PORT that `pnpm bootstrap` wrote to .env.
 */
export function devPort(
  fileEnv: Record<string, string>,
  processEnv: Record<string, string | undefined> = process.env,
): number | undefined {
  const port = Number(processEnv.CONDUCTOR_PORT || fileEnv.PORT);
  return Number.isInteger(port) && port > 0 ? port : undefined;
}
