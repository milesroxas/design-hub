// The review domain: people who may comment on the deployed prototypes, and
// the comments they leave, pinned to a prototype, its state and an element.
// Pure: no I/O, no environment. Every limit and rule lives here once and is
// enforced by the service, whichever adapter (Vercel, Vite dev, the CLI)
// calls it.

import { SLUG } from '../feature.ts';

/** Which side a person is on: the studio that makes the work, or the client it is for. */
export const PERSON_KINDS = ['studio', 'client'] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

/**
 * Who a thread is for. Internal stays inside the studio; client-facing is
 * read by everyone. Fixed when the thread is made: no op changes it.
 */
const AUDIENCES = ['internal', 'client'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** How a comment is triaged: something broken, a design opinion, or the words. */
export const KINDS = ['bug', 'taste', 'copy'] as const;
export type Kind = (typeof KINDS)[number];

/** How long an unused sign-in link lasts. A link signs in one device, then stops working. */
export const LINK_DAYS = 14;

/**
 * How long a person keeps access: three months, six months, or open-ended.
 * The project sets a default; Studio can set it for one person.
 */
export const ACCESS = ['3m', '6m', 'open'] as const;
export type Access = (typeof ACCESS)[number];
/** The project default when none is set. */
export const DEFAULT_ACCESS: Access = '3m';

const ACCESS_MONTHS: Record<Exclude<Access, 'open'>, number> = { '3m': 3, '6m': 6 };

/** When access given at `from` ends, as an ISO time, or null for open-ended. */
export function accessEnd(access: Access, from: Date): string | null {
  if (access === 'open') return null;
  // On the same day of the month, or the target month's last day when it is shorter (30 Nov + 3m is 28 Feb).
  const end = new Date(from.getTime());
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + ACCESS_MONTHS[access]);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end.toISOString();
}

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
  kind: PersonKind;
  /** Always null until email sign-in exists. */
  email: string | null;
  /** When their access ends (ISO time), or null for open-ended. Their sessions end with it. */
  accessEndsAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** Bumped on revoke and on sign out everywhere, which ends every session signed with the old one. */
  epoch: number;
};

/** A one-time sign-in link, stored under the hash of its token and deleted when used. */
export type Link = { person: string; expiresAt: string };

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
  /** The thread's audience. Set on the root when it is made and copied onto every reply; never changed. */
  audience: Audience;
  /**
   * The thread's number on its prototype and audience, from 1, copied onto every reply.
   * Internal and client-facing threads count apart, so a Client's numbers run 1, 2, 3 with no
   * gap where an internal thread sits; `threadLabel` tells the two apart. Never reused, so a
   * deleted thread moves no other number. 0 for a thread stored before numbers existed.
   */
  number: number;
};

/**
 * How a thread is named in words, for a screen reader and an agent: `I2` for internal thread 2,
 * `2` for client-facing thread 2, '' for a thread stored before numbers. The pin, the card
 * and `comments pull` use it, so "fix I2" names one thread. The pin and the card's badge show
 * the bare number; their amber says internal.
 */
export const threadLabel = (c: Pick<Comment, 'audience' | 'number'>): string =>
  !c.number ? '' : c.audience === 'internal' ? `I${c.number}` : String(c.number);

/**
 * A stored comment as the rules read it. A record with no audience, or one
 * that is not a known value, is internal: a missing field never shows a
 * Client anything. A missing or broken number reads as 0, no number.
 */
export function readComment(json: string): Comment {
  const c = JSON.parse(json) as Comment;
  const audience: Audience = c.audience === 'client' ? 'client' : 'internal';
  const number = Number.isInteger(c.number) && c.number > 0 ? c.number : 0;
  return { ...c, audience, number };
}

const isText = (v: unknown) => typeof v === 'string';
const isTextOrNull = (v: unknown) => v === null || typeof v === 'string';

/** What a stored profile must hold to be a person; anything else is no person at all. */
const PROFILE_RULES: [string, (v: unknown) => boolean][] = [
  ['id', (v) => isText(v) && v !== ''],
  ['name', isText],
  ['team', isText],
  ['kind', (v) => PERSON_KINDS.includes(v as PersonKind)],
  ['email', isTextOrNull],
  ['accessEndsAt', isTextOrNull],
  ['createdAt', isText],
];

/** Whether a stored profile (a person without revocation and epoch) is well formed. */
export function isProfile(v: unknown): v is Omit<Person, 'revokedAt' | 'epoch'> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return PROFILE_RULES.every(([key, ok]) => ok(o[key]));
}

/**
 * Whether someone may sign in at `at`: not revoked, and an access end that is
 * open (null) or a parseable time still ahead. An access end that does not
 * parse is no access.
 */
export function hasAccess(p: Pick<Person, 'revokedAt' | 'accessEndsAt'>, at: Date): boolean {
  if (p.revokedAt !== null) return false;
  if (p.accessEndsAt === null) return true;
  const end = Date.parse(p.accessEndsAt);
  return Number.isFinite(end) && end > at.getTime();
}

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

const isAccess = (v: unknown): v is Access => ACCESS.includes(v as Access);
const ACCESS_PROBLEM = `access: one of ${ACCESS.join(', ')}`;

export function checkAccess(input: unknown): Checked<Access> {
  return isAccess(input) ? { ok: true, value: input } : { ok: false, problems: [ACCESS_PROBLEM] };
}

export type PersonInput = Pick<Person, 'name' | 'team' | 'kind'> & { access: Access | null };

export function checkPersonInput(input: unknown): Checked<PersonInput> {
  const i = (input ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const name = text(i.name, 'name', LIMITS.name, problems);
  const team = text(i.team, 'team', LIMITS.team, problems);
  // Most people added are on the client's side; Studio is the deliberate choice.
  const kind = i.kind ?? 'client';
  if (!PERSON_KINDS.includes(kind as PersonKind)) problems.push(`kind: one of ${PERSON_KINDS.join(', ')}`);
  // Absent, the service picks: the project default for a Client, open-ended for Studio.
  const access = i.access ?? null;
  if (access !== null && !isAccess(access)) problems.push(ACCESS_PROBLEM);
  return problems.length
    ? { ok: false, problems }
    : { ok: true, value: { name, team, kind: kind as PersonKind, access: access as Access | null } };
}

/** A new thread's audience as asked: one of AUDIENCES, or null when none is given. */
export function checkAudience(input: unknown): Checked<Audience | null> {
  if (input === undefined || input === null) return { ok: true, value: null };
  return AUDIENCES.includes(input as Audience)
    ? { ok: true, value: input as Audience }
    : { ok: false, problems: [`audience: one of ${AUDIENCES.join(', ')}`] };
}

/** Whose view of the comments is asked for: a person kind, or null for the caller's own. */
export function checkViewAs(input: unknown): Checked<PersonKind | null> {
  if (input === undefined || input === null) return { ok: true, value: null };
  return PERSON_KINDS.includes(input as PersonKind)
    ? { ok: true, value: input as PersonKind }
    : { ok: false, problems: [`viewAs: one of ${PERSON_KINDS.join(', ')}`] };
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
