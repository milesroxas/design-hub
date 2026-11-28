// The one storage port the review service needs: a few Redis-shaped hash
// and set operations. Production is Upstash Redis over REST
// (server/upstash.ts); dev and tests use the in-memory store below, which
// the dev server persists to a file (server/file-kv.ts).
import { SLUG } from '../feature.ts';
import { isClientSlug, isProjectSlug } from '../prototype.ts';
import type { Scope } from './model.ts';

/** A comment's or a control's prototype: any kebab-case name, so reading one that is reserved finds nothing, as before. */
const isKebab = (v: unknown): v is string => typeof v === 'string' && SLUG.test(v);

export interface KV {
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  /** How many fields it removed: 1, or 0 when the field was not there. Atomic, so it can claim a record. */
  hdel(key: string, field: string): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  /** Adds `by` to a field's integer (absent is 0) and returns the result. Atomic: two calls always add both. */
  hincrby(key: string, field: string, by: number): Promise<number>;
  sadd(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

/**
 * Every key the hub writes starts here, so a shared Redis never mixes it with
 * another app's data. Bumped when the stored shapes change without a
 * migration: records under an older prefix are simply never read.
 */
const PREFIX = 'hub4:';

/**
 * The studio's own records: Studio people (profile, revocation, epoch and
 * links, as a client's below) and `settings`, one field each: `access` is the
 * default access length.
 */
type StudioName = 'people' | 'revoked' | 'epochs' | 'links' | 'settings';

/**
 * A client's people, in four records. `people`: a profile, everything but
 * revocation and epoch, which nothing here can overwrite. `revoked`: when a
 * person was revoked, written once by revoke, never cleared. `epochs`: a
 * person's session epoch, only ever raised, by HINCRBY; absent is 0.
 * `links`: one-time sign-in links, hex(sha256(token)) to a Link.
 */
type ClientName = 'people' | 'revoked' | 'epochs' | 'links';

/**
 * A project's records. `audiences`: which prototypes are client-facing,
 * field `<slug>`, value `client`; only client-facing is stored, internal is
 * the field's absence, and any other value reads as internal too.
 * `counters`: the last thread number given on each prototype, only ever
 * raised by HINCRBY: field `<prototype>` counts client-facing threads,
 * `<prototype>:internal` internal ones. `prototypes`: the set of prototypes
 * with comments. `comments`, per prototype: one field per comment.
 * `controls`, per prototype: what Studio marked on its controls
 * (core/controls.ts): field `dial:<id>` is `client` or `internal`, overruling
 * the code either way; field `variant:<name>` is `client`, and internal is
 * its absence. One field per control, so two people marking at once never
 * undo each other.
 */
type ProjectName = 'audiences' | 'counters' | 'prototypes';
type PrototypeName = 'comments' | 'controls';

const PROJECT_NAMES: readonly string[] = ['audiences', 'counters', 'prototypes', 'comments', 'controls'];
const PER_PROTOTYPE: readonly string[] = ['comments', 'controls'];

function part(ok: (v: unknown) => v is string, v: unknown, what: string): string {
  // A bad part is a bug in the caller, never input to answer: fail closed before any store call.
  if (!ok(v)) throw new Error(`Not a store key: ${what} is ${JSON.stringify(v)}.`);
  return v;
}

/**
 * Every store key, and the only place one is built. `'studio'` names the
 * studio's own records; a Scope names its client's, and its project's for a
 * project name. Every part is checked (a client slug, a project slug, a
 * kebab-case prototype), so no value can reach into another client's keys:
 * no part can hold the `:` that joins them.
 */
export function keyOf(scope: 'studio', name: StudioName): string;
export function keyOf(scope: 'studio' | Scope, name: ClientName): string;
export function keyOf(scope: Scope, name: ProjectName): string;
export function keyOf(scope: Scope, name: PrototypeName, prototype: string): string;
export function keyOf(scope: 'studio' | Scope, name: string, prototype?: string): string {
  if (scope === 'studio') return `${PREFIX}studio:${name}`;
  const client = `${PREFIX}c:${part(isClientSlug, scope.client, 'client')}:`;
  if (!PROJECT_NAMES.includes(name)) return `${client}${name}`;
  const project = `${client}p:${part(isProjectSlug, scope.project, 'project')}:${name}`;
  return PER_PROTOTYPE.includes(name) ? `${project}:${part(isKebab, prototype, 'prototype')}` : project;
}

export type Snapshot = { hashes: Record<string, Record<string, string>>; sets: Record<string, string[]> };

export function memoryKV(initial: Snapshot = { hashes: {}, sets: {} }, onChange?: (s: Snapshot) => void): KV {
  const hashes = new Map(Object.entries(initial.hashes).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const sets = new Map(Object.entries(initial.sets).map(([k, v]) => [k, new Set(v)]));
  const changed = () =>
    onChange?.({
      hashes: Object.fromEntries([...hashes].map(([k, v]) => [k, Object.fromEntries(v)])),
      sets: Object.fromEntries([...sets].map(([k, v]) => [k, [...v]])),
    });
  const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
  return {
    hget: async (key, field) => hashes.get(key)?.get(field) ?? null,
    hset: async (key, field, value) => {
      hash(key).set(field, value);
      changed();
    },
    hdel: async (key, field) => {
      if (!hashes.get(key)?.delete(field)) return 0;
      changed();
      return 1;
    },
    hgetall: async (key) => Object.fromEntries(hashes.get(key) ?? []),
    hincrby: async (key, field, by) => {
      const n = Number(hash(key).get(field) ?? 0) + by;
      hash(key).set(field, String(n));
      changed();
      return n;
    },
    sadd: async (key, member) => {
      (sets.get(key) ?? sets.set(key, new Set()).get(key)!).add(member);
      changed();
    },
    smembers: async (key) => [...(sets.get(key) ?? [])],
  };
}
