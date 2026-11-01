/// <reference types="node" />
// The Vercel CLI calls the scripts make, in one place. Each returns null when
// the CLI is missing or signed out, so a caller decides whether that is a
// failure (bootstrap --vercel) or a skipped check (preflight).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ENVIRONMENTS = ['production', 'preview'] as const;
export type Target = (typeof ENVIRONMENTS)[number] | 'development';
const GATE_ENV = ['GATE_PASSWORD', 'GATE_SECRET'] as const;
/** What the Upstash for Redis integration injects (Vercel Marketplace). */
export const STORE_ENV = ['KV_REST_API_URL', 'KV_REST_API_TOKEN'] as const;

export type Run = { status: number; stdout: string; stderr: string };

export function vercel(cwd: string, args: string[], input?: string): Run | null {
  const out = spawnSync('vercel', args, { cwd, encoding: 'utf8', input, env: process.env });
  if (out.error) return null;
  return { status: out.status ?? 1, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}

type Link = { projectName?: string; orgId?: string };

function readLink(cwd: string): Link | null {
  const file = join(cwd, '.vercel', 'project.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Link;
  } catch {
    return null;
  }
}

export const linkedProject = (cwd: string): string | null => readLink(cwd)?.projectName ?? null;

/** The team the linked project belongs to. The commands that take a project name instead of the link need it as `--scope`. */
export const linkedOrg = (cwd: string): string | null => readLink(cwd)?.orgId ?? null;

/** The variable names set for a target, read from `vercel env ls`'s table. */
export function envNames(cwd: string, target: Target): Set<string> | null {
  const out = vercel(cwd, ['env', 'ls', target]);
  if (out?.status !== 0) return null;
  return new Set([...out.stdout.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s/gm)].map((m) => m[1]));
}

/** Sets one variable for one target; `force` replaces a value that is already there. */
export function setEnv(cwd: string, name: string, target: Target, value: string, force: boolean): Run | null {
  // The value goes on stdin, never argv, so it stays out of the process list.
  return vercel(cwd, ['env', 'add', name, target, ...(force ? ['--force'] : []), '--yes'], value);
}

/** The gate variables missing from production or preview, or null when the CLI cannot say. */
export function gateEnvMissing(cwd: string): string[] | null {
  const missing: string[] = [];
  for (const target of ENVIRONMENTS) {
    const names = envNames(cwd, target);
    if (!names) return null;
    for (const name of GATE_ENV) if (!names.has(name)) missing.push(`${name}:${target}`);
  }
  return missing;
}
