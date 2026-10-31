import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gateValues } from './bootstrap.ts';

test('keeps the password and secret already set, so a second run changes nothing', () => {
  const env = { GATE_PASSWORD: 'kept-password', GATE_SECRET: 's'.repeat(44) };
  assert.deepEqual(gateValues(undefined, env), {
    password: 'kept-password',
    secret: env.GATE_SECRET,
    rotated: false,
  });
  assert.equal(gateValues('kept-password', env).rotated, false);
});

test('a new password given rotates it and keeps the secret', () => {
  const env = { GATE_PASSWORD: 'old-password', GATE_SECRET: 'secret' };
  assert.deepEqual(gateValues('new-password', env), {
    password: 'new-password',
    secret: 'secret',
    rotated: true,
  });
});

test('makes a readable 12-character password and a 32-byte secret when none exist', () => {
  const { password, secret } = gateValues(undefined, {});
  assert.match(password, /^[a-hjkmnp-z2-9]{12}$/);
  assert.equal(Buffer.from(secret, 'base64').length, 32);
  assert.throws(() => gateValues('short', {}), /8 characters or more/);
});
