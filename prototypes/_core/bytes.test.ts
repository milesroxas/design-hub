import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base64, base64url, hex, sha256 } from './bytes.ts';

test('sha256 of a known string', async () => {
  assert.equal(hex(await sha256('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('base64url swaps the two unsafe characters and drops padding', () => {
  const bytes = new Uint8Array([251, 255, 254]);
  assert.equal(base64(bytes), '+//+');
  assert.equal(base64url(bytes), '-__-');
  assert.equal(base64url(new Uint8Array([1])), 'AQ');
});
