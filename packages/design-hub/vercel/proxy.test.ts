import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import type { Person } from '../core/review/model.ts';
import { deployedReview } from '../server/api.ts';
import { fakeUpstash } from '../server/fake-upstash.ts';
import { createProxy, gatePreview } from './proxy.ts';

// The gate's clock: tests move it past CHECK_SECONDS instead of waiting.
let clock = Date.now();
const proxy = createProxy({ siteName: 'Acme <Hub>', now: () => new Date(clock) });
const STALE_MS = 5 * 60 * 1000;
/** Moves the gate's clock past the store's last yes, so the next request asks the store again. */
const goStale = () => {
  clock += STALE_MS;
};

const site = 'https://hub.example';
const realFetch = globalThis.fetch;
const SECRET = 's'.repeat(32);
const env: Record<string, string> = {
  GATE_SECRET: SECRET,
  KV_REST_API_URL: 'https://kv.test',
  KV_REST_API_TOKEN: 't',
};
const root = {
  id: 'cli',
  name: 'CLI',
  team: 'Studio',
  kind: 'studio',
  email: null,
  accessEndsAt: null,
  createdAt: '',
  revokedAt: null,
  epoch: 0,
} as Person;

const page = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${site}${path}`, { headers: { 'sec-fetch-dest': 'document', ...headers } });
const form = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${site}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-dest': 'document',
      ...headers,
    },
    body: '',
  });
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];
const passed = (r: Response) => r.headers.get('x-middleware-next') === '1';
const cleared = (r: Response) => /__Host-hub_person=;.*Max-Age=0/.test(r.headers.get('set-cookie') ?? '');
const maxAgeOf = (r: Response) => Number((r.headers.get('set-cookie') ?? '').match(/Max-Age=(\d+)/)?.[1]);
/** A request as curl sends it: no Sec-Fetch-Dest, Accept: *\/*. Only the cookie says who. */
const bare = (path: string, cookie: string) =>
  new Request(`${site}${path}`, { headers: { accept: '*/*', cookie } });
/** A store that answers every command with a 500. */
const storeDown = (() =>
  Promise.resolve(new Response('{"error":"down"}', { status: 500 }))) as unknown as typeof fetch;

beforeEach(() => {
  clock = Date.now();
  Object.assign(process.env, env);
  globalThis.fetch = fakeUpstash();
});
afterEach(() => {
  for (const k of Object.keys(env)) delete process.env[k];
  globalThis.fetch = realFetch;
});

const DAY_MS = 86_400_000;
// The service runs on the gate's clock, so moving it moves access ends and link expiry too.
const review = () => {
  const setup = deployedReview(process.env, null, () => new Date(clock));
  assert.ok(!('error' in setup));
  return setup.review;
};

/** Adds a person and signs one device in with their link; returns its cookie. */
async function signIn(input: Record<string, unknown> = { name: 'Rae', team: 'Acme' }) {
  const { person, token } = await review().addPerson(root, input);
  const used = await proxy(form(`/invite/${token}`));
  assert.equal(used.status, 303);
  return { person, token, cookie: cookieOf(used) };
}

async function assertSignInPage(r: Response) {
  assert.equal(r.status, 401);
  const html = await r.text();
  assert.match(html, /<main class="gate" data-gate="sign-in">/);
  assert.doesNotMatch(html, /<input|password/i);
}

test('fails closed without GATE_SECRET, or with a short one', async () => {
  delete process.env.GATE_SECRET;
  assert.equal((await proxy(page('/'))).status, 503);
  process.env.GATE_SECRET = 'short';
  assert.equal((await proxy(page('/'))).status, 503);
});

test('an anonymous page gets the sign-in page, and anything else a plain 401', async () => {
  const signedOut = await proxy(page('/sample-list/'));
  assert.equal(signedOut.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(signedOut.headers.get('referrer-policy'), 'no-referrer');
  assert.match(signedOut.headers.get('cache-control') ?? '', /no-store/);
  const csp = signedOut.headers.get('content-security-policy') ?? '';
  assert.match(csp, /script-src 'none'/);
  assert.equal(signedOut.headers.get('set-cookie'), null);
  const html = await signedOut.clone().text();
  // The policy's hash is the hash of the page's one style block, so the page renders and nothing else would.
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.ok(style.length > 100);
  const hash = createHash('sha256').update(style).digest('base64');
  assert.match(csp, new RegExp(`style-src 'sha256-${hash.replace(/[+/]/g, '\\$&')}'`));
  assert.equal(html.match(/<style>/g)?.length, 1);
  await assertSignInPage(signedOut);
  const asset = await proxy(new Request(`${site}/assets/index.js`));
  assert.equal(asset.status, 401);
  assert.match(asset.headers.get('content-type') ?? '', /text\/plain/);
  assert.equal(asset.headers.get('x-robots-tag'), 'noindex, nofollow');
  const api = await proxy(
    new Request(`${site}/api/review?op=me`, { headers: { accept: 'application/json' } }),
  );
  assert.equal(api.status, 401);
});

test('an anonymous POST anywhere but a link is a plain 401, never a pass', async () => {
  for (const path of ['/', '/api/review', '/sample-list/']) {
    const r = await proxy(form(path));
    assert.equal(r.status, 401);
    assert.match(r.headers.get('content-type') ?? '', /text\/plain/);
  }
  assert.equal((await proxy(new Request(`${site}/`, { method: 'DELETE' }))).status, 401);
});

test('a link shows who it is for on GET, escaped, and uses nothing up', async () => {
  const { token } = await review().addPerson(root, { name: 'Rae <b>', team: 'Acme & Co' });
  for (let i = 0; i < 3; i++) {
    const shown = await proxy(page(`/invite/${token}`));
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get('set-cookie'), null);
    // Same-origin, so Continue's POST carries a real Origin even where Sec-Fetch-Site is missing.
    assert.equal(shown.headers.get('referrer-policy'), 'same-origin');
    const html = await shown.text();
    assert.match(html, /data-gate="link"/);
    assert.match(html, /Rae &lt;b&gt;<\/strong>, Acme &amp; Co/);
    assert.match(html, /<title>Acme &lt;Hub&gt;<\/title>/);
    assert.match(html, /<form method="post">/);
  }
  // A preview bot that does not ask for HTML gets plain text, and still uses nothing up.
  assert.equal((await proxy(new Request(`${site}/invite/${token}`))).status, 200);
  assert.equal((await proxy(new Request(`${site}/invite/${token}`, { method: 'HEAD' }))).status, 200);
  assert.equal((await proxy(form(`/invite/${token}`))).status, 303);
});

test('a link POST signs one device in with the person cookie, to the access end', async () => {
  const { token } = await review().addPerson(root, { name: 'Rae', team: 'Acme', access: '3m' });
  const used = await proxy(form(`/invite/${token}`));
  assert.equal(used.status, 303);
  assert.equal(used.headers.get('location'), '/');
  const cookie = used.headers.get('set-cookie') ?? '';
  assert.match(cookie, /^__Host-hub_person=p3\./);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  const maxAge = Number(cookie.match(/Max-Age=(\d+)/)?.[1]);
  assert.ok(maxAge > 88 * 86_400 && maxAge <= 92 * 86_400, String(maxAge));
  assert.ok(passed(await proxy(page('/', { cookie: cookieOf(used) }))));
  assert.ok(
    passed(await proxy(new Request(`${site}/assets/index.js`, { headers: { cookie: cookieOf(used) } }))),
  );
});

test('a used link is 404 on POST and on GET', async () => {
  const { token } = await signIn();
  const again = await proxy(form(`/invite/${token}`));
  assert.equal(again.status, 404);
  assert.equal(again.headers.get('set-cookie'), null);
  assert.match(await again.text(), /data-gate="used"/);
  assert.equal(again.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await proxy(page(`/invite/${token}`))).status, 404);
});

test('two POSTs of one link at once sign in one device', async () => {
  const { token } = await review().addPerson(root, { name: 'Rae', team: 'Acme' });
  const both = await Promise.all([proxy(form(`/invite/${token}`)), proxy(form(`/invite/${token}`))]);
  assert.deepEqual(both.map((r) => r.status).sort(), [303, 404]);
});

test('a cross-site link POST is refused and uses nothing up', async () => {
  const { token } = await review().addPerson(root, { name: 'Rae', team: 'Acme' });
  assert.equal((await proxy(form(`/invite/${token}`, { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal(
    (await proxy(form(`/invite/${token}`, { 'sec-fetch-site': '', origin: 'https://evil.example' }))).status,
    403,
  );
  assert.equal((await proxy(form(`/invite/${token}`))).status, 303);
});

test('an unknown or malformed link is 404, and other methods on a link are 405', async () => {
  assert.equal((await proxy(page(`/invite/${'x'.repeat(43)}`))).status, 404);
  assert.equal((await proxy(form(`/invite/${'x'.repeat(43)}`))).status, 404);
  assert.equal((await proxy(page('/invite/short'))).status, 401);
  assert.equal((await proxy(new Request(`${site}/invite/${'x'.repeat(43)}`, { method: 'PUT' }))).status, 405);
});

test('a link for a revoked person, or one whose access has ended, is 404', async () => {
  const gone = await review().addPerson(root, { name: 'Rae', team: 'Acme' });
  const { token: second } = await review().newLink(root, gone.person.id);
  await review().revoke(root, gone.person.id);
  assert.equal((await proxy(page(`/invite/${second}`))).status, 404);
  // Three months of access; a link made near the end outlives it.
  const ended = await review().addPerson(root, { name: 'Oz', team: 'Acme', access: '3m' });
  clock += 85 * DAY_MS;
  const { token: late } = await review().newLink(root, ended.person.id);
  assert.equal((await proxy(page(`/invite/${late}`))).status, 200);
  clock += 7 * DAY_MS;
  assert.equal((await proxy(page(`/invite/${late}`))).status, 404);
  assert.equal((await proxy(form(`/invite/${late}`))).status, 404);
});

test('a link unused for 14 days is 404', async () => {
  const { token } = await review().addPerson(root, { name: 'Rae', team: 'Acme', access: 'open' });
  clock += 14 * DAY_MS - 1000;
  assert.equal((await proxy(page(`/invite/${token}`))).status, 200);
  clock += 1000;
  assert.equal((await proxy(page(`/invite/${token}`))).status, 404);
  assert.equal((await proxy(form(`/invite/${token}`))).status, 404);
});

test('a cookie from another site with the same secret is refused', async () => {
  const { cookie } = await signIn();
  assert.ok(passed(await proxy(page('/', { cookie }))));
  // A copied project: same GATE_SECRET, its own store.
  process.env.KV_REST_API_URL = 'https://kv-other.test';
  const elsewhere = await proxy(bare('/', cookie));
  assert.equal(elsewhere.status, 401);
  assert.ok(cleared(elsewhere));
});

test('while the store’s yes is fresh a request passes on the signature, with no store read', async () => {
  const { cookie } = await signIn();
  globalThis.fetch = (() => {
    throw new Error('the store was asked');
  }) as unknown as typeof fetch;
  const fresh = await proxy(bare('/sample-list/', cookie));
  assert.ok(passed(fresh));
  assert.equal(fresh.headers.get('set-cookie'), null);
  assert.ok(passed(await proxy(page('/', { cookie }))));
});

test('once stale, a current person passes with a re-issued cookie, whatever the request claims to be', async () => {
  const { cookie } = await signIn();
  goStale();
  const asked = await proxy(bare('/assets/index.js', cookie));
  assert.ok(passed(asked));
  const renewed = cookieOf(asked);
  assert.match(renewed, /^__Host-hub_person=p3\./);
  assert.notEqual(renewed, cookie);
  assert.match(asked.headers.get('set-cookie') ?? '', /HttpOnly; Secure; SameSite=Lax/);
  // The new stamp is fresh again: no store read for the next five minutes.
  globalThis.fetch = (() => {
    throw new Error('the store was asked');
  }) as unknown as typeof fetch;
  const next = await proxy(bare('/assets/index.js', renewed));
  assert.ok(passed(next));
  assert.equal(next.headers.get('set-cookie'), null);
});

for (const [what, end] of [
  ['a revoke', (id: string) => review().revoke(root, id)],
  ['a sign out everywhere', (id: string) => review().signOutEverywhere(root, id)],
  [
    'the access end',
    async (id: string) => {
      // Shortened to three months after an open-ended sign-in, then three months pass: the cookie still holds, the store says no.
      await review().setAccess(root, id, '3m');
      clock += 92 * DAY_MS;
    },
  ],
] as const)
  test(`after ${what}, a stale-stamp request of any kind is 401 and the cookie is cleared`, async () => {
    const { person, cookie } = await signIn({ name: 'Rae', team: 'Acme', access: 'open' });
    await end(person.id);
    goStale();
    // As curl asks: no Sec-Fetch-Dest, Accept: */*.
    const asset = await proxy(bare('/sample-list/', cookie));
    assert.equal(asset.status, 401);
    assert.ok(cleared(asset));
    assert.match(asset.headers.get('content-type') ?? '', /text\/plain/);
    const api = await proxy(
      new Request(`${site}/api/review`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
        body: '{"op":"me"}',
      }),
    );
    assert.equal(api.status, 401);
    const html = await proxy(page('/', { cookie }));
    assert.ok(cleared(html));
    await assertSignInPage(html);
  });

test('an extended or shortened access end reaches a signed-in cookie when it is re-issued', async () => {
  const { person, cookie } = await signIn({ name: 'Rae', team: 'Acme', access: '3m' });
  goStale();
  const before = maxAgeOf(await proxy(bare('/', cookie)));
  assert.ok(before < 93 * 86_400, String(before));
  await review().setAccess(root, person.id, 'open');
  const longer = await proxy(bare('/', cookie));
  assert.ok(passed(longer));
  assert.equal(maxAgeOf(longer), 400 * 86_400);
  // Shortened again: the open-ended cookie is cut back at its next check.
  await review().setAccess(root, person.id, '3m');
  goStale();
  const shorter = await proxy(bare('/', cookieOf(longer)));
  assert.ok(passed(shorter));
  assert.ok(maxAgeOf(shorter) < 93 * 86_400, String(maxAgeOf(shorter)));
});

test('a store that fails is 503 and keeps the cookie: an outage signs nobody out', async () => {
  const { cookie, token } = await signIn();
  const { token: unused } = await review().addPerson(root, { name: 'Oz', team: 'Acme' });
  goStale();
  const healthy = globalThis.fetch;
  globalThis.fetch = storeDown;
  for (const r of [await proxy(page('/', { cookie })), await proxy(bare('/x.js', cookie))]) {
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('retry-after'), '30');
    assert.equal(r.headers.get('set-cookie'), null);
  }
  assert.equal((await proxy(page(`/invite/${unused}`))).status, 503);
  assert.equal((await proxy(form(`/invite/${unused}`))).status, 503);
  assert.equal((await proxy(form(`/invite/${token}`))).status, 503);
  // Back up, nothing was lost: the session holds and the unused link still works once.
  globalThis.fetch = healthy;
  assert.ok(passed(await proxy(page('/', { cookie }))));
  assert.equal((await proxy(form(`/invite/${unused}`))).status, 303);
  assert.equal((await proxy(form(`/invite/${unused}`))).status, 404);
});

test('an old cookie gets the sign-in page: 0.6 person and gate tokens, and an unstamped p2', async () => {
  const { person } = await review().addPerson(root, { name: 'Rae', team: 'Acme' });
  const expires = Math.floor(Date.now() / 1000) + 86_400;
  const sign = (message: string) => createHmac('sha256', SECRET).update(message).digest('base64url');
  const p1 = await proxy(
    page('/', {
      cookie: `__Host-hub_person=${person.id}.0.${expires}.${sign(`p1.${person.id}.0.${expires}`)}`,
    }),
  );
  assert.ok(cleared(p1));
  await assertSignInPage(p1);
  const p2 = `p2.${person.id}.0.${expires}.${sign(`p2.${person.id}.0.${expires}`)}`;
  const asP2 = await proxy(bare('/', `__Host-hub_person=${p2}`));
  assert.equal(asP2.status, 401);
  assert.ok(cleared(asP2));
  await assertSignInPage(await proxy(page('/', { cookie: `__Host-hub_person=${p2}` })));
  // 0.6's gate cookie, signed exactly as 0.6 signed it over a password: valid then, never read now.
  const passwordHash = createHash('sha256').update('correct-horse').digest('base64url');
  const oldGate = `${expires}.${sign(`v1.${expires}.${passwordHash}`)}`;
  const gateOnly = await proxy(page('/', { cookie: `__Host-hub_gate=${oldGate}` }));
  assert.equal(gateOnly.headers.get('set-cookie'), null);
  await assertSignInPage(gateOnly);
});

test('a password in the env changes nothing', async () => {
  const name = ['GATE', 'PASSWORD'].join('_');
  process.env[name] = 'correct-horse';
  try {
    await assertSignInPage(await proxy(page('/')));
    const body = 'password=correct-horse';
    const posted = await proxy(
      new Request(`${site}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' },
        body,
      }),
    );
    assert.equal(posted.status, 401);
    assert.equal(posted.headers.get('set-cookie'), null);
    delete process.env.GATE_SECRET;
    assert.equal((await proxy(page('/'))).status, 503);
  } finally {
    delete process.env[name];
  }
});

test('only the gate font and favicon load before sign-in', async () => {
  const font = new Request(`${site}/_gate/geist.woff2`, { headers: { 'sec-fetch-dest': 'font' } });
  assert.ok(passed(await proxy(font)));
  assert.ok(passed(await proxy(new Request(`${site}/favicon.svg`))));
  assert.equal((await proxy(new Request(`${site}/_gate/other.woff2`))).status, 401);
  assert.equal((await proxy(new Request(`${site}/_gate/geist.woff2`, { method: 'POST' }))).status, 401);
  const csp = (await proxy(page('/'))).headers.get('content-security-policy') ?? '';
  assert.match(csp, /font-src 'self'/);
});

test('without a review store a link and a stale session answer 503, and the cookie stays', async () => {
  const { cookie, token } = await signIn();
  delete process.env.KV_REST_API_URL;
  assert.equal((await proxy(page(`/invite/${token}`))).status, 503);
  assert.equal((await proxy(form(`/invite/${token}`))).status, 503);
  goStale();
  const r = await proxy(page('/', { cookie }));
  assert.equal(r.status, 503);
  // No store at all is not a passing outage: no Retry-After, so the panel stays off.
  assert.equal(r.headers.get('retry-after'), null);
  assert.equal(r.headers.get('set-cookie'), null);
});

test('the dev preview renders each gate page with the same policy', async () => {
  assert.match((await gatePreview(null)).html, /data-gate="sign-in"/);
  assert.match((await gatePreview('link')).html, /data-gate="link"/);
  assert.match((await gatePreview('used', 'A & B')).html, /<h1>A &amp; B<\/h1>/);
  assert.match((await gatePreview('nope')).csp, /script-src 'none'/);
  // Names on Object.prototype fall back to the sign-in page instead of throwing.
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty'])
    assert.match((await gatePreview(name)).html, /data-gate="sign-in"/);
});
