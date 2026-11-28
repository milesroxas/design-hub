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
  SITE_SCOPE,
  sameOrigin,
  sessionCookie,
  sessionSeconds,
} from './session.ts';

const SITE = 'https://kv-a.test';
const gate = { secret: 's'.repeat(32), site: SITE, client: 'acme' };
const DAY = 86_400;
const T0 = new Date('2030-01-01T00:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const t0 = T0.getTime() / 1000;
const inDays = (days: number) => at(days * DAY).toISOString();
const sign = (message: string) => createHmac('sha256', gate.secret).update(message).digest('base64url');

test('the gate needs only the secret, fails closed on a short one, and serves the site’s one client', () => {
  assert.equal(readGate({}), null);
  assert.equal(readGate({ GATE_SECRET: 'short' }), null);
  const client = SITE_SCOPE.client;
  // Without a store the site is empty: the gate still answers, and its 503 paths say why nobody can sign in.
  assert.deepEqual(readGate({ GATE_SECRET: 's'.repeat(32) }), { secret: 's'.repeat(32), site: '', client });
  assert.deepEqual(readGate({ GATE_SECRET: 's'.repeat(32), KV_REST_API_URL: `${SITE}/` }), {
    secret: 's'.repeat(32),
    site: SITE,
    client,
  });
  assert.equal(readGate({ GATE_SECRET: 's'.repeat(32), UPSTASH_REDIS_REST_URL: SITE })?.site, SITE);
});

test('a person token names its person, epoch, kind, client and when the store last said yes, and nothing forged verifies', async () => {
  const token = await issuePersonToken(gate, { id: 'abc123', epoch: 2, kind: 'client' }, null, T0);
  assert.deepEqual(await readPersonToken(gate, token, T0), {
    id: 'abc123',
    epoch: 2,
    kind: 'client',
    checkedAt: t0,
  });
  const [version, id, , kind, client, expires, checkedAt, sig] = token.split('.');
  assert.equal(version, 'p5');
  assert.equal(kind, 'client');
  assert.equal(client, 'acme');
  const forged = (parts: (string | number)[]) => readPersonToken(gate, parts.join('.'), T0);
  assert.equal(await forged([version, id, 3, kind, client, expires, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, kind, client, Number(expires) + 1, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, kind, client, expires, Number(checkedAt) + 600, sig]), null);
  // A Client's cookie that claims Studio fails the signature, and so does an unknown kind.
  assert.equal(await forged([version, id, 2, 'studio', client, expires, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, 'admin', client, expires, checkedAt, sig]), null);
  assert.equal(await forged([version, id, 2, '', client, expires, checkedAt, sig]), null);
  // Dropping the client does not turn the token into a p4.
  assert.equal(await forged(['p4', id, 2, kind, expires, checkedAt, sig]), null);
  assert.equal(await readPersonToken({ ...gate, secret: 't'.repeat(32) }, token, T0), null);
  assert.equal(await readPersonToken(gate, `${token}.x`, T0), null);
  assert.equal(await readPersonToken(gate, undefined, T0), null);
  const studio = await issuePersonToken(gate, { id: 'abc123', epoch: 0, kind: 'studio' }, null, T0);
  assert.equal((await readPersonToken(gate, studio, T0))?.kind, 'studio');
});

test('a token signed to one client fails on another, Studio’s included, and on the studio’s own host', async () => {
  const onB = { ...gate, client: 'bravo' };
  const onStudio = { ...gate, client: 'studio' };
  for (const kind of ['client', 'studio'] as const) {
    const token = await issuePersonToken(gate, { id: 'abc123', epoch: 0, kind }, null, T0);
    assert.ok(await readPersonToken(gate, token, T0), kind);
    assert.equal(await readPersonToken(onB, token, T0), null, `${kind} on B`);
    assert.equal(await readPersonToken(onStudio, token, T0), null, `${kind} on the studio host`);
    const [version, id, epoch, k, , expires, checkedAt, sig] = token.split('.');
    // Naming B in the token, with A's signature, fails on either.
    const renamed = [version, id, epoch, k, 'bravo', expires, checkedAt, sig].join('.');
    assert.equal(await readPersonToken(onB, renamed, T0), null, `${kind} renamed, on B`);
    assert.equal(await readPersonToken(gate, renamed, T0), null, `${kind} renamed, on A`);
  }
  // B's own token is B's alone.
  const bees = await issuePersonToken(onB, { id: 'bee1', epoch: 0, kind: 'client' }, null, T0);
  assert.ok(await readPersonToken(onB, bees, T0));
  assert.equal(await readPersonToken(gate, bees, T0), null);
});

test('p4 and every older token never verify, even signed with the secret', async () => {
  const expires = t0 + DAY;
  const read = (token: string) => readPersonToken(gate, token, T0);
  // 0.6: <id>.<epoch>.<expires>.<sig> over p1.<id>.<epoch>.<expires>.
  assert.equal(await read(`abc123.0.${expires}.${sign(`p1.abc123.0.${expires}`)}`), null);
  // The unstamped p2 of the first slice-3 build.
  assert.equal(await read(`p2.abc123.0.${expires}.${sign(`p2.abc123.0.${expires}`)}`), null);
  // A valid p3, the version before the kind: once honoured as stale, now never.
  assert.equal(
    await read(`p3.abc123.0.${expires}.${t0}.${sign(`p3\n${SITE}\nabc123.0.${expires}.${t0}`)}`),
    null,
  );
  // A valid p4, the version before the client.
  assert.equal(
    await read(
      `p4.abc123.0.client.${expires}.${t0}.${sign(`p4\n${SITE}\nabc123.0.client.${expires}.${t0}`)}`,
    ),
    null,
  );
  // p4's message under the p5 prefix, with and without the client in the token.
  assert.equal(
    await read(
      `p5.abc123.0.client.acme.${expires}.${t0}.${sign(`p4\n${SITE}\nabc123.0.client.${expires}.${t0}`)}`,
    ),
    null,
  );
  assert.equal(
    await read(
      `p5.abc123.0.client.${expires}.${t0}.${sign(`p5\n${SITE}\nabc123.0.client.${expires}.${t0}`)}`,
    ),
    null,
  );
  // The right message and signature, but an id the store never makes, or a client that is no slug.
  assert.equal(
    await read(
      `p5.ABC.0.client.acme.${expires}.${t0}.${sign(`p5\n${SITE}\nABC.0.client.acme.${expires}.${t0}`)}`,
    ),
    null,
  );
  // The message without the site.
  assert.equal(
    await read(
      `p5.abc123.0.client.acme.${expires}.${t0}.${sign(`p5.abc123.0.client.acme.${expires}.${t0}`)}`,
    ),
    null,
  );
  // A version after this one, signed its way.
  assert.equal(
    await read(
      `p6.abc123.0.client.acme.${expires}.${t0}.${sign(`p6\n${SITE}\nabc123.0.client.acme.${expires}.${t0}`)}`,
    ),
    null,
  );
  assert.equal(await read(`__proto__.abc123.0.${expires}.${t0}.x`), null);
  // What this version signs, built by hand, does verify: the rows above fail on their version alone.
  assert.ok(
    await read(
      `p5.abc123.0.client.acme.${expires}.${t0}.${sign(`p5\n${SITE}\nabc123.0.client.acme.${expires}.${t0}`)}`,
    ),
  );
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
    Number((await issuePersonToken(gate, { id: 'a1', epoch: 0, kind: 'client' }, endsAt, T0)).split('.')[5]) -
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
