import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Person } from '../core/review/model.ts';
import { createReview, type Review } from '../core/review/service.ts';
import { type KV, keyOf, memoryKV } from '../core/review/store.ts';
import { actorFrom, deployedHandler, handleReview } from './api.ts';
import { fakeUpstash } from './fake-upstash.ts';
import { issuePersonToken, PERSON_COOKIE, SITE_SCOPE } from './session.ts';

const S = SITE_SCOPE;

const origin = 'https://hub.example';
const gate = { secret: 's'.repeat(32), site: 'https://kv-a.test', client: SITE_SCOPE.client };
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
  const res = await handleReview(r, { review, actor, scope: S });
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
    client: null,
    email: null,
    accessEndsAt: null,
    createdAt: '',
    revokedAt: null,
    epoch: 0,
  } as Person;
  studio = (await review.addPerson(S, root, { name: 'Ed', team: 'Studio', kind: 'studio' })).person;
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
  assert.equal((await review.useLink(S, token))?.name, 'Rae');
  assert.equal(await review.useLink(S, token), null);
  const bad = await call(post({ op: 'people.add', name: 'Oz', team: 'Acme', access: '1y' }));
  assert.equal(bad.status, 422);
  assert.deepEqual(bad.body.problems, ['access: one of 3m, 6m, open']);
});

test('the project default is read and set by Studio only', async () => {
  assert.deepEqual((await call(get('access'))).body, { access: '3m' });
  assert.deepEqual((await call(post({ op: 'access.set', access: 'open' }))).body, { access: 'open' });
  const added = (await call(post({ op: 'people.add', name: 'Rae', team: 'Acme' }))).body.person;
  assert.equal(added.accessEndsAt, null);
  const client = await review.person(S, added.id);
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
  assert.equal((await actorFrom(withCookie, review, gate, S))?.id, studio.id);
  await review.signOutEverywhere(S, root, studio.id);
  assert.equal(await actorFrom(withCookie, review, gate, S), null);

  const rae = (await review.addPerson(S, root, { name: 'Rae', team: 'Acme' })).person;
  const raeCookie = await cookieFor(rae);
  assert.equal((await actorFrom(raeCookie, review, gate, S))?.id, rae.id);
  // Her access ends: the token still verifies, but the store no longer names her.
  const ended = { ...rae, accessEndsAt: new Date(Date.now() - 1000).toISOString() };
  await memory.hset(keyOf(S, 'people'), rae.id, JSON.stringify(ended));
  assert.equal(await actorFrom(raeCookie, review, gate, S), null);
  assert.equal(await actorFrom(new Request(`${origin}/`), review, gate, S), null);
});

test('the API acts in the scope it is given: another client’s person is no one, and a request cannot name a scope', async () => {
  const B = { client: 'bravo', project: 'launch' };
  const bee = (await review.addPerson(B, studio, { name: 'Bea', team: 'Bravo' })).person;
  const rae = (await review.addPerson(S, studio, { name: 'Rae', team: 'Acme' })).person;
  const cookie = async (p: Person, g = gate) =>
    new Request(`${origin}/`, {
      headers: { cookie: `${PERSON_COOKIE}=${await issuePersonToken(g, p, p.accessEndsAt)}` },
    });
  // A cookie signed to this site's client, for a person of another client: nobody here.
  assert.equal(await actorFrom(await cookie(bee), review, gate, S), null);
  // A cookie signed to another client never verifies on this site's gate, whoever it names.
  assert.equal(await actorFrom(await cookie(rae, { ...gate, client: 'bravo' }), review, gate, S), null);
  assert.equal((await actorFrom(await cookie(rae), review, gate, S))?.id, rae.id);
  // A Client of another client, however they got here, is answered as for an unknown id.
  const edit = await call(post({ op: 'comment.edit', prototype: 'p', id: 'nope', body: 'x' }), bee);
  assert.deepEqual([edit.status, edit.body], [404, { error: 'No such comment.', problems: [] }]);
  assert.equal((await call(get('people'), bee)).status, 404);
  // Naming a scope in the request changes nothing: the op runs in the one it was given.
  await review.setAudience(B, studio, 'p', 'client');
  const asked = await call(get('prototypes', '&client=bravo&project=launch'));
  assert.deepEqual(asked.body.clientFacing, []);
  await call(
    post({ op: 'prototype.audience', prototype: 'q', audience: 'client', client: 'bravo', scope: B }),
  );
  assert.deepEqual((await review.visiblePrototypes(B, studio)).clientFacing, ['p']);
  assert.deepEqual((await review.visiblePrototypes(S, studio)).clientFacing, ['q']);
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
    const token = await issuePersonToken(gate, { id: 'abc123', epoch: 0, kind: 'client' }, null);
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
    scope: S,
  });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '30');
  assert.match((await res.json()).error, /did not answer/);
});

test('comments: a Client never receives an internal comment, and Studio’s Client view matches theirs', async () => {
  const anchor = {
    prototype: 'p',
    feature: '',
    url: '/p/',
    dials: {},
    target: null,
    offset: null,
    viewport: { width: 1, height: 1 },
  };
  const client = (await review.addPerson(S, studio, { name: 'Rae', team: 'Acme' })).person;
  // The prototype is client-facing, so a Client reaches its comments.
  await review.setAudience(S, studio, 'p', 'client');
  const internal = (await call(post({ op: 'comment.add', body: 'Ours', anchor }))).body.comment;
  assert.equal(internal.audience, 'internal');
  await call(post({ op: 'comment.reply', prototype: 'p', thread: internal.id, body: 'Still ours' }));
  const shared = (await call(post({ op: 'comment.add', body: 'Theirs', anchor, audience: 'client' }))).body
    .comment;
  assert.equal(shared.audience, 'client');
  // A Client asking for an internal thread gets the client-facing one, and their reply follows the thread.
  const theirs = (await call(post({ op: 'comment.add', body: 'Mine', anchor, audience: 'internal' }), client))
    .body.comment;
  assert.equal(theirs.audience, 'client');

  // Sorted: comments made in one millisecond have no set order.
  const ids = (r: { body: Record<string, any> }) => r.body.comments.map((c: { id: string }) => c.id).sort();
  const asClient = await call(get('comments', '&prototype=p'), client);
  assert.deepEqual(ids(asClient), [shared.id, theirs.id].sort());
  assert.equal(JSON.stringify(asClient.body).includes('ours'), false);
  assert.deepEqual(ids(await call(get('comments', '&prototype=p&viewAs=studio'), client)), ids(asClient));
  assert.deepEqual(ids(await call(get('comments', '&prototype=p&viewAs=client'))), ids(asClient));
  assert.equal((await call(get('comments', '&prototype=p'))).body.comments.length, 4);
  assert.equal((await call(get('comments', '&prototype=p&viewAs=studio'))).body.comments.length, 4);

  const bad = await call(get('comments', '&prototype=p&viewAs=editor'));
  assert.equal(bad.status, 422);
  assert.deepEqual(bad.body.problems, ['viewAs: one of studio, client']);
  const badAudience = await call(post({ op: 'comment.add', body: 'x', anchor, audience: 'all' }));
  assert.equal(badAudience.status, 422);
  assert.deepEqual(badAudience.body.problems, ['audience: one of internal, client']);

  // An internal id is not there for a Client, whatever the op.
  const at = { prototype: 'p', id: internal.id };
  for (const body of [
    { op: 'comment.reply', prototype: 'p', thread: internal.id, body: 'x' },
    { op: 'comment.edit', ...at, body: 'x' },
    { op: 'comment.remove', ...at },
    { op: 'comment.resolve', ...at, resolved: true },
  ]) {
    const res = await call(post(body), client);
    assert.equal(res.status, 404, body.op);
    assert.deepEqual(res.body, { error: 'No such comment.', problems: [] });
  }
});

test('prototypes: the index read takes viewAs as comments does, and a Client gets a Client’s view', async () => {
  const client = (await review.addPerson(S, studio, { name: 'Rae', team: 'Acme' })).person;
  assert.deepEqual((await call(get('prototypes'))).body, { view: 'studio', clientFacing: [] });
  const set = await call(post({ op: 'prototype.audience', prototype: 'sample-list', audience: 'client' }));
  assert.deepEqual(set, { status: 200, body: { prototype: 'sample-list', audience: 'client' } });
  assert.deepEqual((await call(get('prototypes'))).body, { view: 'studio', clientFacing: ['sample-list'] });
  assert.deepEqual((await call(get('prototypes', '&viewAs=client'))).body, {
    view: 'client',
    clientFacing: ['sample-list'],
  });
  assert.deepEqual((await call(get('prototypes', '&viewAs=studio'), client)).body, {
    view: 'client',
    clientFacing: ['sample-list'],
  });
  const bad = await call(get('prototypes', '&viewAs=everyone'));
  assert.equal(bad.status, 422);
  assert.deepEqual(bad.body.problems, ['viewAs: one of studio, client']);
  assert.equal((await call(get('prototypes'), null)).status, 401);
});

test('prototype.audience: Studio only, the slug and value checked, internal unmarks', async () => {
  const client = (await review.addPerson(S, studio, { name: 'Rae', team: 'Acme' })).person;
  const op = (body: Record<string, unknown>, actor: Person | null = studio) =>
    call(post({ op: 'prototype.audience', ...body }), actor);
  assert.equal((await op({ prototype: 'sample-list', audience: 'client' }, client)).status, 403);
  assert.equal((await op({ prototype: 'sample-list', audience: 'client' }, null)).status, 401);
  const invalid = await op({ prototype: 'guide', audience: 'all' });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.problems, [
    'prototype: a prototype slug',
    'audience: one of internal, client',
  ]);
  await op({ prototype: 'sample-list', audience: 'client' });
  assert.equal(await review.audienceOf(S, 'sample-list'), 'client');
  assert.deepEqual((await op({ prototype: 'sample-list', audience: 'internal' })).body, {
    prototype: 'sample-list',
    audience: 'internal',
  });
  assert.equal(await memory.hget(keyOf(S, 'audiences'), 'sample-list'), null);
  // A cross-site POST is refused before the op runs.
  const cross = await handleReview(
    post(
      { op: 'prototype.audience', prototype: 'sample-list', audience: 'client' },
      { 'sec-fetch-site': 'cross-site' },
    ),
    { review, actor: studio, scope: S },
  );
  assert.equal(cross.status, 403);
  assert.equal(await review.audienceOf(S, 'sample-list'), 'internal');
});

test('comments on an internal prototype: a Client gets an empty list and not_found, as for one with none', async () => {
  const anchor = {
    prototype: 'p',
    feature: '',
    url: '/p/',
    dials: {},
    target: null,
    offset: null,
    viewport: { width: 1, height: 1 },
  };
  const client = (await review.addPerson(S, studio, { name: 'Rae', team: 'Acme' })).person;
  const shared = (await call(post({ op: 'comment.add', body: 'Theirs', anchor, audience: 'client' }))).body
    .comment;
  assert.deepEqual((await call(get('comments', '&prototype=p'), client)).body, { comments: [] });
  assert.deepEqual((await call(get('comments', '&prototype=p&viewAs=client'))).body, { comments: [] });
  assert.equal((await call(get('comments', '&prototype=p'))).body.comments.length, 1);
  const added = await call(post({ op: 'comment.add', body: 'Hi', anchor }), client);
  const unknown = await call(post({ op: 'comment.edit', prototype: 'p', id: 'nope', body: 'x' }), client);
  assert.deepEqual([added.status, added.body], [404, { error: 'No such comment.', problems: [] }]);
  assert.deepEqual([unknown.status, unknown.body], [404, { error: 'No such comment.', problems: [] }]);
  const edited = await call(post({ op: 'comment.edit', prototype: 'p', id: shared.id, body: 'x' }), client);
  assert.deepEqual([edited.status, edited.body], [unknown.status, unknown.body]);
});

test('controls and control.audience: a prototype page reads the marks, and only Studio sets one', async () => {
  const client = (await review.addPerson(S, studio, { name: 'Rae', team: 'Acme' })).person;
  await review.setAudience(S, studio, 'sample-list', 'client');
  const read = (actor: Person | null = studio, prototype = 'sample-list') =>
    call(get('controls', `&prototype=${prototype}`), actor);
  const set = (body: Record<string, unknown>, actor: Person | null = studio) =>
    call(post({ op: 'control.audience', prototype: 'sample-list', ...body }), actor);
  assert.deepEqual((await read()).body, { view: 'studio', dials: {}, variants: [] });
  assert.deepEqual(await set({ kind: 'dial', id: 'Review/density', audience: 'client' }), {
    status: 200,
    body: { prototype: 'sample-list', kind: 'dial', id: 'Review/density', audience: 'client' },
  });
  await set({ kind: 'variant', id: 'Lift', audience: 'client' });
  assert.deepEqual((await read(client)).body, {
    view: 'client',
    dials: { 'Review/density': 'client' },
    variants: ['Lift'],
  });
  assert.equal((await set({ kind: 'dial', id: 'Review/density', audience: 'internal' }, client)).status, 403);
  assert.equal((await set({ kind: 'dial', id: 'Review/density', audience: 'internal' }, null)).status, 401);
  const invalid = await set({ kind: 'dial', id: '', audience: 'client' });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.problems, ['id: the control’s name, one line of at most 200 characters']);
  // An internal prototype answers a Client as one that does not exist.
  assert.equal((await read(client, 'secret-plan')).status, 404);
  assert.equal((await read(null)).status, 401);
  assert.equal((await call(get('controls'))).status, 422);
});
