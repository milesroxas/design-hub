import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Person } from '../core/review/model.ts';
import { createReview, type Review } from '../core/review/service.ts';
import { KEY, type KV, memoryKV } from '../core/review/store.ts';
import { actorFrom, deployedHandler, handleReview } from './api.ts';
import { fakeUpstash } from './fake-upstash.ts';
import { issuePersonToken, PERSON_COOKIE } from './session.ts';

const origin = 'https://hub.example';
const gate = { secret: 's'.repeat(32), site: 'https://kv-a.test' };
let review: Review;
let memory: KV;
let studio: Person;

const get = (op: string, extra = '') => new Request(`${origin}/api/review?op=${op}${extra}`);
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${origin}/api/review`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      host: 'hub.example',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body: JSON.stringify(body),
  });
const call = async (r: Request, actor: Person | null = studio) => {
  const res = await handleReview(r, { review, actor });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

beforeEach(async () => {
  memory = memoryKV();
  review = createReview(memory);
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
  studio = (await review.addPerson(root, { name: 'Ed', team: 'Studio', kind: 'studio' })).person;
});

test('me says who is signed in, without the epoch', async () => {
  assert.deepEqual((await call(get('me'), null)).body, { person: null });
  const me = (await call(get('me'))).body.person;
  assert.equal(me.name, 'Ed');
  assert.equal('epoch' in me, false);
});

test('adding a person returns a one-time link that signs that person in', async () => {
  const { body } = await call(post({ op: 'people.add', name: 'Rae', team: 'Acme' }));
  assert.match(body.link, /^\/invite\/[\w-]{43}$/);
  assert.equal(body.person.kind, 'client');
  assert.equal(body.person.email, null);
  assert.match(body.person.accessEndsAt, /^\d{4}-/);
  assert.equal('epoch' in body.person, false);
  const named = await call(post({ op: 'people.add', name: 'Sam', team: 'Studio', kind: 'studio' }));
  assert.equal(named.body.person.accessEndsAt, null);
  const token = body.link.split('/').pop();
  assert.equal((await review.useLink(token))?.name, 'Rae');
  assert.equal(await review.useLink(token), null);
  const bad = await call(post({ op: 'people.add', name: 'Oz', team: 'Acme', access: '1y' }));
  assert.equal(bad.status, 422);
  assert.deepEqual(bad.body.problems, ['access: one of 3m, 6m, open']);
});

test('the project default is read and set by Studio only', async () => {
  assert.deepEqual((await call(get('access'))).body, { access: '3m' });
  assert.deepEqual((await call(post({ op: 'access.set', access: 'open' }))).body, { access: 'open' });
  const added = (await call(post({ op: 'people.add', name: 'Rae', team: 'Acme' }))).body.person;
  assert.equal(added.accessEndsAt, null);
  const client = await review.person(added.id);
  assert.equal((await call(get('access'), client)).status, 403);
  assert.equal((await call(post({ op: 'access.set', access: '6m' }), client)).status, 403);
  assert.equal((await call(post({ op: 'people.link', id: added.id }), client)).status, 403);
  assert.equal((await call(post({ op: 'access.set', access: 'never' }))).status, 422);
});

test('errors map to status codes with the problems named', async () => {
  assert.equal((await call(get('people'), null)).status, 401);
  const bad = await call(post({ op: 'comment.add', body: '' }));
  assert.equal(bad.status, 422);
  assert.ok(bad.body.problems.length >= 2);
  assert.equal((await call(get('comments', '&prototype=../x'))).status, 422);
  assert.equal((await call(get('nope'))).status, 400);
});

test('refuses a cross-site POST and a non-JSON body', async () => {
  assert.equal((await call(post({ op: 'people.add' }, { 'sec-fetch-site': 'cross-site' }))).status, 403);
  const form = new Request(`${origin}/api/review`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'op=x',
  });
  assert.equal((await call(form)).status, 400);
});

test('the cookie names the actor until sign out everywhere or the access end', async () => {
  const root = { ...studio, id: 'cli' };
  const cookieFor = async (p: Person) =>
    new Request(`${origin}/`, {
      headers: { cookie: `${PERSON_COOKIE}=${await issuePersonToken(gate, p, p.accessEndsAt)}` },
    });
  const withCookie = await cookieFor(studio);
  assert.equal((await actorFrom(withCookie, review, gate))?.id, studio.id);
  await review.signOutEverywhere(root, studio.id);
  assert.equal(await actorFrom(withCookie, review, gate), null);

  const rae = (await review.addPerson(root, { name: 'Rae', team: 'Acme' })).person;
  const raeCookie = await cookieFor(rae);
  assert.equal((await actorFrom(raeCookie, review, gate))?.id, rae.id);
  // Her access ends: the token still verifies, but the store no longer names her.
  const ended = { ...rae, accessEndsAt: new Date(Date.now() - 1000).toISOString() };
  await memory.hset(KEY.people, rae.id, JSON.stringify(ended));
  assert.equal(await actorFrom(raeCookie, review, gate), null);
  assert.equal(await actorFrom(new Request(`${origin}/`), review, gate), null);
});

test('every command runs through the same handler', async () => {
  const anchor = {
    prototype: 'p',
    feature: '',
    url: '/p/',
    dials: {},
    target: null,
    offset: null,
    viewport: { width: 1, height: 1 },
  };
  const added = (await call(post({ op: 'comment.add', body: 'First', anchor }))).body.comment;
  const at = { prototype: 'p', id: added.id };
  assert.equal(
    (await call(post({ op: 'comment.reply', prototype: 'p', thread: added.id, body: 'Re' }))).body.comment
      .thread,
    added.id,
  );
  assert.equal((await call(post({ op: 'comment.edit', ...at, body: 'Edited' }))).body.comment.body, 'Edited');
  assert.equal(
    (await call(post({ op: 'comment.resolve', ...at, resolved: true }))).body.comment.status,
    'resolved',
  );
  const triaged = await call(post({ op: 'comment.triage', ...at, triage: { kind: 'copy', state: null } }));
  assert.equal(triaged.body.comment.triage.kind, 'copy');
  assert.equal((await call(get('comments', '&prototype=p'))).body.comments.length, 2);
  assert.equal((await call(post({ op: 'comment.remove', ...at }))).body.removed.length, 2);

  const person = (await call(post({ op: 'people.add', name: 'Rae', team: 'Acme', access: '6m' }))).body
    .person;
  const another = (await call(post({ op: 'people.link', id: person.id }))).body;
  assert.match(another.link, /^\/invite\//);
  assert.equal(another.person.id, person.id);
  const out = (await call(post({ op: 'people.signOut', id: person.id }))).body;
  assert.match(out.link, /^\/invite\//);
  assert.notEqual(out.link, another.link);
  const opened = (await call(post({ op: 'people.access', id: person.id, access: 'open' }))).body.person;
  assert.equal(opened.accessEndsAt, null);
  assert.equal('epoch' in opened, false);
  assert.ok((await call(post({ op: 'people.revoke', id: person.id }))).body.person.revokedAt);
  assert.equal((await call(get('people'))).body.people.length, 2);
  assert.equal((await call(post({ op: 'people.invite', name: 'X', team: 'Y' }))).status, 400);
  assert.equal((await call(post({ op: 'people.reissue', id: person.id }))).status, 400);
  assert.equal((await call(post({ op: 'nope' }))).status, 400);
});

test('the deployed function answers JSON 503 when the store is down or missing, never a bare 500', async () => {
  const env = { GATE_SECRET: gate.secret, KV_REST_API_URL: gate.site, KV_REST_API_TOKEN: 't' };
  const realFetch = globalThis.fetch;
  Object.assign(process.env, env);
  try {
    globalThis.fetch = fakeUpstash();
    const token = await issuePersonToken(gate, { id: 'abc123', epoch: 0 }, null);
    const signedIn = new Request(`${origin}/api/review?op=me`, {
      headers: { cookie: `${PERSON_COOKIE}=${token}` },
    });
    // Working store, unknown person: an answer, not an error.
    assert.equal((await deployedHandler(signedIn.clone(), null)).status, 200);
    globalThis.fetch = (async () =>
      new Response('{"error":"down"}', { status: 500 })) as unknown as typeof fetch;
    const down = await deployedHandler(signedIn.clone(), null);
    assert.equal(down.status, 503);
    assert.match(down.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(down.headers.get('retry-after'), '30');
    assert.deepEqual(await down.json(), { error: 'The review store did not answer. Try again.' });
    delete process.env.KV_REST_API_URL;
    const missing = await deployedHandler(signedIn.clone(), null);
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /not set up/);
    assert.equal(missing.headers.get('retry-after'), null);
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
    globalThis.fetch = realFetch;
  }
});

test('a store that fails during an op is a JSON 503 that says to retry', async () => {
  const broken: KV = {
    ...memoryKV(),
    hgetall: async () => {
      throw new Error('down');
    },
  };
  const res = await handleReview(get('comments', '&prototype=p'), {
    review: createReview(broken),
    actor: studio,
  });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '30');
  assert.match((await res.json()).error, /did not answer/);
});
