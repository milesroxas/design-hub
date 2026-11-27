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

test('a person token names its person, epoch, kind and when the store last said yes, and nothing forged verifies', async () => {
  const token = await issuePersonToken(gate, { id: 'abc123', epoch: 2, kind: 'client' }, null, T0);
  assert.deepEqual(await readPersonToken(gate, token, T0), {
    id: 'abc123',
    epoch: 2,
    kind: 'client',
    checkedAt: t0,
  });
  const [version, id, , kind, expires, checkedAt, sig] = token.split('.');
  assert.equal(version, 'p4');
  assert.equal(kind, 'client');
  const forged = (parts: (string | number)[]) => readPersonToken(gate, parts.join('.'), T0);
  assert.equal(await forged([version, id, 3, kind, expires, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, kind, Number(expires) + 1, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, kind, expires, Number(checkedAt) + 600, sig]), null);
  // A Client's cookie that claims Studio fails the signature, and so does an unknown kind.
  assert.equal(await forged([version, id, 2, 'studio', expires, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, 'admin', expires, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, '', expires, checkedAt, sig]), null);
  // Dropping the kind does not turn the token into a p3.
  assert.equal(await forged(['p3', id, 2, expires, checkedAt, sig]), null);
  assert.equal(await readPersonToken({ ...gate, secret: 't'.repeat(32) }, token, T0), null);
  assert.equal(await readPersonToken(gate, `${token}.x`, T0), null);
  assert.equal(await readPersonToken(gate, undefined, T0), null);
  const studio = await issuePersonToken(gate, { id: 'abc123', epoch: 0, kind: 'studio' }, null, T0);
  assert.equal((await readPersonToken(gate, studio, T0))?.kind, 'studio');
});

test('a token of another version or shape never verifies, even signed with the secret', async () => {
  const expires = t0 + DAY;
  const read = (token: string) => readPersonToken(gate, token, T0);
  // 0.6: <id>.<epoch>.<expires>.<sig> over p1.<id>.<epoch>.<expires>.
  assert.equal(await read(`abc123.0.${expires}.${sign(`p1.abc123.0.${expires}`)}`), null);
  // The unstamped p2 of the first slice-3 build.
  assert.equal(await read(`p2.abc123.0.${expires}.${sign(`p2.abc123.0.${expires}`)}`), null);
  // The p3 prefix carrying an older version's signature, with and without a stamp.
  assert.equal(await read(`p3.abc123.0.${expires}.${t0}.${sign(`p2.abc123.0.${expires}`)}`), null);
  assert.equal(await read(`p3.abc123.0.${expires}.${t0}.${sign(`p2.abc123.0.${expires}.${t0}`)}`), null);
  // The right message and signature, but an id the store never makes.
  assert.equal(await read(`p3.ABC.0.${expires}.${t0}.${sign(`p3\n${SITE}\nABC.0.${expires}.${t0}`)}`), null);
  // The 0.6-shaped message under the p3 prefix, without the site.
  assert.equal(await read(`p3.abc123.0.${expires}.${t0}.${sign(`p3.abc123.0.${expires}.${t0}`)}`), null);
  // A p4 signed over p3's message, or a p3 signed over p4's: each version verifies only its own.
  assert.equal(
    await read(`p4.abc123.0.client.${expires}.${t0}.${sign(`p3\n${SITE}\nabc123.0.${expires}.${t0}`)}`),
    null,
  );
  assert.equal(
    await read(`p3.abc123.0.${expires}.${t0}.${sign(`p4\n${SITE}\nabc123.0.client.${expires}.${t0}`)}`),
    null,
  );
  assert.equal(
    await read(
      `p5.abc123.0.client.${expires}.${t0}.${sign(`p5\n${SITE}\nabc123.0.client.${expires}.${t0}`)}`,
    ),
    null,
  );
  assert.equal(await read(`__proto__.abc123.0.${expires}.${t0}.x`), null);
});

test('a valid p3 token from before the kind is still honoured, as stale, so nobody is signed out', async () => {
  const expires = t0 + DAY;
  const p3 = `p3.abc123.0.${expires}.${t0}.${sign(`p3\n${SITE}\nabc123.0.${expires}.${t0}`)}`;
  const claim = await readPersonToken(gate, p3, T0);
  assert.deepEqual(claim, { id: 'abc123', epoch: 0, kind: null, checkedAt: t0 });
  assert.ok(claim);
  // Stamped this very second, and still asked again: the store says who they are.
  assert.equal(isFresh(claim, T0), false);
  assert.equal(await readPersonToken(gate, p3, at(DAY)), null);
  assert.equal(await readPersonToken({ ...gate, site: 'https://kv-b.test' }, p3, T0), null);
});

test('a token is bound to its site: the same secret on another store does not accept it', async () => {
  const token = await issuePersonToken(gate, { id: 'abc123', epoch: 0, kind: 'studio' }, null, T0);
  assert.ok(await readPersonToken(gate, token, T0));
  assert.equal(await readPersonToken({ ...gate, site: 'https://kv-b.test' }, token, T0), null);
  assert.equal(await readPersonToken({ ...gate, site: '' }, token, T0), null);
  // The site is signed, never written into the token.
  assert.equal(token.includes('kv-a'), false);
});

test('the store’s yes is trusted for CHECK_SECONDS, then asked again', async () => {
  const claim = await readPersonToken(
    gate,
    await issuePersonToken(gate, { id: 'a1', epoch: 0, kind: 'client' }, null, T0),
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
    Number((await issuePersonToken(gate, { id: 'a1', epoch: 0, kind: 'client' }, endsAt, T0)).split('.')[4]) -
    t0;
  assert.equal(await expiresOf(inDays(90)), 90 * DAY);
  assert.equal(await expiresOf(null), 400 * DAY);
  const token = await issuePersonToken(gate, { id: 'a1', epoch: 0, kind: 'client' }, inDays(90), T0);
  assert.ok(await readPersonToken(gate, token, at(90 * DAY - 1)));
  assert.equal(await readPersonToken(gate, token, at(90 * DAY)), null);
  // An access end that has passed makes a token that is already dead.
  assert.equal(
    await readPersonToken(
      gate,
      await issuePersonToken(gate, { id: 'a1', epoch: 0, kind: 'client' }, inDays(-1), T0),
      T0,
    ),
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
