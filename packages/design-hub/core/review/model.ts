// The review domain: people who may comment on the deployed prototypes, and
// the comments they leave, pinned to a prototype, its state and an element.
// Pure: no I/O, no environment. Every limit and rule lives here once and is
// enforced by the service, whichever adapter (Vercel, Vite dev, the CLI)
// calls it.

import { SLUG } from '../feature.ts';

export const ROLES = ['editor', 'reviewer'] as const;
export type Role = (typeof ROLES)[number];

/** How a comment is triaged: something broken, a design opinion, or the words. */
export const KINDS = ['bug', 'taste', 'copy'] as const;
export type Kind = (typeof KINDS)[number];

/** How long an invite link signs its person in before an editor must issue a new one. */
export const INVITE_DAYS = 14;

export const LIMITS = {
  name: 80,
  team: 80,
  body: 4000,
  url: 2000,
  target: 500,
  dialsChars: 8000,
  states: 50,
  stateName: 120,
} as const;

export type Person = {
  id: string;
  name: string;
  /** The group a person belongs to, shown beside their name: the studio, or the client's company. */
  team: string;
  role: Role;
  createdAt: string;
  revokedAt: string | null;
  /** Bumped on revoke and on a new invite, which signs out every session signed with the old one. */
  epoch: number;
};

/** A comment's author as it was when they wrote it, so a revoked person's comments still read. */
export type Author = Pick<Person, 'id' | 'name' | 'team'>;

export type Anchor = {
  prototype: string;
  feature: string;
  /** Path, query and hash when the comment was written: reopening it reopens the state. */
  url: string;
  /** Every dial panel's values by panel name, so the state includes what the dials were set to. */
  dials: Record<string, Record<string, unknown>>;
  /** A CSS selector for the element the pin sits on, or null for the page as a whole. */
  target: string | null;
  /** Where on the target, as fractions of its box. */
  offset: { x: number; y: number } | null;
  viewport: { width: number; height: number };
};

export type Triage = {
  kind: Kind | null;
  /** A row of the prototype README's States table. */
  state: string | null;
  by: 'jev' | 'person';
  confidence: number | null;
};

export type Comment = {
  id: string;
  /** The root comment's id; a root's thread is its own id. */
  thread: string;
  author: Author;
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** Roots only. */
  anchor: Anchor | null;
  status: 'open' | 'resolved';
  resolvedBy: Author | null;
  triage: Triage | null;
};

export const authorOf = (p: Person): Author => ({ id: p.id, name: p.name, team: p.team });
export const isRoot = (c: Comment) => c.thread === c.id;

// Every input from outside goes through one of these checks.

export type Checked<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const text = (v: unknown, path: string, max: number, problems: string[]): string => {
  if (typeof v !== 'string' || !v.trim()) {
    problems.push(`${path}: required`);
    return '';
  }
  const s = v.trim();
  if (s.length > max) problems.push(`${path}: ${max} characters at most`);
  return s;
};

const fraction = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const size = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100_000;

export function checkPersonInput(input: unknown): Checked<Pick<Person, 'name' | 'team' | 'role'>> {
  const i = (input ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const name = text(i.name, 'name', LIMITS.name, problems);
  const team = text(i.team, 'team', LIMITS.team, problems);
  const role = i.role ?? 'reviewer';
  if (!ROLES.includes(role as Role)) problems.push(`role: one of ${ROLES.join(', ')}`);
  return problems.length ? { ok: false, problems } : { ok: true, value: { name, team, role: role as Role } };
}

export function checkBody(body: unknown): Checked<string> {
  const problems: string[] = [];
  const value = text(body, 'body', LIMITS.body, problems);
  return problems.length ? { ok: false, problems } : { ok: true, value };
}

const isSlug = (v: unknown) => typeof v === 'string' && SLUG.test(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** One rule per field: the field, whether a value passes, and what the field must be. */
const ANCHOR_RULES: [keyof Anchor, (v: unknown) => boolean, string][] = [
  ['prototype', isSlug, 'a prototype slug'],
  ['feature', (v) => v === '' || isSlug(v), 'a feature slug or empty'],
  [
    'url',
    (v) => typeof v === 'string' && v.startsWith('/') && v.length <= LIMITS.url,
    `a path starting with /, ${LIMITS.url} characters at most`,
  ],
  [
    'dials',
    (v) => isObject(v) && JSON.stringify(v).length <= LIMITS.dialsChars,
    `an object of panels, ${LIMITS.dialsChars} characters at most`,
  ],
  [
    'target',
    (v) => v === null || (typeof v === 'string' && v.length <= LIMITS.target),
    `a selector, ${LIMITS.target} characters at most, or null`,
  ],
  [
    'offset',
    (v) => v === null || (isObject(v) && fraction(v.x) && fraction(v.y)),
    'x and y from 0 to 1, or null',
  ],
  ['viewport', (v) => isObject(v) && size(v.width) && size(v.height), 'width and height in pixels'],
];

export function checkAnchor(input: unknown): Checked<Anchor> {
  const given = isObject(input) ? input : {};
  // Absent optional fields take their empty form before the rules run.
  const a: Record<string, unknown> = { dials: {}, target: null, offset: null, ...given };
  const problems = ANCHOR_RULES.filter(([key, passes]) => !passes(a[key])).map(
    ([key, , must]) => `anchor.${key}: ${must}`,
  );
  if (problems.length) return { ok: false, problems };
  // Every rule passed, so each field holds its Anchor type.
  const { prototype, feature, url, dials, target, offset, viewport } = a as unknown as Anchor;
  return { ok: true, value: { prototype, feature, url, dials, target, offset, viewport } };
}

/** The README states a client offers for triage: trimmed, capped, de-duplicated. */
export function checkStates(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const names = input
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim().slice(0, LIMITS.stateName));
  return [...new Set(names.filter(Boolean))].slice(0, LIMITS.states);
}

export function checkTriage(
  input: unknown,
  states: string[] | null,
): Checked<Pick<Triage, 'kind' | 'state'>> {
  const t = (input ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const kind = t.kind ?? null;
  if (kind !== null && !KINDS.includes(kind as Kind))
    problems.push(`triage.kind: one of ${KINDS.join(', ')}, or null`);
  const state = t.state ?? null;
  if (
    state !== null &&
    (typeof state !== 'string' || state.length > LIMITS.stateName || (states && !states.includes(state)))
  )
    problems.push('triage.state: a row of the States table, or null');
  return problems.length
    ? { ok: false, problems }
    : { ok: true, value: { kind: kind as Kind | null, state: state as string | null } };
}
