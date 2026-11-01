// The pure parts of the setup app: naming, validation, the arguments handed to
// create-design-hub and bootstrap, and the plain-language version of their errors.
// No I/O here, so every rule is tested without a server or a disk.
import { isAbsolute, join } from 'node:path';
import { slugify } from './slug.mjs';

/** What to do when nothing more specific is known. */
export const FALLBACK_FIX = 'Try again. If it fails twice, send the details to a developer.';

/** Where new projects go unless the person picks another folder. No space in it, so every tool copes. */
export function defaultParent(home) {
  return join(home, 'Design');
}

/** `~/…` for display; the server always works with the absolute path. */
export function tildify(path, home) {
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The PORT line of a project's .env, or null. */
export function readPort(envText) {
  const match = String(envText ?? '').match(/^\s*PORT\s*=\s*"?(\d+)"?\s*$/m);
  return match ? Number(match[1]) : null;
}

/** Where a new project goes: its parent folder joined with the slug of its name. */
export function projectPath({ name, parent } = {}, home) {
  const slug = slugify(name);
  const dir = parent?.trim() || defaultParent(home);
  const errors = {};
  if (!slug) errors.name = 'Use at least one letter or number in the name.';
  if (!isAbsolute(dir)) errors.parent = 'Pick a folder on this computer.';
  return Object.keys(errors).length ? { errors } : { path: join(dir, slug) };
}

/**
 * The create request's own fields: the default when empty, and the rule a
 * filled-in value must meet. An empty optional field is always fine.
 */
const FIELDS = {
  visibility: {
    fallback: 'local',
    valid: /^(local|private|public)$/,
    error: 'Choose this computer or GitHub.',
  },
  owner: { valid: /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, error: 'A GitHub account or organization name.' },
  typesafeKey: { valid: /^[\w.-]{16,}$/, error: 'That does not look like a TypeSafe key.' },
  conductorBranch: { valid: /^[\w./-]+$/, error: 'A branch name, like main.' },
};

/** Checks a create request from the page; returns the clean value or the problems by field. */
export function validateCreate(body, { home }) {
  const b = body ?? {};
  const value = {};
  const errors = {};
  for (const [field, rule] of Object.entries(FIELDS)) {
    const v = String(b[field] ?? '').trim() || rule.fallback;
    if (v && !rule.valid.test(v)) errors[field] = rule.error;
    value[field] = v;
  }
  const target = projectPath(b, home);
  Object.assign(errors, target.errors);
  value.path = target.path;
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** Flags for create-design-hub: the copy only; the install is its own step. `link` is a local design-hub checkout. */
export function createArgs({ path, visibility, owner, link }) {
  const args = ['--path', path, '--visibility', visibility === 'local' ? 'none' : visibility, '--no-install'];
  if (owner && visibility !== 'local') args.push('--owner', owner);
  if (link) args.push('--link', link);
  return args;
}

/** Flags for the bootstrap run: everything but the install, which ran as its own step. */
export function bootstrapArgs({ typesafeKey, conductorBranch }) {
  const args = ['--no-install'];
  if (typesafeKey) args.push('--typesafe-key', typesafeKey);
  if (conductorBranch) args.push('--conductor', '--branch', conductorBranch);
  return args;
}

const PLAIN = [
  [
    /exists and is not empty/,
    'That folder already has files in it.',
    'Pick another name or another place to save it.',
  ],
  [
    /gh is not installed/,
    'GitHub needs the GitHub CLI on this computer.',
    'Keep the project on this computer for now, or ask a developer to install the GitHub CLI.',
  ],
  [
    /gh auth status failed|not logged in/i,
    'You are not signed in to GitHub.',
    'Go back and sign in to GitHub, then try again.',
  ],
  [
    /gh repo failed/,
    'GitHub would not create the repo.',
    'A repo with this name may exist already on that account. Try another name.',
  ],
  [
    /Could not resolve host|unable to access|ERR_PNPM_FETCH|ENOTFOUND/i,
    'Could not download what the project needs.',
    'Check the internet connection, then try again.',
  ],
  [
    /git is not installed|xcrun/i,
    "Apple's developer tools are missing.",
    'Install them from the first screen, then try again.',
  ],
  [
    /pnpm install failed|npx|ERR_PNPM/i,
    'Installing the project failed.',
    'Check the internet connection, then try again. Setup picks up where it stopped.',
  ],
  [
    /No free port/,
    'Every port Design Hub uses is taken.',
    'Close other Design Hub projects, then try again.',
  ],
];

/** A script's `{ ok: false, error, fix? }` in words a non-developer can act on; the raw text stays in `detail`. */
export function explain(result) {
  const raw = [result?.error, result?.stderr].filter(Boolean).join('\n');
  for (const [pattern, message, fix] of PLAIN) if (pattern.test(raw)) return { message, fix, detail: raw };
  return {
    message: result?.error || 'Something went wrong.',
    fix: typeof result?.fix === 'string' ? result.fix : FALLBACK_FIX,
    detail: raw,
  };
}

/** The one-time code and URL `gh auth login --web` prints when it has no terminal. */
export function parseDeviceCode(text) {
  const code = String(text).match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/)?.[1];
  const url = String(text).match(/https:\/\/\S+\/login\/device\S*/)?.[0];
  return code && url ? { code, url } : null;
}

/** Only this machine's own name for the server: blocks DNS rebinding from a web page. */
export function hostAllowed(host, port) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
