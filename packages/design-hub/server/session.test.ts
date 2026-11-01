import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  gateTokenIsValid,
  issueGateToken,
  issuePersonToken,
  passwordMatches,
  readCookie,
  readGate,
  readPersonToken,
  sameOrigin,
} from './session.ts';

const gate = { password: 'open sesame', secret: 's'.repeat(32) };

test('the gate fails closed without a password or with a short secret', () => {
  assert.equal(readGate({ GATE_PASSWORD: 'x' }), null);
  assert.equal(readGate({ GATE_PASSWORD: 'x', GATE_SECRET: 'short' }), null);
  assert.ok(readGate({ GATE_PASSWORD: 'x', GATE_SECRET: 's'.repeat(32) }));
});

test('a gate token holds until the password rotates', async () => {
  const token = await issueGateToken(gate);
  assert.equal(await gateTokenIsValid(gate, token), true);
  assert.equal(await gateTokenIsValid({ ...gate, password: 'new one!' }, token), false);
  assert.equal(await gateTokenIsValid(gate, `${token}x`), false);
  assert.equal(await gateTokenIsValid(gate, `1.${token.split('.')[1]}`), false);
});

test('a person token names its person and epoch, and nothing forged', async () => {
  const token = await issuePersonToken(gate, { id: 'abc123', epoch: 2 });
  assert.deepEqual(await readPersonToken(gate, token), { id: 'abc123', epoch: 2 });
  const [id, , expires, sig] = token.split('.');
  assert.equal(await readPersonToken(gate, `${id}.3.${expires}.${sig}`), null);
  assert.equal(await readPersonToken({ ...gate, secret: 't'.repeat(32) }, token), null);
  // A gate token is never a person token.
  assert.equal(await readPersonToken(gate, await issueGateToken(gate)), null);
});

test('the password compare is exact', async () => {
  assert.equal(await passwordMatches(gate, 'open sesame'), true);
  assert.equal(await passwordMatches(gate, 'open sesame '), false);
});

test('cookies and origins', () => {
  const r = (headers: Record<string, string>) =>
    new Request('https://hub.example/x', { method: 'POST', headers });
  assert.equal(readCookie(r({ cookie: 'a=1; __Host-hub_gate=t.s' }), '__Host-hub_gate'), 't.s');
  assert.equal(sameOrigin(r({ 'sec-fetch-site': 'cross-site' })), false);
  assert.equal(sameOrigin(r({ origin: 'https://evil.example', host: 'hub.example' })), false);
  assert.equal(
    sameOrigin(r({ origin: 'https://hub.example', host: 'hub.example', 'sec-fetch-site': 'same-origin' })),
    true,
  );
});
