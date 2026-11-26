import assert from 'node:assert/strict';
import { test } from 'node:test';
import { missingGateEnv } from './vercel.ts';

const both = (names: string[]) => ({ production: new Set(names), preview: new Set(names) });
const FULL = ['GATE_SECRET', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];

test('the gate needs the secret and the review store on production and preview', () => {
  assert.deepEqual(missingGateEnv(both(FULL)), []);
  // A project shared before one-time links: the secret, and no store.
  assert.deepEqual(missingGateEnv(both(['GATE_SECRET'])), [
    'KV_REST_API_URL:production',
    'KV_REST_API_TOKEN:production',
    'KV_REST_API_URL:preview',
    'KV_REST_API_TOKEN:preview',
  ]);
  assert.deepEqual(missingGateEnv({ production: new Set(FULL), preview: new Set(['KV_REST_API_URL']) }), [
    'GATE_SECRET:preview',
    'KV_REST_API_TOKEN:preview',
  ]);
});

test('the Upstash console names count as the store, and an unreadable target says nothing', () => {
  assert.deepEqual(
    missingGateEnv(both(['GATE_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'])),
    [],
  );
  assert.equal(missingGateEnv({ production: new Set(FULL), preview: null }), null);
});
