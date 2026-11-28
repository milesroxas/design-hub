// The KV conformance suite: what the review service needs of any store,
// run on every adapter. A new adapter passes this before anything runs on it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type KV, memoryKV } from '../core/review/store.ts';
import { fakeUpstash } from './fake-upstash.ts';
import { upstashKV } from './upstash.ts';

const ADAPTERS: [string, () => KV][] = [
  ['the memory store', () => memoryKV()],
  ['Upstash (fake)', () => upstashKV({ url: 'https://kv.test', token: 't' }, fakeUpstash())],
];

for (const [name, make] of ADAPTERS) {
  test(`${name}: a hash field reads back what was written, and nothing is there before`, async () => {
    const kv = make();
    assert.equal(await kv.hget('k', 'f'), null);
    assert.deepEqual(await kv.hgetall('k'), {});
    await kv.hset('k', 'f', 'one');
    await kv.hset('k', 'f', 'two');
    // Any text round-trips: colons, quotes, newlines, JSON and non-Latin script.
    const odd = 'a:b "c"\n{"d":1} 日本 ✓';
    await kv.hset('k', 'g:h', odd);
    assert.equal(await kv.hget('k', 'f'), 'two');
    assert.equal(await kv.hget('k', 'g:h'), odd);
    assert.deepEqual(await kv.hgetall('k'), { f: 'two', 'g:h': odd });
  });

  test(`${name}: keys never mix, a prefix of a key included`, async () => {
    const kv = make();
    await kv.hset('c:a:people', 'x', '1');
    await kv.hset('c:a:people:more', 'x', '2');
    // A set on a key of its own: a real store refuses a set op on a hash's key.
    await kv.sadd('c:a:members', 'm');
    assert.equal(await kv.hget('c:b:people', 'x'), null);
    assert.equal(await kv.hget('c:a:people:more', 'x'), '2');
    assert.deepEqual(await kv.hgetall('c:a'), {});
    assert.deepEqual(await kv.smembers('c:b:members'), []);
    assert.deepEqual(await kv.smembers('c:a:members:more'), []);
  });

  test(`${name}: hdel answers how many it removed, so one of two at once claims a field`, async () => {
    const kv = make();
    assert.equal(await kv.hdel('k', 'f'), 0);
    await kv.hset('k', 'f', 'v');
    await kv.hset('k', 'g', 'w');
    assert.deepEqual((await Promise.all([kv.hdel('k', 'f'), kv.hdel('k', 'f')])).sort(), [0, 1]);
    assert.equal(await kv.hget('k', 'f'), null);
    assert.deepEqual(await kv.hgetall('k'), { g: 'w' });
  });

  test(`${name}: hincrby starts from 0, returns the sum, and two at once both add`, async () => {
    const kv = make();
    assert.equal(await kv.hincrby('k', 'n', 1), 1);
    assert.equal(await kv.hincrby('k', 'n', 5), 6);
    assert.deepEqual((await Promise.all([kv.hincrby('k', 'n', 1), kv.hincrby('k', 'n', 1)])).sort(), [7, 8]);
    assert.equal(await kv.hget('k', 'n'), '8');
    assert.equal(await kv.hincrby('k', 'other', 2), 2);
  });

  test(`${name}: a set holds each member once`, async () => {
    const kv = make();
    assert.deepEqual(await kv.smembers('s'), []);
    await kv.sadd('s', 'a');
    await kv.sadd('s', 'b');
    await kv.sadd('s', 'a');
    assert.deepEqual((await kv.smembers('s')).sort(), ['a', 'b']);
  });
}
