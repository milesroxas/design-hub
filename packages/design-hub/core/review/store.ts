// The one storage port the review service needs: a few Redis-shaped hash
// and set operations. Production is Upstash Redis over REST
// (server/upstash.ts); dev and tests use the in-memory store below, which
// the dev server persists to a file (server/file-kv.ts).

export interface KV {
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  sadd(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
}

/** Every key the hub writes starts here, so a shared Redis never mixes it with another app's data. */
export const KEY = {
  people: 'hub:people',
  invites: 'hub:invites',
  prototypes: 'hub:prototypes',
  comments: (prototype: string) => `hub:comments:${prototype}`,
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
      hashes.get(key)?.delete(field);
      changed();
    },
    hgetall: async (key) => Object.fromEntries(hashes.get(key) ?? []),
    sadd: async (key, member) => {
      (sets.get(key) ?? sets.set(key, new Set()).get(key)!).add(member);
      changed();
    },
    smembers: async (key) => [...(sets.get(key) ?? [])],
  };
}
