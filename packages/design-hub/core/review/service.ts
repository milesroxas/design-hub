// The review use cases over the storage port. Every adapter (the Vercel
// function, the Vite dev server, the CLI) builds one of these and calls it;
// none of them touches the store directly, so the rules in model.ts and
// policy.ts hold everywhere. Writes are per record (one hash field per
// person, per comment), so two people commenting at once never collide;
// two edits of the same comment at once keep the last.
import { base64url, hex, sha256 } from '../bytes.ts';
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
  readComment,
  type Triage,
} from './model.ts';
import { type Action, audienceFor, can, viewOf, visibleTo } from './policy.ts';
import { KEY, type KV } from './store.ts';

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

  function allow(
    actor: Person | null,
    action: Action,
    root?: Comment,
    subject?: Comment,
  ): asserts actor is Person {
    if (!actor) throw new ReviewError('unauthorized', 'Sign in with your link to do that.');
    if (!can(actor, action, root, subject)) throw new ReviewError('forbidden', 'You cannot do that.');
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

  // A person is three records. The profile (KEY.people) is read-modify-write, so
  // a stale write of it can land after anything. Revocation and the epoch live
  // outside it: revocation is written once and never cleared, the epoch only
  // rises (HINCRBY), so no profile write, however stale, can revive a session.
  const compose = (
    json: string | null,
    revoked: string | null | undefined,
    epoch: string | null | undefined,
  ) => {
    const profile = safeParse(json);
    if (!isProfile(profile)) return null;
    // Any revocation record means revoked, an empty one included: it reads as the start of time.
    const revokedAt = revoked == null ? null : revoked || new Date(0).toISOString();
    return { ...profile, revokedAt, epoch: Number(epoch ?? 0) };
  };
  const person = async (id: string): Promise<Person | null> => {
    const [json, revoked, epoch] = await Promise.all([
      kv.hget(KEY.people, id),
      kv.hget(KEY.revoked, id),
      kv.hget(KEY.epochs, id),
    ]);
    return compose(json, revoked, epoch);
  };
  /** Writes the profile alone: revocation and epoch are never part of what it saves. */
  const savePerson = ({ revokedAt: _r, epoch: _e, ...profile }: Person) =>
    kv.hset(KEY.people, profile.id, JSON.stringify(profile));
  /** Not revoked, and their access has not ended. */
  const active = (p: Person | null): p is Person => !!p && hasAccess(p, deps.now());

  async function issueLink(p: Person): Promise<string> {
    // The link carries the token; the store keeps only its hash, so a leaked store signs nobody in.
    const token = base64url(deps.random(32));
    const link: Link = {
      person: p.id,
      expiresAt: new Date(deps.now().getTime() + LINK_DAYS * DAY_MS).toISOString(),
    };
    await kv.hset(KEY.links, await linkKey(token), JSON.stringify(link));
    return token;
  }

  async function dropLinks(personId: string): Promise<void> {
    const all = await kv.hgetall(KEY.links);
    for (const [hash, json] of Object.entries(all))
      if ((JSON.parse(json) as Link).person === personId) await kv.hdel(KEY.links, hash);
  }

  /** The link a token names, or null for a malformed or unknown token. */
  async function findLink(token: string): Promise<{ key: string; link: Link } | null> {
    if (!LINK_TOKEN.test(token)) return null;
    const key = await linkKey(token);
    const link = parse<Link>(await kv.hget(KEY.links, key));
    return link ? { key, link } : null;
  }

  /** The person a current link signs in, while they may sign in. */
  async function linkPerson(link: Link): Promise<Person | null> {
    if (link.expiresAt <= now()) return null;
    const p = await person(link.person);
    return active(p) ? p : null;
  }

  async function readDefault(): Promise<Access> {
    const stored = await kv.hget(KEY.settings, 'access');
    return checkAccess(stored).ok ? (stored as Access) : DEFAULT_ACCESS;
  }

  /** Someone Studio can still give a link to. */
  async function needActive(id: string): Promise<Person> {
    const p = await needPerson(id);
    if (p.revokedAt) throw new ReviewError('invalid', 'That person is revoked; add them again.');
    if (!active(p)) throw new ReviewError('invalid', 'Their access has ended; change their access first.');
    return p;
  }

  async function needPerson(id: string): Promise<Person> {
    const p = await person(id);
    if (!p) throw new ReviewError('not_found', 'No such person.');
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
  const nextNumber = async (prototype: string, audience: Audience): Promise<number> => {
    if (audience === 'client') return kv.hincrby(KEY.counters, prototype, 1);
    const field = `${prototype}:internal`;
    const n = await kv.hincrby(KEY.counters, field, 1);
    if (n !== 1) return n;
    const before = Math.max(
      0,
      ...(await commentsOf(prototype)).filter((c) => c.audience === 'internal').map((c) => c.number),
    );
    return before ? kv.hincrby(KEY.counters, field, before) : n;
  };

  const commentsOf = async (prototype: string) =>
    Object.values(await kv.hgetall(KEY.comments(prototype)))
      .map(readComment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const commentAt = async (prototype: string, id: string): Promise<Comment | null> => {
    const json = await kv.hget(KEY.comments(prototype), id);
    return json === null ? null : readComment(json);
  };

  const saveComment = (prototype: string, c: Comment) =>
    kv.hset(KEY.comments(prototype), c.id, JSON.stringify(c));

  const isClientFacing = async (prototype: string) =>
    isPrototypeSlug(prototype) && (await kv.hget(KEY.audiences, prototype)) === 'client';

  /**
   * Whether a view reaches a prototype's comments at all. A Client's view
   * reaches only a client-facing prototype: on any other, every op answers
   * as if it had no comments, so no answer confirms an internal slug.
   */
  const reachable = async (view: PersonKind, prototype: string) =>
    view === 'studio' || (await isClientFacing(prototype));

  /**
   * A comment and its thread's root, if `actor` may see both; else null. A
   * reply whose root is gone is not there either.
   */
  async function seen(
    actor: Person,
    prototype: string,
    id: string,
  ): Promise<{ comment: Comment; root: Comment } | null> {
    if (!(await reachable(viewOf(actor), prototype))) return null;
    const comment = await commentAt(prototype, id);
    if (!comment) return null;
    const root = isRoot(comment) ? comment : await commentAt(prototype, comment.thread);
    return root && can(actor, 'read', root, comment) ? { comment, root } : null;
  }

  /**
   * The comment an op names, and its root. One that `actor` may not see gets
   * the same answer as one that does not exist, so an id never tells a Client
   * an internal thread is there.
   */
  async function needThread(
    actor: Person | null,
    prototype: string,
    id: string,
  ): Promise<{ comment: Comment; root: Comment }> {
    allow(actor, 'read');
    const found = await seen(actor, prototype, id);
    if (!found) throw new ReviewError('not_found', 'No such comment.');
    return found;
  }

  async function needRoot(actor: Person | null, prototype: string, id: string): Promise<Comment> {
    const { comment } = await needThread(actor, prototype, id);
    if (!isRoot(comment)) throw new ReviewError('invalid', 'That is a reply; act on its thread.');
    return comment;
  }

  return {
    person,

    /** The person a signed session names, if they still may sign in with it. */
    async sessionPerson(id: string, epoch: number): Promise<Person | null> {
      const p = await person(id);
      return active(p) && p.epoch === epoch ? p : null;
    },

    async listPeople(actor: Person | null): Promise<Person[]> {
      allow(actor, 'people');
      const [profiles, revoked, epochs] = await Promise.all([
        kv.hgetall(KEY.people),
        kv.hgetall(KEY.revoked),
        kv.hgetall(KEY.epochs),
      ]);
      // A profile that is not a well-formed person is skipped, never a throw.
      const all = Object.entries(profiles)
        .map(([id, json]) => compose(json, revoked[id], epochs[id]))
        .filter((p): p is Person => p !== null);
      return all.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
    },

    /** A new person and their first link. Without an access length, a Client gets the project default and Studio is open-ended. */
    async addPerson(actor: Person | null, input: unknown): Promise<{ person: Person; token: string }> {
      allow(actor, 'people');
      const { access, ...fields } = valid(checkPersonInput(input));
      const length = access ?? (fields.kind === 'studio' ? 'open' : await readDefault());
      const p: Person = {
        id: newId(),
        ...fields,
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
    async newLink(actor: Person | null, id: string): Promise<{ person: Person; token: string }> {
      allow(actor, 'people');
      const p = await needActive(id);
      return { person: p, token: await issueLink(p) };
    },

    /** Ends every session they hold and every unused link, and gives one new link. */
    async signOutEverywhere(actor: Person | null, id: string): Promise<{ person: Person; token: string }> {
      allow(actor, 'people');
      const p = await needActive(id);
      // The epoch first: a failure after it has still ended every session. Atomic, so two at once raise it twice.
      const next = { ...p, epoch: await kv.hincrby(KEY.epochs, id, 1) };
      await dropLinks(id);
      return { person: next, token: await issueLink(next) };
    },

    async revoke(actor: Person | null, id: string): Promise<Person> {
      allow(actor, 'people');
      if (actor.id === id) throw new ReviewError('invalid', 'You cannot revoke yourself.');
      const p = await needPerson(id);
      const revokedAt = p.revokedAt ?? now();
      // Revocation and the epoch before the links go, so a failure part-way never leaves an active
      // person; a leftover link opens nothing for someone revoked.
      if (!p.revokedAt) await kv.hset(KEY.revoked, id, revokedAt);
      const epoch = await kv.hincrby(KEY.epochs, id, 1);
      await dropLinks(id);
      return { ...p, revokedAt, epoch };
    },

    /** Sets one person's access length, counted from now. Their sessions follow at the gate's next check, within five minutes. */
    async setAccess(actor: Person | null, id: string, access: unknown): Promise<Person> {
      allow(actor, 'people');
      const length = valid(checkAccess(access));
      const p = await needPerson(id);
      if (p.revokedAt) throw new ReviewError('invalid', 'That person is revoked; add them again.');
      await savePerson({ ...p, accessEndsAt: accessEnd(length, deps.now()) });
      // Read back, so the answer carries a revocation or epoch that landed meanwhile.
      return (await person(id)) as Person;
    },

    /** How long a new Client keeps access unless Studio says otherwise. */
    async defaultAccess(actor: Person | null): Promise<Access> {
      allow(actor, 'people');
      return readDefault();
    },

    async setDefaultAccess(actor: Person | null, access: unknown): Promise<Access> {
      allow(actor, 'people');
      const length = valid(checkAccess(access));
      await kv.hset(KEY.settings, 'access', length);
      return length;
    },

    /** Who a link signs in, without using it: mail and chat previews open links too. */
    async peekLink(token: string): Promise<Person | null> {
      const found = await findLink(token);
      return found ? linkPerson(found.link) : null;
    },

    /**
     * Uses a link up and returns who it signs in. The delete is the claim: of
     * two requests with one token, only the one whose delete removed the link
     * gets a person, so a link signs in one device at most. Who it signs in is
     * read and checked first, so the delete is the last store call.
     */
    async useLink(token: string): Promise<Person | null> {
      const found = await findLink(token);
      // Every read and check comes before the delete, so a store failure before it leaves the link usable.
      const p = found && (await linkPerson(found.link));
      if (!found || !p) return null;
      if ((await kv.hdel(KEY.links, found.key)) !== 1) return null;
      // A revoke or sign out everywhere can land between the check and the claim, before its
      // dropLinks reaches this link: read again, and sign in only someone still active on the same epoch.
      const after = await person(p.id);
      return active(after) && after.epoch === p.epoch ? after : null;
    },

    /**
     * A prototype's comments as the actor's view sees them. `viewAs: 'client'`
     * is Studio's Client view; it never widens a Client's.
     */
    async listComments(actor: Person | null, prototype: string, viewAs?: unknown): Promise<Comment[]> {
      allow(actor, 'read');
      const view = viewOf(actor, valid(checkViewAs(viewAs)));
      if (!(await reachable(view, prototype))) return [];
      return visibleTo(view, await commentsOf(prototype));
    },

    /** Every comment on every prototype the actor may see, for the CLI (which acts as Studio). */
    async allComments(actor: Person | null): Promise<Comment[]> {
      allow(actor, 'read');
      const view = viewOf(actor);
      const prototypes = [];
      for (const p of await kv.smembers(KEY.prototypes)) if (await reachable(view, p)) prototypes.push(p);
      return visibleTo(view, (await Promise.all(prototypes.map(commentsOf))).flat());
    },

    /**
     * A new thread. A Client's is client-facing whatever the input says;
     * Studio's is internal unless `audience` is 'client'. Its number is the
     * next of its audience on the prototype, never one used before.
     */
    async add(
      actor: Person | null,
      input: { body?: unknown; anchor?: unknown; states?: unknown; audience?: unknown },
    ): Promise<Comment> {
      allow(actor, 'comment');
      const [body, anchor, asked] = validAll<[string, Anchor, Audience | null]>(
        checkBody(input.body),
        checkAnchor(input.anchor),
        checkAudience(input.audience),
      );
      // A Client's thread on a prototype that is not client-facing: the answer an unknown id gets.
      if (!(await reachable(viewOf(actor), anchor.prototype)))
        throw new ReviewError('not_found', 'No such comment.');
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
      c.number = await nextNumber(anchor.prototype, c.audience);
      await kv.sadd(KEY.prototypes, anchor.prototype);
      await saveComment(anchor.prototype, c);
      return c;
    },

    async reply(
      actor: Person | null,
      input: { prototype: string; thread: string; body?: unknown },
    ): Promise<Comment> {
      const root = await needRoot(actor, input.prototype, input.thread);
      allow(actor, 'comment', root);
      const id = newId();
      const c: Comment = {
        id,
        thread: root.id,
        author: authorOf(actor),
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
      await saveComment(input.prototype, c);
      return c;
    },

    async edit(
      actor: Person | null,
      input: { prototype: string; id: string; body?: unknown },
    ): Promise<Comment> {
      const { comment: c, root } = await needThread(actor, input.prototype, input.id);
      allow(actor, 'edit', root, c);
      const next = { ...c, body: valid(checkBody(input.body)), editedAt: now() };
      await saveComment(input.prototype, next);
      return next;
    },

    /** Deletes a comment; deleting a thread's root deletes its replies with it. */
    async remove(actor: Person | null, input: { prototype: string; id: string }): Promise<string[]> {
      const { comment: c, root } = await needThread(actor, input.prototype, input.id);
      allow(actor, 'delete', root, c);
      const gone = isRoot(c) ? (await commentsOf(input.prototype)).filter((x) => x.thread === c.id) : [c];
      for (const x of gone) await kv.hdel(KEY.comments(input.prototype), x.id);
      // The answer names only what the actor may see, judged with the thread's root beside it.
      const shown = new Set(visibleTo(viewOf(actor), [root, ...gone]).map((x) => x.id));
      return gone.filter((x) => shown.has(x.id)).map((x) => x.id);
    },

    async resolve(
      actor: Person | null,
      input: { prototype: string; id: string; resolved: boolean },
    ): Promise<Comment> {
      const c = await needRoot(actor, input.prototype, input.id);
      allow(actor, 'resolve', c);
      const next: Comment = input.resolved
        ? { ...c, status: 'resolved', resolvedBy: authorOf(actor) }
        : { ...c, status: 'open', resolvedBy: null };
      await saveComment(input.prototype, next);
      return next;
    },

    async retriage(
      actor: Person | null,
      input: { prototype: string; id: string; triage?: unknown; states?: unknown },
    ): Promise<Comment> {
      allow(actor, 'triage');
      const c = await needRoot(actor, input.prototype, input.id);
      const states = checkStates(input.states);
      const { kind, state } = valid(checkTriage(input.triage, states.length ? states : null));
      const next: Comment = { ...c, triage: { kind, state, by: 'person', confidence: null } };
      await saveComment(input.prototype, next);
      return next;
    },

    /**
     * Marks a prototype client-facing or internal. Only client-facing is
     * stored, so internal deletes the field and a prototype nobody marked is
     * internal. Studio only.
     */
    async setAudience(actor: Person | null, prototype: unknown, audience: unknown): Promise<Audience> {
      allow(actor, 'audience');
      const [slug, value] = validAll<[string, Audience]>(
        isPrototypeSlug(prototype)
          ? { ok: true, value: prototype }
          : { ok: false, problems: ['prototype: a prototype slug'] },
        checkPrototypeAudience(audience),
      );
      if (value === 'client') await kv.hset(KEY.audiences, slug, 'client');
      else await kv.hdel(KEY.audiences, slug);
      return value;
    },

    /**
     * Who a prototype is for, asked by the gate with no actor. Absent, or any
     * value but `client`, is internal; a name that cannot be a prototype is
     * internal without asking the store.
     */
    async audienceOf(prototype: string): Promise<Audience> {
      return (await isClientFacing(prototype)) ? 'client' : 'internal';
    },

    /**
     * What the index is built from: the view the actor gets (Client view for
     * Studio with `viewAs: 'client'`) and every client-facing slug. The
     * server keeps no list of internal ones: Studio's view reads the build's
     * own list, which the gate refuses to a Client.
     */
    async visiblePrototypes(
      actor: Person | null,
      viewAs?: unknown,
    ): Promise<{ view: PersonKind; clientFacing: string[] }> {
      allow(actor, 'read');
      const view = viewOf(actor, valid(checkViewAs(viewAs)));
      const all = await kv.hgetall(KEY.audiences);
      const clientFacing = Object.entries(all)
        .filter(([slug, value]) => value === 'client' && isPrototypeSlug(slug))
        .map(([slug]) => slug)
        .sort();
      return { view, clientFacing };
    },

    /** Where a comment lives, for the CLI, which has an id and no prototype; null when the actor may not see it. */
    async locate(actor: Person | null, id: string): Promise<{ prototype: string; comment: Comment } | null> {
      allow(actor, 'read');
      for (const prototype of await kv.smembers(KEY.prototypes)) {
        const found = await seen(actor, prototype, id);
        if (found) return { prototype, comment: found.comment };
      }
      return null;
    },
  };
}

export type Review = ReturnType<typeof createReview>;
