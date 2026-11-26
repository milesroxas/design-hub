import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  CHECK_SECONDS,
  clearedCookie,
  isFresh,
  issuePersonToken,
  readCookie,
  readGate,
  readPersonToken,
  sameOrigin,
  sessionCookie,
  sessionSeconds,
} from './session.ts';

const SITE = 'https://kv-a.test';
const gate = { secret: 's'.repeat(32), site: SITE };
const DAY = 86_400;
const T0 = new Date('2030-01-01T00:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const t0 = T0.getTime() / 1000;
const inDays = (days: number) => at(days * DAY).toISOString();
const sign = (message: string) => createHmac('sha256', gate.secret).update(message).digest('base64url');

test('the gate needs only the secret, and fails closed on a short one', () => {
  assert.equal(readGate({}), null);
  assert.equal(readGate({ GATE_SECRET: 'short' }), null);
  // Without a store the site is empty: the gate still answers, and its 503 paths say why nobody can sign in.
  assert.deepEqual(readGate({ GATE_SECRET: 's'.repeat(32) }), { secret: 's'.repeat(32), site: '' });
  assert.deepEqual(readGate({ GATE_SECRET: 's'.repeat(32), KV_REST_API_URL: `${SITE}/` }), {
    secret: 's'.repeat(32),
    site: SITE,
  });
  assert.equal(readGate({ GATE_SECRET: 's'.repeat(32), UPSTASH_REDIS_REST_URL: SITE })?.site, SITE);
});

test('a person token names its person, epoch and when the store last said yes, and nothing forged verifies', async () => {
  const token = await issuePersonToken(gate, { id: 'abc123', epoch: 2 }, null, T0);
  assert.deepEqual(await readPersonToken(gate, token, T0), { id: 'abc123', epoch: 2, checkedAt: t0 });
  const [version, id, , expires, checkedAt, sig] = token.split('.');
  assert.equal(version, 'p3');
  const forged = (parts: (string | number)[]) => readPersonToken(gate, parts.join('.'), T0);
  assert.equal(await forged([version, id, 3, expires, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, Number(expires) + 1, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, expires, Number(checkedAt) + 600, sig]), null);
  assert.equal(await readPersonToken({ ...gate, secret: 't'.repeat(32) }, token, T0), null);
  assert.equal(await readPersonToken(gate, `${token}.x`, T0), null);
  assert.equal(await readPersonToken(gate, undefined, T0), null);
});

test('a token of another version or shape never verifies, even signed with the secret', async () => {
  const expires = t0 + DAY;
  const read = (token: string) => readPersonToken(gate, token, T0);
  // 0.6: <id>.<epoch>.<expires>.<sig> over p1.<id>.<epoch>.<expires>.
  assert.equal(await read(`abc123.0.${expires}.${sign(`p1.abc123.0.${expires}`)}`), null);
  // The unstamped p2 of the first slice-3 build.
  assert.equal(await read(`p2.abc123.0.${expires}.${sign(`p2.abc123.0.${expires}`)}`), null);
  // The current prefix carrying an older version's signature, with and without a stamp.
  assert.equal(await read(`p3.abc123.0.${expires}.${t0}.${sign(`p2.abc123.0.${expires}`)}`), null);
  assert.equal(await read(`p3.abc123.0.${expires}.${t0}.${sign(`p2.abc123.0.${expires}.${t0}`)}`), null);
  // The right message and signature, but an id the store never makes.
  assert.equal(await read(`p3.ABC.0.${expires}.${t0}.${sign(`p3\n${SITE}\nABC.0.${expires}.${t0}`)}`), null);
  // The 0.6-shaped message under the current prefix, without the site.
  assert.equal(await read(`p3.abc123.0.${expires}.${t0}.${sign(`p3.abc123.0.${expires}.${t0}`)}`), null);
  const good = `p3.abc123.0.${expires}.${t0}.${sign(`p3\n${SITE}\nabc123.0.${expires}.${t0}`)}`;
  assert.deepEqual(await read(good), { id: 'abc123', epoch: 0, checkedAt: t0 });
});

test('a token is bound to its site: the same secret on another store does not accept it', async () => {
  const token = await issuePersonToken(gate, { id: 'abc123', epoch: 0 }, null, T0);
  assert.ok(await readPersonToken(gate, token, T0));
  assert.equal(await readPersonToken({ ...gate, site: 'https://kv-b.test' }, token, T0), null);
  assert.equal(await readPersonToken({ ...gate, site: '' }, token, T0), null);
  // The site is signed, never written into the token.
  assert.equal(token.includes('kv-a'), false);
});

test('the store’s yes is trusted for CHECK_SECONDS, then asked again', async () => {
  const claim = await readPersonToken(
    gate,
    await issuePersonToken(gate, { id: 'a1', epoch: 0 }, null, T0),
    T0,
  );
  assert.ok(claim);
  assert.equal(CHECK_SECONDS, 300);
  assert.equal(isFresh(claim, T0), true);
  assert.equal(isFresh(claim, at(CHECK_SECONDS - 1)), true);
  assert.equal(isFresh(claim, at(CHECK_SECONDS)), false);
  // A stamp from the future is not trusted either.
  assert.equal(isFresh(claim, at(-1)), false);
});

test('a session lasts to the access end, capped at 400 days', async () => {
  assert.equal(sessionSeconds(null, T0), 400 * DAY);
  assert.equal(sessionSeconds(inDays(800), T0), 400 * DAY);
  assert.equal(sessionSeconds(inDays(90), T0), 90 * DAY);
  assert.equal(sessionSeconds(inDays(-1), T0), 0);
  assert.equal(sessionSeconds('not a date', T0), 0);
  const expiresOf = async (endsAt: string | null) =>
    Number((await issuePersonToken(gate, { id: 'a1', epoch: 0 }, endsAt, T0)).split('.')[3]) - t0;
  assert.equal(await expiresOf(inDays(90)), 90 * DAY);
  assert.equal(await expiresOf(null), 400 * DAY);
  const token = await issuePersonToken(gate, { id: 'a1', epoch: 0 }, inDays(90), T0);
  assert.ok(await readPersonToken(gate, token, at(90 * DAY - 1)));
  assert.equal(await readPersonToken(gate, token, at(90 * DAY)), null);
  // An access end that has passed makes a token that is already dead.
  assert.equal(
    await readPersonToken(gate, await issuePersonToken(gate, { id: 'a1', epoch: 0 }, inDays(-1), T0), T0),
    null,
  );
});

test('cookies', () => {
  const r = new Request('https://hub.example/x', { headers: { cookie: 'a=1; __Host-hub_person=t.s' } });
  assert.equal(readCookie(r, '__Host-hub_person'), 't.s');
  assert.equal(readCookie(new Request('https://hub.example/'), '__Host-hub_person'), undefined);
  assert.equal(
    sessionCookie('__Host-hub_person', 'v', 60),
    '__Host-hub_person=v; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax',
  );
  assert.match(clearedCookie('__Host-hub_person'), /^__Host-hub_person=; Path=\/; Max-Age=0;/);
});

test('origins: cross-site and a bare Origin: null are refused, an absent Origin passes', () => {
  const r = (headers: Record<string, string>) =>
    sameOrigin(
      new Request('https://hub.example/x', { method: 'POST', headers: { host: 'hub.example', ...headers } }),
    );
  assert.equal(r({ 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(r({ 'sec-fetch-site': 'same-site', origin: 'https://hub.example' }), false);
  assert.equal(r({ origin: 'https://evil.example' }), false);
  assert.equal(r({ origin: 'http://hub.example' }), false);
  assert.equal(r({ origin: 'https://hub.example', 'sec-fetch-site': 'same-origin' }), true);
  // What the link page's same-origin referrer policy makes older Safari send: a real Origin, no Sec-Fetch-Site.
  assert.equal(r({ origin: 'https://hub.example' }), true);
  // Origin: null passes only with the browser's own same-origin verdict.
  assert.equal(r({ origin: 'null' }), false);
  assert.equal(r({ origin: 'null', 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(r({ origin: 'null', 'sec-fetch-site': 'same-origin' }), true);
  // No Origin and no Sec-Fetch-Site is not a browser, so not a forged request: it passes on purpose.
  assert.equal(r({}), true);
  assert.equal(r({ origin: 'not a url' }), false);
});
