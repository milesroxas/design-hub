// The review use cases over the storage port. Every adapter (the Vercel
// function, the Vite dev server, the CLI) builds one of these and calls it;
// none of them touches the store directly, so the rules in model.ts and
// policy.ts hold everywhere. Writes are per record (one hash field per
// person, per comment), so two people commenting at once never collide;
// two edits of the same comment at once keep the last.
import { base64url, hex, sha256 } from '../bytes.ts';
import {
  authorOf,
  type Checked,
  type Comment,
  checkAnchor,
  checkBody,
  checkPersonInput,
  checkStates,
  checkTriage,
  INVITE_DAYS,
  isRoot,
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

type Invite = { person: string; expiresAt: string };

export function createReview(kv: KV, overrides: Partial<Deps> = {}) {
  const deps = { ...defaults, ...overrides };
  const now = () => deps.now().toISOString();
  // Sortable by time, unique without coordination.
  const newId = () => `${deps.now().getTime().toString(36).padStart(9, '0')}${hex(deps.random(5))}`;

  const parse = <T>(json: string | null): T | null => (json === null ? null : (JSON.parse(json) as T));

  function allow(actor: Person | null, action: Action, subject?: Comment): asserts actor is Person {
    if (!actor) throw new ReviewError('unauthorized', 'Sign in with an invite link to do that.');
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

  const person = async (id: string) => parse<Person>(await kv.hget(KEY.people, id));
  const savePerson = (p: Person) => kv.hset(KEY.people, p.id, JSON.stringify(p));

  async function issueInvite(p: Person): Promise<string> {
    // The link carries the token; the store keeps only its hash, so a leaked store signs nobody in.
    const token = base64url(deps.random(32));
    const invite: Invite = {
      person: p.id,
      expiresAt: new Date(deps.now().getTime() + INVITE_DAYS * DAY_MS).toISOString(),
    };
    await kv.hset(KEY.invites, hex(await sha256(token)), JSON.stringify(invite));
    return token;
  }

  async function dropInvites(personId: string): Promise<void> {
    const all = await kv.hgetall(KEY.invites);
    for (const [hash, json] of Object.entries(all))
      if ((JSON.parse(json) as Invite).person === personId) await kv.hdel(KEY.invites, hash);
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
      return p && !p.revokedAt && p.epoch === epoch ? p : null;
    },

    async listPeople(actor: Person | null): Promise<Person[]> {
      allow(actor, 'people');
      const all = Object.values(await kv.hgetall(KEY.people)).map((j) => JSON.parse(j) as Person);
      return all.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
    },

    async invite(actor: Person | null, input: unknown): Promise<{ person: Person; token: string }> {
      allow(actor, 'people');
      const p: Person = {
        id: newId(),
        ...valid(checkPersonInput(input)),
        createdAt: now(),
        revokedAt: null,
        epoch: 0,
      };
      await savePerson(p);
      return { person: p, token: await issueInvite(p) };
    },

    /** A fresh link for someone; their old link and every session they hold stop working. */
    async reissue(actor: Person | null, id: string): Promise<{ person: Person; token: string }> {
      allow(actor, 'people');
      const p = await needPerson(id);
      if (p.revokedAt) throw new ReviewError('invalid', 'That person is revoked; invite them again.');
      const next = { ...p, epoch: p.epoch + 1 };
      await dropInvites(id);
      await savePerson(next);
      return { person: next, token: await issueInvite(next) };
    },

    async revoke(actor: Person | null, id: string): Promise<Person> {
      allow(actor, 'people');
      if (actor.id === id) throw new ReviewError('invalid', 'You cannot revoke yourself.');
      const p = await needPerson(id);
      const next = { ...p, revokedAt: p.revokedAt ?? now(), epoch: p.epoch + 1 };
      await dropInvites(id);
      await savePerson(next);
      return next;
    },

    /** The person an invite token names, while the invite is current and they are not revoked. */
    async acceptInvite(token: string): Promise<Person | null> {
      if (!/^[\w-]{20,100}$/.test(token)) return null;
      const invite = parse<Invite>(await kv.hget(KEY.invites, hex(await sha256(token))));
      if (!invite || invite.expiresAt <= now()) return null;
      const p = await person(invite.person);
      return p && !p.revokedAt ? p : null;
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
