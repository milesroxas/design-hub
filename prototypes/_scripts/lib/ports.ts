/// <reference types="node" />
// One dev port per project on this machine. A live `lsof` check alone is not
// enough: a project whose server is stopped today still owns its port, and a
// second project handed the same one serves the wrong site the day both run.
// So every project's claim is written to one registry outside any repo, and a
// port is free only when nothing holds it and no other project claims it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// Off the 3000s that Next, Vite examples and most templates default to, so a
// project that never ran bootstrap is unlikely to sit on a hub port.
const PORT_RANGE = [3100, 3999] as const;

/** `$DESIGN_HUB_PORTS`, else `$XDG_CONFIG_HOME/design-hub/ports.json`, else `~/.config/...`. */
function registryFile(): string {
  if (process.env.DESIGN_HUB_PORTS) return process.env.DESIGN_HUB_PORTS;
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(config, 'design-hub', 'ports.json');
}

/** Project folder (absolute) to its port. Claims for folders that no longer exist are dropped. */
export function readClaims(file = registryFile()): Record<string, number> {
  if (!existsSync(file)) return {};
  let raw: { claims?: Record<string, unknown> };
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // Read as empty, the next claim would overwrite every other project's; stop instead.
    throw new Error(
      `${file} is not valid JSON. Fix it, or delete it and run pnpm bootstrap in each project again.`,
    );
  }
  return Object.fromEntries(
    Object.entries(raw.claims ?? {}).filter(
      (entry): entry is [string, number] => Number.isInteger(entry[1]) && existsSync(entry[0]),
    ),
  );
}

/** Records the claim; written to a temp file and renamed, so a crash never leaves half a registry. */
export function writeClaim(dir: string, port: number, file = registryFile()): void {
  const claims = { ...readClaims(file), [dir]: port };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ claims }, null, 2)}\n`);
  renameSync(tmp, file);
}

export type Holder = { pid: number; command: string; cwd: string };

/** The process listening on the port, with its working directory, or null. */
export function holderOf(port: number): Holder | null {
  const out = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'], { encoding: 'utf8' });
  if (out.status !== 0 || !out.stdout) return null;
  const pid = Number(out.stdout.match(/^p(\d+)/m)?.[1]);
  const command = out.stdout.match(/^c(.+)/m)?.[1] ?? '';
  const cwd =
    spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' }).stdout.match(
      /^n(.+)/m,
    )?.[1] ?? '';
  return { pid, command, cwd };
}

export type PortChoice =
  | { ok: true; port: number; warnings: string[] }
  | { ok: false; error: string; detail: Record<string, unknown> };

type PickInput = {
  dir: string;
  wanted?: number;
  current?: number;
  claims: Record<string, number>;
  holder: (port: number) => Holder | null;
  range?: readonly [number, number];
};

type Owners = { claimant: (port: number) => string | null; foreign: (port: number) => Holder | null };

function owners({ dir, claims, holder }: PickInput): Owners {
  return {
    claimant: (port) => Object.entries(claims).find(([d, p]) => p === port && d !== dir)?.[0] ?? null,
    foreign: (port) => {
      const held = holder(port);
      return held && held.cwd !== dir ? held : null;
    },
  };
}

/** A port asked for by name: refused, naming the owner, rather than swapped for another. */
function checkWanted(wanted: number, { claimant, foreign }: Owners): PortChoice {
  if (!Number.isInteger(wanted) || wanted < 1024 || wanted > 65535)
    return { ok: false, error: '--port takes an integer from 1024 to 65535.', detail: { got: wanted } };
  const owner = claimant(wanted);
  if (owner)
    return {
      ok: false,
      error: `Port ${wanted} is claimed by another project.`,
      detail: { port: wanted, claimedBy: owner, fix: 'Pass another --port.' },
    };
  const held = foreign(wanted);
  if (held)
    return {
      ok: false,
      error: `Port ${wanted} is taken.`,
      detail: { port: wanted, holder: held, fix: 'Pass another --port, or stop that server.' },
    };
  return { ok: true, port: wanted, warnings: [] };
}

/** Why the port in .env cannot stay, or null when it can. */
function currentConflict(current: number, { claimant, foreign }: Owners): string | null {
  const owner = claimant(current);
  if (owner) return `Port ${current} from .env is claimed by ${owner}; picked a new one.`;
  const held = foreign(current);
  return held
    ? `Port ${current} from .env is held by pid ${held.pid} (${held.command}) in ${held.cwd}; picked a new one.`
    : null;
}

/**
 * The port for `dir`: the one asked for, else the one it already has, else
 * the first in range nobody holds or claims. Pure apart from `holder`, so the
 * rules are tested without opening sockets.
 */
export function pickPort(input: PickInput): PortChoice {
  const own = owners(input);
  if (input.wanted !== undefined) return checkWanted(input.wanted, own);
  const warnings: string[] = [];
  if (input.current !== undefined) {
    const conflict = currentConflict(input.current, own);
    if (!conflict) return { ok: true, port: input.current, warnings };
    warnings.push(conflict);
  }
  const [from, to] = input.range ?? PORT_RANGE;
  for (let port = from; port <= to; port++)
    if (!own.claimant(port) && !own.foreign(port)) return { ok: true, port, warnings };
  return { ok: false, error: `No free port between ${from} and ${to}.`, detail: {} };
}
