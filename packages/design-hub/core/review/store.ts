// The one storage port the review service needs: a few Redis-shaped hash
// and set operations. Production is Upstash Redis over REST
// (server/upstash.ts); dev and tests use the in-memory store below, which
// the dev server persists to a file (server/file-kv.ts).

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
const PREFIX = 'hub3:';

export const KEY = {
  /** A person's profile: everything but revocation and epoch, which nothing here can overwrite. */
  people: `${PREFIX}people`,
  /** When a person was revoked. Written once by revoke, never cleared. */
  revoked: `${PREFIX}revoked`,
  /** A person's session epoch, only ever raised, by HINCRBY. Absent is 0. */
  epochs: `${PREFIX}epochs`,
  /** One-time sign-in links: hex(sha256(token)) to a Link. */
  links: `${PREFIX}links`,
  /** Project settings, one field each: `access` is the default access length. */
  settings: `${PREFIX}settings`,
  prototypes: `${PREFIX}prototypes`,
  comments: (prototype: string) => `${PREFIX}comments:${prototype}`,
} as const;

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
