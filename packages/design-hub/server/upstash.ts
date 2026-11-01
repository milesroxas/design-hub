// The review store in production: Upstash Redis over its REST API, on plain
// fetch, so nothing is installed. The Vercel Marketplace integration injects
// KV_REST_API_URL and KV_REST_API_TOKEN (`pnpm bootstrap --review` adds it);
// UPSTASH_REDIS_REST_* are the names the Upstash console uses.
// API: https://upstash.com/docs/redis/features/restapi
import type { KV } from '../core/review/store.ts';

export type StoreConfig = { url: string; token: string };

export function storeConfig(env: Record<string, string | undefined>): StoreConfig | null {
  const url = env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN ?? env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

const TIMEOUT_MS = 5000;

export function upstashKV({ url, token }: StoreConfig, fetcher: typeof fetch = fetch): KV {
  async function command<T>(...args: string[]): Promise<T> {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = (await response.json().catch(() => ({}))) as { result?: T; error?: string };
    // A reply without `result` is a failure too, never an empty answer the service would trust.
    if (!response.ok || json.error !== undefined || !('result' in json))
      throw new Error(
        `Upstash ${args[0]} failed (${response.status}): ${json.error ?? 'no result in the reply'}`,
      );
    return json.result as T;
  }
  return {
    hget: (key, field) => command<string | null>('HGET', key, field),
    hset: async (key, field, value) => {
      await command('HSET', key, field, value);
    },
    hdel: async (key, field) => {
      await command('HDEL', key, field);
    },
    hgetall: async (key) => {
      const flat = (await command<string[] | null>('HGETALL', key)) ?? [];
      const out: Record<string, string> = {};
      for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = flat[i + 1];
      return out;
    },
    sadd: async (key, member) => {
      await command('SADD', key, member);
    },
    smembers: async (key) => (await command<string[] | null>('SMEMBERS', key)) ?? [],
  };
}
