/// <reference types="node" />
// A fetch that answers like Upstash's REST API from memory, for tests that
// exercise the deployed code path (proxy.ts, api/review.ts) without an account.
import { memoryKV } from '../_core/review/store.ts';

export function fakeUpstash(): typeof fetch {
  const kv = memoryKV();
  async function run(cmd: string, [key, a, b]: string[]): Promise<unknown> {
    switch (cmd) {
      case 'HGET':
        return kv.hget(key, a);
      case 'HSET':
        await kv.hset(key, a, b);
        return 1;
      case 'HDEL':
        await kv.hdel(key, a);
        return 1;
      case 'HGETALL':
        return Object.entries(await kv.hgetall(key)).flat();
      case 'SADD':
        await kv.sadd(key, a);
        return 1;
      case 'SMEMBERS':
        return kv.smembers(key);
      default:
        throw new Error(`unknown command ${cmd}`);
    }
  }
  return (async (_url: unknown, init?: RequestInit) => {
    const [cmd, ...args] = JSON.parse(String(init?.body)) as string[];
    try {
      return new Response(JSON.stringify({ result: await run(cmd, args) }));
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), { status: 400 });
    }
  }) as typeof fetch;
}
