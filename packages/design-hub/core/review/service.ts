// The review use cases over the storage port. Every adapter (the Vercel
// function, the Vite dev server, the CLI) builds one of these and calls it;
// none of them touches the store directly, so the rules in model.ts and
// policy.ts hold everywhere. Writes are per record (one hash field per
// person, per comment), so two people commenting at once never collide;
// two edits of the same comment at once keep the last.
import { base64url, hex, sha256 } from '../bytes.ts';
import {
  type Access,
  accessEnd,
  authorOf,
  type Checked,
  type Comment,
  checkAccess,
  checkAnchor,
  checkBody,
  checkPersonInput,
  checkStates,
  checkTriage,
  DEFAULT_ACCESS,
  hasAccess,
  isProfile,
  isRoot,
  LINK_DAYS,
  type Link,
  type Person,
  type Triage,
} from './model.ts';
import { type Action, can } from './policy.ts';
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

  function allow(actor: Person | null, action: Action, subject?: Comment): asserts actor is Person {
    if (!actor) throw new ReviewError('unauthorized', 'Sign in with your link to do that.');
    if (!can(actor, action, subject)) throw new ReviewError('forbidden', 'You cannot do that.');
  }

  function valid<T>(checked: Checked<T>): T {
    if (!checked.ok) throw new ReviewError('invalid', 'Some fields are not valid.', checked.problems);
    return checked.value;
  }

  // Every field checked before any throws, so one save names every problem.
  function validAll<A, B>(a: Checked<A>, b: Checked<B>): [A, B] {
    const problems = [...(a.ok ? [] : a.problems), ...(b.ok ? [] : b.problems)];
    if (!a.ok || !b.ok) throw new ReviewError('invalid', 'Some fields are not valid.', problems);
    return [a.value, b.value];
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

  const commentsOf = async (prototype: string) =>
    Object.values(await kv.hgetall(KEY.comments(prototype)))
      .map((json) => JSON.parse(json) as Comment)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const saveComment = (prototype: string, c: Comment) =>
    kv.hset(KEY.comments(prototype), c.id, JSON.stringify(c));

  async function needComment(prototype: string, id: string): Promise<Comment> {
    const c = parse<Comment>(await kv.hget(KEY.comments(prototype), id));
    if (!c) throw new ReviewError('not_found', 'No such comment.');
    return c;
  }

  async function needRoot(prototype: string, id: string): Promise<Comment> {
    const c = await needComment(prototype, id);
    if (!isRoot(c)) throw new ReviewError('invalid', 'That is a reply; act on its thread.');
    return c;
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

    async listComments(actor: Person | null, prototype: string): Promise<Comment[]> {
      allow(actor, 'read');
      return commentsOf(prototype);
    },

    /** Every comment on every prototype, for the CLI, which holds the store's own credentials. */
    async allComments(): Promise<Comment[]> {
      const prototypes = await kv.smembers(KEY.prototypes);
      return (await Promise.all(prototypes.map(commentsOf))).flat();
    },

    async add(
      actor: Person | null,
      input: { body?: unknown; anchor?: unknown; states?: unknown },
    ): Promise<Comment> {
      allow(actor, 'comment');
      const [body, anchor] = validAll(checkBody(input.body), checkAnchor(input.anchor));
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
      };
      await kv.sadd(KEY.prototypes, anchor.prototype);
      await saveComment(anchor.prototype, c);
      return c;
    },

    async reply(
      actor: Person | null,
      input: { prototype: string; thread: string; body?: unknown },
    ): Promise<Comment> {
      allow(actor, 'comment');
      const root = await needRoot(input.prototype, input.thread);
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
      };
      await saveComment(input.prototype, c);
      return c;
    },

    async edit(
      actor: Person | null,
      input: { prototype: string; id: string; body?: unknown },
    ): Promise<Comment> {
      const c = await needComment(input.prototype, input.id);
      allow(actor, 'edit', c);
      const next = { ...c, body: valid(checkBody(input.body)), editedAt: now() };
      await saveComment(input.prototype, next);
      return next;
    },

    /** Deletes a comment; deleting a thread's root deletes its replies with it. */
    async remove(actor: Person | null, input: { prototype: string; id: string }): Promise<string[]> {
      const c = await needComment(input.prototype, input.id);
      allow(actor, 'delete', c);
      const gone = isRoot(c)
        ? (await commentsOf(input.prototype)).filter((x) => x.thread === c.id).map((x) => x.id)
        : [c.id];
      for (const id of gone) await kv.hdel(KEY.comments(input.prototype), id);
      return gone;
    },

    async resolve(
      actor: Person | null,
      input: { prototype: string; id: string; resolved: boolean },
    ): Promise<Comment> {
      const c = await needRoot(input.prototype, input.id);
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
      const c = await needRoot(input.prototype, input.id);
      const states = checkStates(input.states);
      const { kind, state } = valid(checkTriage(input.triage, states.length ? states : null));
      const next: Comment = { ...c, triage: { kind, state, by: 'person', confidence: null } };
      await saveComment(input.prototype, next);
      return next;
    },

    /** Where a comment lives, for the CLI, which has an id and no prototype. */
    async locate(id: string): Promise<{ prototype: string; comment: Comment } | null> {
      for (const prototype of await kv.smembers(KEY.prototypes)) {
        const c = parse<Comment>(await kv.hget(KEY.comments(prototype), id));
        if (c) return { prototype, comment: c };
      }
      return null;
    },
  };
}

export type Review = ReturnType<typeof createReview>;
