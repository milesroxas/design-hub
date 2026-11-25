/// <reference types="node" />
// What the session-start upgrade decides, apart from the npm, pnpm and file
// calls that feed it, so every branch is tested: whether a version is newer,
// whether this project upgrades itself at all, the hook entry a project's
// .claude/settings.json carries, and what the agent is told afterwards.

export const PACKAGE_NAME = '@milesroxas/design-hub';

/** `a` is a newer release than `b`. Pre-releases never count: `latest` is what upgrades. */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

export type Cached = { version: string; at: number };
const CACHE_MS = 60 * 60_000;

/** The cached `latest` while it is under an hour old, else null so npm is asked again. */
export const cachedLatest = (cached: Cached | null, now: number): string | null =>
  cached && now - cached.at < CACHE_MS ? cached.version : null;

export type Facts = {
  /** The version spec in the project's package.json, or null when it does not depend on the hub. */
  spec: string | null;
  /** The version in node_modules, or null before an install. */
  installed: string | null;
  /** npm's `latest`, or null when npm could not be reached. */
  latest: string | null;
  /** DESIGN_HUB_AUTO_UPDATE=0 in the environment or the project's .env. */
  disabled: boolean;
};

export type Decision = { upgrade: string } | { skip: string; available?: string };

/**
 * Upgrades only a project that installs the hub from npm: a workspace or a
 * linked checkout (this repo's sample project, a project made with --link) is
 * on the source already.
 */
export function decide(f: Facts): Decision {
  if (!f.spec) return { skip: 'not a Design Hub project' };
  if (/^(workspace|link|file|portal):/.test(f.spec)) return { skip: `linked to a checkout (${f.spec})` };
  if (!f.installed) return { skip: 'not installed yet; pnpm install first' };
  if (!f.latest) return { skip: 'npm not reachable' };
  if (!newer(f.latest, f.installed)) return { skip: 'up to date' };
  if (f.disabled) return { skip: 'DESIGN_HUB_AUTO_UPDATE=0', available: f.latest };
  return { upgrade: f.latest };
}

const HOOK_COMMAND = 'cd "$CLAUDE_PROJECT_DIR" && node_modules/.bin/design-hub hook update';

/** The SessionStart entry: new sessions only, so a resume or a compact never reinstalls mid-work. */
export const SESSION_HOOK = {
  matcher: 'startup',
  hooks: [
    {
      type: 'command',
      command: HOOK_COMMAND,
      timeout: 180,
      statusMessage: 'Checking for a Design Hub update',
    },
  ],
};

type Settings = { hooks?: Record<string, { hooks?: { command?: string }[] }[]> } & Record<string, unknown>;

/** Adds the SessionStart hook when no entry runs it yet; every other hook stays as it is. Null when nothing changes. */
export function withSessionHook(settings: Settings): Settings | null {
  const start = settings.hooks?.SessionStart ?? [];
  if (start.some((e) => e.hooks?.some((h) => h.command?.includes('design-hub hook update')))) return null;
  return { ...settings, hooks: { ...settings.hooks, SessionStart: [...start, SESSION_HOOK] } };
}

export type Outcome =
  | { kind: 'upgraded'; from: string; to: string; changed: string[] }
  | { kind: 'failed'; from: string; to: string; error: string }
  | { kind: 'available'; from: string; to: string };

const MANUAL = `pnpm add ${PACKAGE_NAME}@latest && pnpm skills`;

/** The hook's output: one line for the user, the context the agent acts on. */
export function report(o: Outcome): { systemMessage: string; additionalContext: string } {
  if (o.kind === 'upgraded')
    return {
      systemMessage: `Design Hub upgraded ${o.from} to ${o.to}.`,
      additionalContext:
        `Design Hub was upgraded from ${o.from} to ${o.to} when this session started; its skills and scripts are current. ` +
        `Tell the user in one line. Files it changed: ${o.changed.length ? o.changed.join(', ') : 'none'}. ` +
        `They are not committed: include them in the next commit the user asks for, as their own commit "Upgrade Design Hub to ${o.to}". ` +
        'If a miles-* skill you load reads as older than this, the user can run /reload-skills.',
    };
  if (o.kind === 'failed')
    return {
      systemMessage: `Design Hub ${o.to} is available; the automatic upgrade failed.`,
      additionalContext:
        `Design Hub ${o.to} is available (installed: ${o.from}), but the upgrade at session start failed: ${o.error}. ` +
        `Tell the user in one line, and offer to run \`${MANUAL}\` once the cause is fixed.`,
    };
  return {
    systemMessage: `Design Hub ${o.to} is available (installed: ${o.from}); automatic upgrades are off.`,
    additionalContext: `Design Hub ${o.to} is available; this project has ${o.from} and DESIGN_HUB_AUTO_UPDATE=0. Mention it once; upgrade with \`${MANUAL}\` only if the user asks.`,
  };
}
