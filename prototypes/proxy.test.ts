import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { Person } from './_core/review/model.ts';
import { deployedReview } from './_server/api.ts';
import { fakeUpstash } from './_server/fake-upstash.ts';
import proxy from './proxy.ts';

const site = 'https://hub.example';
const realFetch = globalThis.fetch;
const env = {
  GATE_PASSWORD: 'correct-horse',
  GATE_SECRET: 's'.repeat(32),
  KV_REST_API_URL: 'https://kv.test',
  KV_REST_API_TOKEN: 't',
};
const root = {
  id: 'cli',
  name: 'CLI',
  team: 'Studio',
  role: 'editor',
  createdAt: '',
  revokedAt: null,
  epoch: 0,
} as Person;

const page = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${site}${path}`, { headers: { 'sec-fetch-dest': 'document', ...headers } });
const form = (path: string, body: string, headers: Record<string, string> = {}) =>
  new Request(`${site}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-dest': 'document',
      ...headers,
    },
    body,
  });
const cookieOf = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0];
const passed = (r: Response) => r.headers.get('x-middleware-next') === '1';

beforeEach(() => {
  Object.assign(process.env, env);
  globalThis.fetch = fakeUpstash();
});
afterEach(() => {
  for (const k of Object.keys(env)) delete process.env[k];
  globalThis.fetch = realFetch;
});

const review = () => {
  const setup = deployedReview(process.env);
  assert.ok(!('error' in setup));
  return setup.review;
};

test('fails closed without the gate env', async () => {
  delete process.env.GATE_SECRET;
  assert.equal((await proxy(page('/'))).status, 503);
});

test('asks for the password, then lets the right one in with a cookie', async () => {
  const first = await proxy(page('/sample-list/'));
  assert.equal(first.status, 401);
  assert.match(first.headers.get('content-security-policy') ?? '', /script-src 'sha256-/);
  const ok = await proxy(form('/sample-list/?v=2', 'password=correct-horse'));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/sample-list/?v=2');
  assert.ok(passed(await proxy(page('/sample-list/', { cookie: cookieOf(ok) }))));
});

test('refuses a cross-site password post', async () => {
  assert.equal(
    (await proxy(form('/', 'password=correct-horse', { 'sec-fetch-site': 'cross-site' }))).status,
    403,
  );
});

test('an invite shows who it is for on GET and signs them in on POST', async () => {
  const { token } = await review().invite(root, { name: 'Rae <b>', team: 'Acme' });
  const shown = await proxy(page(`/invite/${token}`));
  assert.equal(shown.status, 200);
  assert.match(await shown.text(), /Rae &lt;b&gt;/);
  assert.equal(shown.headers.get('set-cookie'), null);
  const signedIn = await proxy(form(`/invite/${token}`, ''));
  assert.equal(signedIn.status, 303);
  assert.ok(passed(await proxy(page('/', { cookie: cookieOf(signedIn) }))));
});

test('a revoke ends the person session on the next page load', async () => {
  const { person, token } = await review().invite(root, { name: 'Rae', team: 'Acme' });
  const cookie = cookieOf(await proxy(form(`/invite/${token}`, '')));
  await review().revoke(root, person.id);
  const after = await proxy(page('/', { cookie }));
  assert.equal(after.status, 401);
  assert.match(after.headers.get('set-cookie') ?? '', /__Host-hub_person=;.*Max-Age=0/);
});

test('an unknown invite says so', async () => {
  assert.equal((await proxy(page(`/invite/${'x'.repeat(43)}`))).status, 404);
});

test('lets the gate page load its font and favicon before sign-in, and nothing else', async () => {
  const font = new Request(`${site}/_gate/geist.woff2`, { headers: { 'sec-fetch-dest': 'font' } });
  assert.ok(passed(await proxy(font)));
  assert.ok(passed(await proxy(new Request(`${site}/favicon.svg`))));
  assert.equal((await proxy(new Request(`${site}/_gate/other.woff2`))).status, 401);
  assert.equal((await proxy(new Request(`${site}/_gate/geist.woff2`, { method: 'POST' }))).status, 401);
  const csp = (await proxy(page('/'))).headers.get('content-security-policy') ?? '';
  assert.match(csp, /font-src 'self'/);
});
