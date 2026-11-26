/// <reference types="node" />
// The Vercel CLI calls the scripts make, in one place. Each returns null when
// the CLI is missing or signed out, so a caller decides whether that is a
// failure (bootstrap --vercel) or a skipped check (preflight).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectInfo } from './deploy.ts';

export const ENVIRONMENTS = ['production', 'preview'] as const;
export type Target = (typeof ENVIRONMENTS)[number] | 'development';
/** What the gate needs: the secret that signs each person's session. */
const GATE_ENV = ['GATE_SECRET'] as const;
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

/** Adds one variable for one target that does not have it yet. */
export function setEnv(cwd: string, name: string, target: Target, value: string): Run | null {
  // The value goes on stdin, never argv, so it stays out of the process list.
  return vercel(cwd, ['env', 'add', name, target, '--yes'], value);
}

/** The Upstash console's names for the same store; server/upstash.ts reads either pair. */
const UPSTASH_ENV = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;

/**
 * What the gate needs that a target lacks, as `NAME:target`: the secret, and
 * the review store, without which nobody can sign in, since it keeps the
 * people and their links. Null when a target's names could not be read.
 */
export function missingGateEnv(
  names: Record<(typeof ENVIRONMENTS)[number], Set<string> | null>,
): string[] | null {
  const missing: string[] = [];
  for (const target of ENVIRONMENTS) {
    const have = names[target];
    if (!have) return null;
    for (const name of GATE_ENV) if (!have.has(name)) missing.push(`${name}:${target}`);
    const store = [STORE_ENV, UPSTASH_ENV].some((pair) => pair.every((n) => have.has(n)));
    if (!store) missing.push(...STORE_ENV.filter((n) => !have.has(n)).map((n) => `${n}:${target}`));
  }
  return missing;
}

/** The gate variables missing from production or preview, or null when the CLI cannot say. */
export function gateEnvMissing(cwd: string): string[] | null {
  return missingGateEnv({ production: envNames(cwd, 'production'), preview: envNames(cwd, 'preview') });
}

/** The signed-in account, or null when the CLI is missing or signed out. */
export function whoami(cwd: string): string | null {
  const out = vercel(cwd, ['whoami']);
  if (out?.status !== 0) return null;
  return out.stdout.trim().split('\n').pop()?.trim() || null;
}

/** `GET /v9/projects/<name>` through the CLI's own credentials, or null when it fails. */
export function projectInfo(cwd: string, project: string, scope: string | null): ProjectInfo | null {
  const out = vercel(cwd, [
    'api',
    `/v9/projects/${encodeURIComponent(project)}`,
    '--raw',
    ...(scope ? ['--scope', scope] : []),
  ]);
  if (out?.status !== 0) return null;
  try {
    return JSON.parse(out.stdout) as ProjectInfo;
  } catch {
    return null;
  }
}
