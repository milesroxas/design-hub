import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storeConfig, upstashKV } from './upstash.ts';

test('reads either env naming, Marketplace first', () => {
  assert.deepEqual(storeConfig({ KV_REST_API_URL: 'https://a/', KV_REST_API_TOKEN: 't' }), {
    url: 'https://a',
    token: 't',
  });
  assert.deepEqual(storeConfig({ UPSTASH_REDIS_REST_URL: 'https://b', UPSTASH_REDIS_REST_TOKEN: 'u' }), {
    url: 'https://b',
    token: 'u',
  });
  assert.equal(storeConfig({ KV_REST_API_URL: 'https://a' }), null);
});

test('sends one command per call and reads HGETALL pairs', async () => {
  const sent: unknown[] = [];
  const fake = (async (_: unknown, init: RequestInit) => {
    const args = JSON.parse(String(init.body)) as string[];
    sent.push(args);
    const result = args[0] === 'HGETALL' ? ['a', '1', 'b', '2'] : 1;
    return new Response(JSON.stringify({ result }));
  }) as typeof fetch;
  const kv = upstashKV({ url: 'https://x', token: 't' }, fake);
  await kv.hset('k', 'f', 'v');
  assert.deepEqual(await kv.hgetall('k'), { a: '1', b: '2' });
  assert.deepEqual(sent[0], ['HSET', 'k', 'f', 'v']);
});

test('throws on a Redis error so the service never reads a failure as empty', async () => {
  const fake = (async () =>
    new Response(JSON.stringify({ error: 'WRONGTYPE' }), { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(upstashKV({ url: 'https://x', token: 't' }, fake).hget('k', 'f'), /WRONGTYPE/);
});

test('a reply with no result is a failure, not an empty answer', async () => {
  const fake = (async () => new Response('{}')) as unknown as typeof fetch;
  await assert.rejects(
    upstashKV({ url: 'https://x', token: 't' }, fake).hgetall('k'),
    /no result in the reply/,
  );
});
