// The review use cases over the storage port. Every adapter (the Vercel
// function, the Vite dev server, the CLI) builds one of these and calls it;
// none of them touches the store directly, so the rules in model.ts and
// policy.ts hold everywhere. Writes are per record (one hash field per
// person, per comment), so two people commenting at once never collide;
// two edits of the same comment at once keep the last.
//
// Every method takes the Scope it runs in first, and every key it reads or
// writes is built from that scope (keyOf in store.ts). A person outside the
// scope gets the answer an unknown id gets, never forbidden, so no answer
// says what another client holds.
import { base64url, hex, sha256 } from '../bytes.ts';
import { type ControlKind, controlField, type Marks, readMarks } from '../controls.ts';
import { isPrototypeSlug } from '../prototype.ts';
import {
  type Access,
  type Anchor,
  type Audience,
  accessEnd,
  authorOf,
  type Checked,
  type Comment,
  checkAccess,
  checkAnchor,
  checkAudience,
  checkBody,
  checkControl,
  checkPersonInput,
  checkPrototypeAudience,
  checkStates,
  checkTriage,
  checkViewAs,
  DEFAULT_ACCESS,
  hasAccess,
  isProfile,
  isRoot,
  LINK_DAYS,
  type Link,
  type Person,
  type PersonKind,
  type Profile,
  readComment,
  type Scope,
  type Triage,
} from './model.ts';
import { type Action, audienceFor, can, inScope, viewOf, visibleTo } from './policy.ts';
import { type KV, keyOf } from './store.ts';

export type ErrorCode = 'unauthorized' | 'forbidden' | 'not_found' | 'invalid';

export class ReviewError extends Error {
  code: ErrorCode;
  problems: string[];
  constructor(code: ErrorCode, message: string, problems: string[] = []) {
    super(message);
    this.code = code;
    this.problems = problems;
  }
}

export type TriageInput = { body: string; prototype: string; url: string; states: string[] };
/** Classifies a new comment; null when it cannot (TypeSafe off, slow, unsure). */
export type Triager = (input: TriageInput) => Promise<Triage | null>;

export type Deps = {
  now: () => Date;
  random: (bytes: number) => Uint8Array;
  triage: Triager | null;
};

const DAY_MS = 86_400_000;

const defaults: Deps = {
  now: () => new Date(),
  random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  triage: null,
};

/** What a link's token looks like: 32 random bytes, base64url. Anything else is never looked up. */
const LINK_TOKEN = /^[\w-]{20,100}$/;
const linkKey = async (token: string) => hex(await sha256(token));

/** What an op answers when what it names is not there, or is outside the actor's scope. */
const NO_COMMENT = 'No such comment.';
const NO_PERSON = 'No such person.';
const NO_PROTOTYPE = 'No such prototype.';

/**
 * Where a person's records live: Studio's with the studio, a Client's with
 * their client. A scope reaches its own client's people and the studio's.
 */
type Home = 'studio' | Scope;
const homeOf = ({ client }: Pick<Person, 'client'>): Home => (client === null ? 'studio' : { client });

/** A person and a new one-time link's token for them. */
type Issued = { person: Person; token: string };

export function createReview(kv: KV, overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };
  const now = () => deps.now().toISOString();
  // Sortable by time, unique without coordination.
  const newId = () => `${deps.now().getTime().toString(36).padStart(9, '0')}${hex(deps.random(5))}`;

  const parse = <T>(json: string | null): T | null => (json === null ? null : (JSON.parse(json) as T));
  /** A stored value that may not be JSON at all: null rather than a throw. */
  const safeParse = (json: string | null): unknown => {
    try {
      return json === null ? null : JSON.parse(json);
    } catch {
      return null;
    }
  };

  /**
   * The first check of every op with an actor: signed in, then in scope, then
   * allowed. Out of scope answers `missing`, what the op answers an unknown
   * id, so it never tells a Client whether another client holds anything.
   */
  function allow(
    scope: Scope,
    actor: Person | null,
    action: Action,
    missing: string,
  ): asserts actor is Person {
    if (!actor) throw new ReviewError('unauthorized', 'Sign in with your link to do that.');
    if (!inScope(actor, scope)) throw new ReviewError('not_found', missing);
    permit(scope, actor, action);
  }

  /** Whether the actor may act on this thread, or on `subject`, a reply in it. */
  function permit(scope: Scope, actor: Person, action: Action, root?: Comment, subject?: Comment): void {
    if (!can(actor, scope, action, root, subject)) throw new ReviewError('forbidden', 'You cannot do that.');
  }

  function valid<T>(checked: Checked<T>): T {
    if (!checked.ok) throw new ReviewError('invalid', 'Some fields are not valid.', checked.problems);
    return checked.value;
  }

  // Every field checked before any throws, so one save names every problem.
  function validAll<T extends unknown[]>(...checks: { [K in keyof T]: Checked<T[K]> }): T {
    const problems = checks.flatMap((c) => (c.ok ? [] : c.problems));
    if (problems.length) throw new ReviewError('invalid', 'Some fields are not valid.', problems);
    return checks.map((c) => (c as { value: unknown }).value) as T;
  }

  // A person is three records. The profile (`people`) is read-modify-write, so
  // a stale write of it can land after anything. Revocation and the epoch live
  // outside it: revocation is written once and never cleared, the epoch only
  // rises (HINCRBY), so no profile write, however stale, can revive a session.
  // A person's client is where the three live, never a field anyone writes.
  const compose = (
    home: Home,
    json: string | null,
    revoked: string | null | undefined,
    epoch: string | null | undefined,
  ): Person | null => {
    const profile = safeParse(json);
    if (!isProfile(profile)) return null;
    // Studio lives with the studio and a Client with their client: a profile anywhere else is no person.
    if ((profile.kind === 'studio') !== (home === 'studio')) return null;
    // Any revocation record means revoked, an empty one included: it reads as the start of time.
    const revokedAt = revoked == null ? null : revoked || new Date(0).toISOString();
    const client = home === 'studio' ? null : home.client;
    return { ...profile, client, revokedAt, epoch: Number(epoch ?? 0) };
  };
  const personAt = async (home: Home, id: string): Promise<Person | null> => {
    const [json, revoked, epoch] = await Promise.all([
      kv.hget(keyOf(home, 'people'), id),
      kv.hget(keyOf(home, 'revoked'), id),
      kv.hget(keyOf(home, 'epochs'), id),
    ]);
    return compose(home, json, revoked, epoch);
  };
  /** Someone the scope reaches: a Client of its client, else a Studio person. */
  const person = async (scope: Scope, id: string): Promise<Person | null> =>
    (await personAt(scope, id)) ?? personAt('studio', id);
  /** Every person at one home, skipping any profile that is not a well-formed person. */
  const peopleAt = async (home: Home): Promise<Person[]> => {
    const [profiles, revoked, epochs] = await Promise.all([
      kv.hgetall(keyOf(home, 'people')),
      kv.hgetall(keyOf(home, 'revoked')),
      kv.hgetall(keyOf(home, 'epochs')),
    ]);
    return Object.entries(profiles)
      .map(([id, json]) => compose(home, json, revoked[id], epochs[id]))
      .filter((p): p is Person => p !== null);
  };
  /** Writes the profile alone, at the person's home: revocation, epoch and client are never part of it. */
  const savePerson = ({ revokedAt: _r, epoch: _e, client, ...profile }: Person) =>
    kv.hset(keyOf(homeOf({ client }), 'people'), profile.id, JSON.stringify(profile satisfies Profile));
  /** Not revoked, and their access has not ended. */
  const active = (p: Person | null): p is Person => !!p && hasAccess(p, deps.now());

  async function issueLink(p: Person): Promise<string> {
    // The link carries the token; the store keeps only its hash, so a leaked store signs nobody in.
    const token = base64url(deps.random(32));
    const link: Link = {
      person: p.id,
      expiresAt: new Date(deps.now().getTime() + LINK_DAYS * DAY_MS).toISOString(),
    };
    // A link lives with its person, so it signs in only where that person's scope reaches.
    await kv.hset(keyOf(homeOf(p), 'links'), await linkKey(token), JSON.stringify(link));
    return token;
  }

  async function dropLinks(p: Person): Promise<void> {
    const links = keyOf(homeOf(p), 'links');
    for (const [hash, json] of Object.entries(await kv.hgetall(links)))
      if ((JSON.parse(json) as Link).person === p.id) await kv.hdel(links, hash);
  }

  type Found = { home: Home; hash: string; link: Link };

  /** The link a token names in the scope's client or the studio, or null for a malformed or unknown token. */
  async function findLink(scope: Scope, token: string): Promise<Found | null> {
    if (!LINK_TOKEN.test(token)) return null;
    const hash = await linkKey(token);
    for (const home of [scope, 'studio'] as const) {
      const link = parse<Link>(await kv.hget(keyOf(home, 'links'), hash));
      if (link) return { home, hash, link };
    }
    return null;
  }

  /** The person a current link signs in, while they may sign in here. */
  async function linkPerson(scope: Scope, { home, link }: Found): Promise<Person | null> {
    if (link.expiresAt <= now()) return null;
    const p = await personAt(home, link.person);
    return active(p) && inScope(p, scope) ? p : null;
  }

  async function readDefault(): Promise<Access> {
    const stored = await kv.hget(keyOf('studio', 'settings'), 'access');
    return checkAccess(stored).ok ? (stored as Access) : DEFAULT_ACCESS;
  }

  /** Someone Studio can still give a link to. */
  async function needActive(scope: Scope, id: string): Promise<Person> {
    const p = await needPerson(scope, id);
    if (p.revokedAt) throw new ReviewError('invalid', 'That person is revoked; add them again.');
    if (!active(p)) throw new ReviewError('invalid', 'Their access has ended; change their access first.');
    return p;
  }

  async function needPerson(scope: Scope, id: string): Promise<Person> {
    const p = await person(scope, id);
    if (!p) throw new ReviewError('not_found', NO_PERSON);
    return p;
  }

  // Every comment read goes through readComment, so a record with no audience reads as internal.
  // Unfiltered: nothing below hands these out without visibleTo or seen.
  /**
   * The next thread number for an audience on a prototype. Atomic and only raised: two threads at
   * once get two numbers, and a failed save skips one. Client-facing threads keep the field
   * numbers always had. Internal threads count in their own, which starts past any internal
   * thread numbered before the two counted apart, so no internal number is given twice.
   */
  const nextNumber = async (scope: Scope, prototype: string, audience: Audience): Promise<number> => {
    const counters = keyOf(scope, 'counters');
    if (audience === 'client') return kv.hincrby(counters, prototype, 1);
    const field = `${prototype}:internal`;
    const n = await kv.hincrby(counters, field, 1);
    if (n !== 1) return n;
    const before = Math.max(
      0,
      ...(await commentsOf(scope, prototype)).filter((c) => c.audience === 'internal').map((c) => c.number),
    );
    return before ? kv.hincrby(counters, field, before) : n;
  };

  const commentsOf = async (scope: Scope, prototype: string) =>
    Object.values(await kv.hgetall(keyOf(scope, 'comments', prototype)))
      .map(readComment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const commentAt = async (scope: Scope, prototype: string, id: string): Promise<Comment | null> => {
    const json = await kv.hget(keyOf(scope, 'comments', prototype), id);
    return json === null ? null : readComment(json);
  };

  const saveComment = (scope: Scope, prototype: string, c: Comment) =>
    kv.hset(keyOf(scope, 'comments', prototype), c.id, JSON.stringify(c));

  const isClientFacing = async (scope: Scope, prototype: string) =>
    isPrototypeSlug(prototype) && (await kv.hget(keyOf(scope, 'audiences'), prototype)) === 'client';

  /**
   * Whether a view reaches a prototype's comments at all. A Client's view
   * reaches only a client-facing prototype: on any other, every op answers
   * as if it had no comments, so no answer confirms an internal slug.
   */
  const reachable = async (scope: Scope, view: PersonKind, prototype: string) =>
    view === 'studio' || (await isClientFacing(scope, prototype));

  /**
   * A comment and its thread's root, if `actor` may see both; else null. A
   * reply whose root is gone is not there either.
   */
  async function seen(
    scope: Scope,
    actor: Person,
    prototype: string,
    id: string,
  ): Promise<{ comment: Comment; root: Comment } | null> {
    if (!(await reachable(scope, viewOf(actor), prototype))) return null;
    const comment = await commentAt(scope, prototype, id);
    if (!comment) return null;
    const root = isRoot(comment) ? comment : await commentAt(scope, prototype, comment.thread);
    return root && can(actor, scope, 'read', root, comment) ? { comment, root } : null;
  }

  /**
   * The comment an op names, and its root. One that `actor` may not see gets
   * the same answer as one that does not exist, so an id never tells a Client
   * an internal thread is there.
   */
  async function needThread(
    scope: Scope,
    actor: Person | null,
    prototype: string,
    id: string,
  ): Promise<{ actor: Person; comment: Comment; root: Comment }> {
    allow(scope, actor, 'read', NO_COMMENT);
    const found = await seen(scope, actor, prototype, id);
    if (!found) throw new ReviewError('not_found', NO_COMMENT);
    return { actor, ...found };
  }

  async function needRoot(
    scope: Scope,
    actor: Person | null,
    prototype: string,
    id: string,
  ): Promise<{ actor: Person; root: Comment }> {
    const found = await needThread(scope, actor, prototype, id);
    if (!isRoot(found.comment)) throw new ReviewError('invalid', 'That is a reply; act on its thread.');
    return { actor: found.actor, root: found.comment };
  }

  return {
    person,

    /** The person a signed session names, if they still may sign in with it, here. */
    async sessionPerson(scope: Scope, id: string, epoch: number): Promise<Person | null> {
      const p = await person(scope, id);
      return active(p) && p.epoch === epoch && inScope(p, scope) ? p : null;
    },

    /** The scope's Clients and every Studio person. */
    async listPeople(scope: Scope, actor: Person | null): Promise<Person[]> {
      allow(scope, actor, 'people', NO_PERSON);
      const all = [...(await peopleAt('studio')), ...(await peopleAt(scope))];
      return all.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
    },

    /**
     * A new person and their first link: a Client of the scope's client, or a
     * Studio person. Without an access length, a Client gets the default and
     * Studio is open-ended.
     */
    async addPerson(scope: Scope, actor: Person | null, input: unknown): Promise<Issued> {
      allow(scope, actor, 'people', NO_PERSON);
      const { access, ...fields } = valid(checkPersonInput(input));
      const length = access ?? (fields.kind === 'studio' ? 'open' : await readDefault());
      const p: Person = {
        id: newId(),
        ...fields,
        client: fields.kind === 'studio' ? null : scope.client,
        email: null,
        accessEndsAt: accessEnd(length, deps.now()),
        createdAt: now(),
        revokedAt: null,
        epoch: 0,
      };
      await savePerson(p);
      return { person: p, token: await issueLink(p) };
    },

    /** Another one-time link, for another device. Their sessions and other unused links stay. */
    async newLink(scope: Scope, actor: Person | null, id: string): Promise<Issued> {
      allow(scope, actor, 'people', NO_PERSON);
      const p = await needActive(scope, id);
      return { person: p, token: await issueLink(p) };
    },

    /** Ends every session they hold and every unused link, and gives one new link. */
    async signOutEverywhere(scope: Scope, actor: Person | null, id: string): Promise<Issued> {
      allow(scope, actor, 'people', NO_PERSON);
      const p = await needActive(scope, id);
      // The epoch first: a failure after it has still ended every session. Atomic, so two at once raise it twice.
      const next = { ...p, epoch: await kv.hincrby(keyOf(homeOf(p), 'epochs'), id, 1) };
      await dropLinks(p);
      return { person: next, token: await issueLink(next) };
    },

    async revoke(scope: Scope, actor: Person | null, id: string): Promise<Person> {
      allow(scope, actor, 'people', NO_PERSON);
      if (actor.id === id) throw new ReviewError('invalid', 'You cannot revoke yourself.');
      const p = await needPerson(scope, id);
      const revokedAt = p.revokedAt ?? now();
      // Revocation and the epoch before the links go, so a failure part-way never leaves an active
      // person; a leftover link opens nothing for someone revoked.
      if (!p.revokedAt) await kv.hset(keyOf(homeOf(p), 'revoked'), id, revokedAt);
      const epoch = await kv.hincrby(keyOf(homeOf(p), 'epochs'), id, 1);
      await dropLinks(p);
      return { ...p, revokedAt, epoch };
    },

    /** Sets one person's access length, counted from now. Their sessions follow at the gate's next check, within five minutes. */
    async setAccess(scope: Scope, actor: Person | null, id: string, access: unknown): Promise<Person> {
      allow(scope, actor, 'people', NO_PERSON);
      const length = valid(checkAccess(access));
      const p = await needPerson(scope, id);
      if (p.revokedAt) throw new ReviewError('invalid', 'That person is revoked; add them again.');
      await savePerson({ ...p, accessEndsAt: accessEnd(length, deps.now()) });
      // Read back, so the answer carries a revocation or epoch that landed meanwhile.
      return (await personAt(homeOf(p), id)) as Person;
    },

    /** How long a new Client keeps access unless Studio says otherwise: the studio's default. */
    async defaultAccess(scope: Scope, actor: Person | null): Promise<Access> {
      allow(scope, actor, 'people', NO_PERSON);
      return readDefault();
    },

    async setDefaultAccess(scope: Scope, actor: Person | null, access: unknown): Promise<Access> {
      allow(scope, actor, 'people', NO_PERSON);
      const length = valid(checkAccess(access));
      await kv.hset(keyOf('studio', 'settings'), 'access', length);
      return length;
    },

    /** Who a link signs in here, without using it: mail and chat previews open links too. */
    async peekLink(scope: Scope, token: string): Promise<Person | null> {
      const found = await findLink(scope, token);
      return found ? linkPerson(scope, found) : null;
    },

    /**
     * Uses a link up and returns who it signs in. The delete is the claim: of
     * two requests with one token, only the one whose delete removed the link
     * gets a person, so a link signs in one device at most. Who it signs in is
     * read and checked first, so the delete is the last store call. Only a
     * link of the scope's client, or a Studio person's, is found at all.
     */
    async useLink(scope: Scope, token: string): Promise<Person | null> {
      const found = await findLink(scope, token);
      // Every read and check comes before the delete, so a store failure before it leaves the link usable.
      const p = found && (await linkPerson(scope, found));
      if (!found || !p) return null;
      if ((await kv.hdel(keyOf(found.home, 'links'), found.hash)) !== 1) return null;
      // A revoke or sign out everywhere can land between the check and the claim, before its
      // dropLinks reaches this link: read again, and sign in only someone still active on the same epoch.
      const after = await personAt(found.home, p.id);
      return active(after) && after.epoch === p.epoch ? after : null;
    },

    /**
     * A prototype's comments as the actor's view sees them. `viewAs: 'client'`
     * is Studio's Client view; it never widens a Client's.
     */
    async listComments(
      scope: Scope,
      actor: Person | null,
      prototype: string,
      viewAs?: unknown,
    ): Promise<Comment[]> {
      allow(scope, actor, 'read', NO_COMMENT);
      const view = viewOf(actor, valid(checkViewAs(viewAs)));
      if (!(await reachable(scope, view, prototype))) return [];
      return visibleTo(view, await commentsOf(scope, prototype));
    },

    /** Every comment on every prototype of the scope's project the actor may see, for the CLI (which acts as Studio). */
    async allComments(scope: Scope, actor: Person | null): Promise<Comment[]> {
      allow(scope, actor, 'read', NO_COMMENT);
      const view = viewOf(actor);
      const prototypes = [];
      for (const p of await kv.smembers(keyOf(scope, 'prototypes')))
        if (await reachable(scope, view, p)) prototypes.push(p);
      return visibleTo(view, (await Promise.all(prototypes.map((p) => commentsOf(scope, p)))).flat());
    },

    /**
     * A new thread. A Client's is client-facing whatever the input says;
     * Studio's is internal unless `audience` is 'client'. Its number is the
     * next of its audience on the prototype, never one used before.
     */
    async add(
      scope: Scope,
      actor: Person | null,
      input: { body?: unknown; anchor?: unknown; states?: unknown; audience?: unknown },
    ): Promise<Comment> {
      allow(scope, actor, 'comment', NO_COMMENT);
      const [body, anchor, asked] = validAll<[string, Anchor, Audience | null]>(
        checkBody(input.body),
        checkAnchor(input.anchor),
        checkAudience(input.audience),
      );
      // A Client's thread on a prototype that is not client-facing: the answer an unknown id gets.
      if (!(await reachable(scope, viewOf(actor), anchor.prototype)))
        throw new ReviewError('not_found', NO_COMMENT);
      const id = newId();
      const triage = deps.triage
        ? await deps
            .triage({ body, prototype: anchor.prototype, url: anchor.url, states: checkStates(input.states) })
            // Triage is a convenience; a triager that throws never costs the comment.
            .catch(() => null)
        : null;
      const c: Comment = {
        id,
        thread: id,
        author: authorOf(actor),
        body,
        createdAt: now(),
        editedAt: null,
        anchor,
        status: 'open',
        resolvedBy: null,
        triage,
        audience: audienceFor(actor, asked),
        number: 0,
      };
      c.number = await nextNumber(scope, anchor.prototype, c.audience);
      await kv.sadd(keyOf(scope, 'prototypes'), anchor.prototype);
      await saveComment(scope, anchor.prototype, c);
      return c;
    },

    async reply(
      scope: Scope,
      actor: Person | null,
      input: { prototype: string; thread: string; body?: unknown },
    ): Promise<Comment> {
      const { actor: by, root } = await needRoot(scope, actor, input.prototype, input.thread);
      permit(scope, by, 'comment', root);
      const id = newId();
      const c: Comment = {
        id,
        thread: root.id,
        author: authorOf(by),
        body: valid(checkBody(input.body)),
        createdAt: now(),
        editedAt: null,
        anchor: null,
        status: 'open',
        resolvedBy: null,
        triage: null,
        // A reply follows its thread; nobody sets it.
        audience: root.audience,
        number: root.number,
      };
      await saveComment(scope, input.prototype, c);
      return c;
    },

    async edit(
      scope: Scope,
      actor: Person | null,
      input: { prototype: string; id: string; body?: unknown },
    ): Promise<Comment> {
      const { actor: by, comment: c, root } = await needThread(scope, actor, input.prototype, input.id);
      permit(scope, by, 'edit', root, c);
      const next = { ...c, body: valid(checkBody(input.body)), editedAt: now() };
      await saveComment(scope, input.prototype, next);
      return next;
    },

    /** Deletes a comment; deleting a thread's root deletes its replies with it. */
    async remove(
      scope: Scope,
      actor: Person | null,
      input: { prototype: string; id: string },
    ): Promise<string[]> {
      const { actor: by, comment: c, root } = await needThread(scope, actor, input.prototype, input.id);
      permit(scope, by, 'delete', root, c);
      const gone = isRoot(c)
        ? (await commentsOf(scope, input.prototype)).filter((x) => x.thread === c.id)
        : [c];
      for (const x of gone) await kv.hdel(keyOf(scope, 'comments', input.prototype), x.id);
      // The answer names only what the actor may see, judged with the thread's root beside it.
      const shown = new Set(visibleTo(viewOf(by), [root, ...gone]).map((x) => x.id));
      return gone.filter((x) => shown.has(x.id)).map((x) => x.id);
    },

    async resolve(
      scope: Scope,
      actor: Person | null,
      input: { prototype: string; id: string; resolved: boolean },
    ): Promise<Comment> {
      const { actor: by, root: c } = await needRoot(scope, actor, input.prototype, input.id);
      permit(scope, by, 'resolve', c);
      const next: Comment = input.resolved
        ? { ...c, status: 'resolved', resolvedBy: authorOf(by) }
        : { ...c, status: 'open', resolvedBy: null };
      await saveComment(scope, input.prototype, next);
      return next;
    },

    async retriage(
      scope: Scope,
      actor: Person | null,
      input: { prototype: string; id: string; triage?: unknown; states?: unknown },
    ): Promise<Comment> {
      allow(scope, actor, 'triage', NO_COMMENT);
      const { root: c } = await needRoot(scope, actor, input.prototype, input.id);
      const states = checkStates(input.states);
      const { kind, state } = valid(checkTriage(input.triage, states.length ? states : null));
      const next: Comment = { ...c, triage: { kind, state, by: 'person', confidence: null } };
      await saveComment(scope, input.prototype, next);
      return next;
    },

    /**
     * Marks a prototype client-facing or internal. Only client-facing is
     * stored, so internal deletes the field and a prototype nobody marked is
     * internal. Studio only.
     */
    async setAudience(
      scope: Scope,
      actor: Person | null,
      prototype: unknown,
      audience: unknown,
    ): Promise<Audience> {
      allow(scope, actor, 'audience', NO_PROTOTYPE);
      const [slug, value] = validAll<[string, Audience]>(
        isPrototypeSlug(prototype)
          ? { ok: true, value: prototype }
          : { ok: false, problems: ['prototype: a prototype slug'] },
        checkPrototypeAudience(audience),
      );
      if (value === 'client') await kv.hset(keyOf(scope, 'audiences'), slug, 'client');
      else await kv.hdel(keyOf(scope, 'audiences'), slug);
      return value;
    },

    /**
     * What Studio marked on a prototype's dials and variants, with the view
     * the actor gets. A Client reads the marks too: their page needs a dial
     * Studio switched back to internal as much as one it shared, and the
     * names are in the prototype's own code already. An internal prototype
     * has none for a Client, as it has no comments.
     */
    async controlsOf(
      scope: Scope,
      actor: Person | null,
      prototype: unknown,
    ): Promise<{ view: PersonKind } & Marks> {
      allow(scope, actor, 'read', NO_PROTOTYPE);
      if (!isPrototypeSlug(prototype))
        throw new ReviewError('invalid', 'Some fields are not valid.', ['prototype: a prototype slug']);
      const view = viewOf(actor);
      if (!(await reachable(scope, view, prototype))) throw new ReviewError('not_found', NO_PROTOTYPE);
      return { view, ...readMarks(await kv.hgetall(keyOf(scope, 'controls', prototype))) };
    },

    /**
     * Marks one dial or one variant client-facing or internal. A dial's mark
     * is stored either way, because it overrules what the code says; a
     * variant's internal is the field's absence. Studio only. The server
     * keeps no list of a prototype's controls, so any well-formed id is taken.
     */
    async setControl(
      scope: Scope,
      actor: Person | null,
      input: { prototype: unknown; kind: unknown; id: unknown; audience: unknown },
    ): Promise<{ kind: ControlKind; id: string; audience: Audience }> {
      allow(scope, actor, 'audience', NO_PROTOTYPE);
      const [slug, mark] = validAll<[string, { kind: ControlKind; id: string; audience: Audience }]>(
        isPrototypeSlug(input.prototype)
          ? { ok: true, value: input.prototype }
          : { ok: false, problems: ['prototype: a prototype slug'] },
        checkControl(input),
      );
      const controls = keyOf(scope, 'controls', slug);
      const field = controlField(mark.kind, mark.id);
      if (mark.kind === 'variant' && mark.audience === 'internal') await kv.hdel(controls, field);
      else await kv.hset(controls, field, mark.audience);
      return mark;
    },

    /**
     * Who a prototype of the scope's project is for, asked by the gate with no
     * actor. Absent, or any value but `client`, is internal; a name that
     * cannot be a prototype is internal without asking the store.
     */
    async audienceOf(scope: Scope, prototype: string): Promise<Audience> {
      return (await isClientFacing(scope, prototype)) ? 'client' : 'internal';
    },

    /**
     * What the index is built from: the view the actor gets (Client view for
     * Studio with `viewAs: 'client'`) and every client-facing slug. The
     * server keeps no list of internal ones: Studio's view reads the build's
     * own list, which the gate refuses to a Client.
     */
    async visiblePrototypes(
      scope: Scope,
      actor: Person | null,
      viewAs?: unknown,
    ): Promise<{ view: PersonKind; clientFacing: string[] }> {
      allow(scope, actor, 'read', NO_PROTOTYPE);
      const view = viewOf(actor, valid(checkViewAs(viewAs)));
      const all = await kv.hgetall(keyOf(scope, 'audiences'));
      const clientFacing = Object.entries(all)
        .filter(([slug, value]) => value === 'client' && isPrototypeSlug(slug))
        .map(([slug]) => slug)
        .sort();
      return { view, clientFacing };
    },

    /**
     * Where a comment lives, for the CLI, which has an id and no prototype;
     * null when the actor may not see it, and outside the actor's scope, as
     * for an id that is not there.
     */
    async locate(
      scope: Scope,
      actor: Person | null,
      id: string,
    ): Promise<{ prototype: string; comment: Comment } | null> {
      if (actor && !inScope(actor, scope)) return null;
      allow(scope, actor, 'read', NO_COMMENT);
      for (const prototype of await kv.smembers(keyOf(scope, 'prototypes'))) {
        const found = await seen(scope, actor, prototype, id);
        if (found) return { prototype, comment: found.comment };
      }
      return null;
    },
  };
}

export type Review = ReturnType<typeof createReview>;
