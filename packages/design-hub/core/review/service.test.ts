import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { type Anchor, accessEnd, type Comment, type Person, type Scope, threadLabel } from './model.ts';
import { createReview, type Review, ReviewError } from './service.ts';
import { type KV, keyOf, memoryKV, type Snapshot } from './store.ts';

const anchor: Anchor = {
  prototype: 'sample-list',
  feature: 'sample',
  url: '/sample-list/#/items',
  dials: { Review: { fixtures: 'empty' } },
  target: 'main > ul > li:nth-child(2)',
  offset: { x: 0.5, y: 0.25 },
  viewport: { width: 1440, height: 900 },
};

/** Where these tests run: client Acme's rebrand. Client B's is another client's scope altogether. */
const A: Scope = { client: 'acme', project: 'rebrand' };

let clock = 0;
let review: Review;
let studio: Person;
let client: Person;
let clientToken: string;
const DAY = 86_400_000;

const rejects = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => e instanceof ReviewError && e.code === code);

beforeEach(async () => {
  clock = Date.parse('2030-01-01T00:00:00Z');
  review = createReview(memoryKV(), {
    now: () => {
      clock += 1000;
      return new Date(clock);
    },
  });
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
  studio = (await review.addPerson(A, root, { name: 'Ed', team: 'Studio', kind: 'studio' })).person;
  const r = await review.addPerson(A, studio, { name: 'Rae', team: 'Acme' });
  client = r.person;
  clientToken = r.token;
  // The prototype these tests comment on is client-facing, so a Client reaches its comments.
  await review.setAudience(A, studio, anchor.prototype, 'client');
});

test('a link works once, and looking at it uses nothing up', async () => {
  assert.equal((await review.peekLink(A, clientToken))?.id, client.id);
  assert.equal((await review.peekLink(A, clientToken))?.id, client.id);
  assert.equal((await review.useLink(A, clientToken))?.id, client.id);
  assert.equal(await review.useLink(A, clientToken), null);
  assert.equal(await review.peekLink(A, clientToken), null);
  assert.equal(await review.useLink(A, 'not a token'), null);
});

test('two requests with one link at once sign in one device', async () => {
  const both = await Promise.all([review.useLink(A, clientToken), review.useLink(A, clientToken)]);
  // Either request may win the claim; exactly one does.
  assert.deepEqual(both.map((p) => p?.id ?? null).sort(), [client.id, null].sort());
});

test('a new link is for another device: sessions and other links stay', async () => {
  const { token: second } = await review.newLink(A, studio, client.id);
  const { token: third } = await review.newLink(A, studio, client.id);
  assert.notEqual(second, clientToken);
  assert.equal((await review.useLink(A, second))?.id, client.id);
  assert.ok(await review.sessionPerson(A, client.id, 0));
  assert.equal((await review.useLink(A, clientToken))?.epoch, 0);
  assert.equal((await review.useLink(A, third))?.epoch, 0);
});

test('sign out everywhere ends every session and unused link, and gives one new link', async () => {
  const { token: spare } = await review.newLink(A, studio, client.id);
  const { person, token } = await review.signOutEverywhere(A, studio, client.id);
  assert.equal(person.epoch, 1);
  assert.equal(await review.sessionPerson(A, client.id, 0), null);
  assert.equal(await review.useLink(A, clientToken), null);
  assert.equal(await review.useLink(A, spare), null);
  assert.equal((await review.useLink(A, token))?.epoch, 1);
  assert.ok(await review.sessionPerson(A, client.id, 1));
});

test('a revoke ends every session and link, and a revoked person gets no new link', async () => {
  await review.revoke(A, studio, client.id);
  assert.equal(await review.sessionPerson(A, client.id, 1), null);
  assert.equal(await review.peekLink(A, clientToken), null);
  await rejects(review.newLink(A, studio, client.id), 'invalid');
  await rejects(review.signOutEverywhere(A, studio, client.id), 'invalid');
  await rejects(review.setAccess(A, studio, client.id, 'open'), 'invalid');
  await rejects(review.newLink(A, studio, 'nobody'), 'not_found');
});

test('a store failure before the claim leaves the link usable', async () => {
  const kv = memoryKV();
  let failPeople = false;
  const flaky: KV = {
    ...kv,
    hget: async (key, field) => {
      if (failPeople && key === keyOf(A, 'people')) throw new Error('store down');
      return kv.hget(key, field);
    },
  };
  const r = createReview(flaky);
  const root = { ...studio, id: 'cli' };
  const { token } = await r.addPerson(A, root, { name: 'Rae', team: 'Acme' });
  failPeople = true;
  await assert.rejects(r.useLink(A, token), /store down/);
  failPeople = false;
  assert.equal((await r.useLink(A, token))?.name, 'Rae');
});

test('the store never holds a link token in clear', async () => {
  let seen: Snapshot = { hashes: {}, sets: {} };
  const r = createReview(
    memoryKV(undefined, (snapshot) => {
      seen = snapshot;
    }),
  );
  const root = { ...studio, id: 'cli' };
  const added = await r.addPerson(A, root, { name: 'Rae', team: 'Acme' });
  const tokens = [
    added.token,
    (await r.newLink(A, root, added.person.id)).token,
    (await r.signOutEverywhere(A, root, added.person.id)).token,
  ];
  const stored = JSON.stringify(seen);
  assert.ok(Object.keys(seen.hashes[keyOf(A, 'links')] ?? {}).length > 0);
  for (const token of tokens) assert.equal(stored.includes(token), false);
});

test('a revoke writes revocation and epoch, never the profile, before it drops their links', async () => {
  const writes: string[] = [];
  const kv = memoryKV();
  const watched: KV = {
    ...kv,
    hset: async (key, field, value) => {
      writes.push(`set ${key}`);
      return kv.hset(key, field, value);
    },
    hincrby: async (key, field, by) => {
      writes.push(`incr ${key}`);
      return kv.hincrby(key, field, by);
    },
    hdel: async (key, field) => {
      writes.push(`del ${key}`);
      return kv.hdel(key, field);
    },
  };
  const r = createReview(watched);
  const root = { ...studio, id: 'cli' };
  const { person } = await r.addPerson(A, root, { name: 'Rae', team: 'Acme' });
  writes.length = 0;
  await r.revoke(A, root, person.id);
  assert.deepEqual(writes, [
    `set ${keyOf(A, 'revoked')}`,
    `incr ${keyOf(A, 'epochs')}`,
    `del ${keyOf(A, 'links')}`,
  ]);
});

/**
 * A store that holds the next profile write (setAccess's) after its read,
 * until the test releases it: a real interleaving, not two calls in a row.
 */
function pausingKV() {
  const kv = memoryKV();
  let arm = false;
  let reached = () => {};
  let release = () => {};
  const paused = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store: KV = {
    ...kv,
    hset: async (key, field, value) => {
      if (arm && key === keyOf(A, 'people')) {
        arm = false;
        reached();
        await gate;
      }
      return kv.hset(key, field, value);
    },
  };
  return { kv, store, armNextProfileWrite: () => (arm = true), paused, release };
}

async function racedSetAccess(between: (r: Review, root: Person, id: string) => Promise<unknown>) {
  const { kv, store, armNextProfileWrite, paused, release } = pausingKV();
  const r = createReview(store);
  const root = { ...studio, id: 'cli' };
  const { person, token } = await r.addPerson(A, root, { name: 'Rae', team: 'Acme' });
  const { token: spare } = await r.newLink(A, root, person.id);
  armNextProfileWrite();
  // setAccess reads the person (active, epoch 0), then waits at its write.
  const stale = r.setAccess(A, root, person.id, 'open');
  await paused;
  await between(r, root, person.id);
  release();
  const answer = await stale;
  return { r, kv, person, token, spare, answer };
}

test('a stale setAccess written after a revoke never revives the person', async () => {
  const { r, kv, person, token, spare, answer } = await racedSetAccess((r, root, id) =>
    r.revoke(A, root, id),
  );
  const now = await r.person(A, person.id);
  assert.ok(now?.revokedAt);
  assert.equal(now?.accessEndsAt, null);
  assert.ok(answer.revokedAt);
  assert.equal(await r.sessionPerson(A, person.id, 0), null);
  assert.equal(await r.sessionPerson(A, person.id, now?.epoch ?? 0), null);
  assert.equal(await r.peekLink(A, token), null);
  assert.equal(await r.peekLink(A, spare), null);
  assert.deepEqual(Object.keys(await kv.hgetall(keyOf(A, 'links'))), []);
  assert.ok((await r.listPeople(A, studio)).find((p) => p.id === person.id)?.revokedAt);
});

test('a stale setAccess written after a sign out everywhere keeps the new epoch', async () => {
  let fresh = '';
  const { r, person, spare } = await racedSetAccess(async (r, root, id) => {
    fresh = (await r.signOutEverywhere(A, root, id)).token;
  });
  const now = await r.person(A, person.id);
  assert.equal(now?.epoch, 1);
  assert.equal(now?.accessEndsAt, null);
  assert.equal(await r.sessionPerson(A, person.id, 0), null);
  assert.ok(await r.sessionPerson(A, person.id, 1));
  assert.equal(await r.peekLink(A, spare), null);
  assert.equal((await r.useLink(A, fresh))?.epoch, 1);
});

/** A pause point: the first call to `method` on `key` waits there until released. */
type Pause = { reached: Promise<void>; release: () => void };
function pausing(kv: KV, points: Record<string, { method: 'hdel' | 'hgetall'; key: string }>) {
  const pauses: Record<string, Pause & { armed: boolean; hit: () => void; gate: Promise<void> }> = {};
  for (const name of Object.keys(points)) {
    let hit = () => {};
    let release = () => {};
    const reached = new Promise<void>((r) => {
      hit = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    pauses[name] = { reached, release, hit, gate, armed: false };
  }
  const wait = async (method: string, key: string) => {
    for (const [name, at] of Object.entries(points)) {
      const p = pauses[name];
      if (p.armed && at.method === method && at.key === key) {
        p.armed = false;
        p.hit();
        await p.gate;
      }
    }
  };
  const store: KV = {
    ...kv,
    hdel: async (key, field) => {
      await wait('hdel', key);
      return kv.hdel(key, field);
    },
    hgetall: async (key) => {
      await wait('hgetall', key);
      return kv.hgetall(key);
    },
  };
  return { store, arm: (name: string) => (pauses[name].armed = true), pauses };
}

for (const [what, run] of [
  ['a revoke', (r: Review, root: Person, id: string) => r.revoke(A, root, id)],
  ['a sign out everywhere', (r: Review, root: Person, id: string) => r.signOutEverywhere(A, root, id)],
] as const)
  test(`a link used while ${what} lands signs nobody in`, async () => {
    const { store, arm, pauses } = pausing(memoryKV(), {
      claim: { method: 'hdel', key: keyOf(A, 'links') },
      drop: { method: 'hgetall', key: keyOf(A, 'links') },
    });
    const r = createReview(store);
    const root = { ...studio, id: 'cli' };
    const { person, token } = await r.addPerson(A, root, { name: 'Rae', team: 'Acme' });
    // useLink checks the person (active, epoch 0), then waits at its claim.
    arm('claim');
    const using = r.useLink(A, token);
    await pauses.claim.reached;
    // The other call writes its revocation or epoch, then waits before it drops links.
    arm('drop');
    const other = run(r, root, person.id);
    await pauses.drop.reached;
    // The claim wins the race to the link, but the person it checked is no longer current.
    pauses.claim.release();
    assert.equal(await using, null);
    pauses.drop.release();
    await other;
  });

test('any revocation record means revoked, and an access end that does not parse means no access', async () => {
  const kv = memoryKV();
  const r = createReview(kv);
  const root = { ...studio, id: 'cli' };
  const a = (await r.addPerson(A, root, { name: 'Rae', team: 'Acme' })).person;
  await kv.hset(keyOf(A, 'revoked'), a.id, '');
  assert.ok((await r.person(A, a.id))?.revokedAt);
  assert.equal(await r.sessionPerson(A, a.id, 0), null);
  const b = await r.addPerson(A, root, { name: 'Oz', team: 'Acme' });
  const profile = JSON.parse((await kv.hget(keyOf(A, 'people'), b.person.id)) ?? '{}');
  await kv.hset(keyOf(A, 'people'), b.person.id, JSON.stringify({ ...profile, accessEndsAt: 'someday' }));
  assert.equal(await r.sessionPerson(A, b.person.id, 0), null);
  assert.equal(await r.peekLink(A, b.token), null);
  assert.equal(await r.useLink(A, b.token), null);
});

test('a profile that is not a well-formed person is no person, and listPeople skips it', async () => {
  const kv = memoryKV();
  const r = createReview(kv);
  const root = { ...studio, id: 'cli' };
  const { person } = await r.addPerson(A, root, { name: 'Rae', team: 'Acme' });
  await kv.hset(keyOf(A, 'people'), 'junk', 'not json');
  await kv.hset(keyOf(A, 'people'), 'array', '[]');
  await kv.hset(
    keyOf(A, 'people'),
    'nokind',
    JSON.stringify({ id: 'nokind', name: 'X', team: 'Y', createdAt: '' }),
  );
  await kv.hset(
    keyOf(A, 'people'),
    'oddend',
    JSON.stringify({
      ...JSON.parse((await kv.hget(keyOf(A, 'people'), person.id)) ?? '{}'),
      id: 'oddend',
      accessEndsAt: 5,
    }),
  );
  for (const id of ['junk', 'array', 'nokind', 'oddend']) {
    assert.equal(await r.person(A, id), null);
    assert.equal(await r.sessionPerson(A, id, 0), null);
  }
  assert.deepEqual(
    (await r.listPeople(A, root)).map((p) => p.id),
    [person.id],
  );
});

test('two sign outs everywhere at once both end the earlier sessions', async () => {
  const root = { ...studio, id: 'cli' };
  const [a, b] = await Promise.all([
    review.signOutEverywhere(A, root, client.id),
    review.signOutEverywhere(A, root, client.id),
  ]);
  assert.deepEqual([a.person.epoch, b.person.epoch].sort(), [1, 2]);
  assert.equal((await review.person(A, client.id))?.epoch, 2);
  assert.equal(await review.sessionPerson(A, client.id, 0), null);
});

test('a profile write never carries revocation or epoch', async () => {
  const kv = memoryKV();
  const r = createReview(kv);
  const root = { ...studio, id: 'cli' };
  const { person } = await r.addPerson(A, root, { name: 'Rae', team: 'Acme' });
  await r.signOutEverywhere(A, root, person.id);
  await r.setAccess(A, root, person.id, '6m');
  const profile = JSON.parse((await kv.hget(keyOf(A, 'people'), person.id)) ?? '{}');
  assert.equal('epoch' in profile, false);
  assert.equal('revokedAt' in profile, false);
  // A profile that does carry them (an older write, a hand edit) is overruled by the records that own them.
  await kv.hset(keyOf(A, 'people'), person.id, JSON.stringify({ ...profile, epoch: 0, revokedAt: null }));
  await r.revoke(A, root, person.id);
  await kv.hset(keyOf(A, 'people'), person.id, JSON.stringify({ ...profile, epoch: 0, revokedAt: null }));
  const now = await r.person(A, person.id);
  assert.ok(now?.revokedAt);
  assert.equal(now?.epoch, 2);
});

test('access lengths land on the same day, or the last day of a shorter month', () => {
  assert.equal(accessEnd('3m', new Date('2030-11-30T09:00:00Z')), '2031-02-28T09:00:00.000Z');
  assert.equal(accessEnd('6m', new Date('2030-08-31T09:00:00Z')), '2031-02-28T09:00:00.000Z');
  assert.equal(accessEnd('3m', new Date('2031-11-30T09:00:00Z')), '2032-02-29T09:00:00.000Z');
  assert.equal(accessEnd('6m', new Date('2030-01-15T09:00:00Z')), '2030-07-15T09:00:00.000Z');
  assert.equal(accessEnd('open', new Date()), null);
});

test('an unused link lasts 14 days', async () => {
  clock += 13 * DAY;
  assert.ok(await review.peekLink(A, clientToken));
  clock += 2 * DAY;
  assert.equal(await review.peekLink(A, clientToken), null);
  assert.equal(await review.useLink(A, clientToken), null);
});

test('a Client gets the project default, Studio is open-ended, and a length given wins', async () => {
  assert.match(client.accessEndsAt ?? '', /^2030-04-01/);
  assert.equal(studio.accessEndsAt, null);
  assert.equal(await review.defaultAccess(A, studio), '3m');
  assert.equal(await review.setDefaultAccess(A, studio, '6m'), '6m');
  const later = (await review.addPerson(A, studio, { name: 'Oz', team: 'Acme' })).person;
  assert.match(later.accessEndsAt ?? '', /^2030-07-01/);
  const open = (await review.addPerson(A, studio, { name: 'Lu', team: 'Acme', access: 'open' })).person;
  assert.equal(open.accessEndsAt, null);
  const short = (
    await review.addPerson(A, studio, { name: 'Jo', team: 'Studio', kind: 'studio', access: '3m' })
  ).person;
  assert.match(short.accessEndsAt ?? '', /^2030-04-01/);
});

test('access ends sessions and links when it runs out, and Studio can change it', async () => {
  assert.ok(await review.sessionPerson(A, client.id, 0));
  clock += 91 * DAY;
  assert.equal(await review.sessionPerson(A, client.id, 0), null);
  await rejects(review.newLink(A, studio, client.id), 'invalid');
  const changed = await review.setAccess(A, studio, client.id, '6m');
  assert.ok((changed.accessEndsAt ?? '') > new Date(clock).toISOString());
  assert.ok(await review.sessionPerson(A, client.id, 0));
  assert.equal((await review.setAccess(A, studio, client.id, 'open')).accessEndsAt, null);
});

test('access lengths are checked and every problem is named', async () => {
  await assert.rejects(
    review.addPerson(A, studio, { name: '', team: 'Acme', access: '1y' }),
    (e: unknown) =>
      e instanceof ReviewError && e.problems.join() === 'name: required,access: one of 3m, 6m, open',
  );
  await rejects(review.setAccess(A, studio, client.id, 'forever'), 'invalid');
  await rejects(review.setDefaultAccess(A, studio, null), 'invalid');
});

test('only Studio manages people, links, access and the default, and nobody revokes themselves', async () => {
  await rejects(review.addPerson(A, client, { name: 'X', team: 'Acme' }), 'forbidden');
  await rejects(review.listPeople(A, client), 'forbidden');
  await rejects(review.listPeople(A, null), 'unauthorized');
  await rejects(review.newLink(A, client, client.id), 'forbidden');
  await rejects(review.signOutEverywhere(A, client, client.id), 'forbidden');
  await rejects(review.revoke(A, client, studio.id), 'forbidden');
  await rejects(review.setAccess(A, client, client.id, 'open'), 'forbidden');
  await rejects(review.defaultAccess(A, client), 'forbidden');
  await rejects(review.setDefaultAccess(A, client, 'open'), 'forbidden');
  await rejects(review.revoke(A, studio, studio.id), 'invalid');
  assert.deepEqual(
    (await review.listPeople(A, studio)).map((p) => p.name),
    ['Rae', 'Ed'],
  );
});

test('a comment, its replies, resolving and deleting the thread', async () => {
  const root = await review.add(A, client, { body: '  Row height jumps on empty  ', anchor });
  assert.equal(root.body, 'Row height jumps on empty');
  await review.reply(A, studio, { prototype: 'sample-list', thread: root.id, body: 'Fixed in v2' });
  assert.equal((await review.listComments(A, client, 'sample-list')).length, 2);
  const done = await review.resolve(A, client, { prototype: 'sample-list', id: root.id, resolved: true });
  assert.equal(done.resolvedBy?.id, client.id);
  assert.deepEqual((await review.remove(A, client, { prototype: 'sample-list', id: root.id })).length, 2);
  assert.deepEqual(await review.listComments(A, studio, 'sample-list'), []);
});

test('a new person is a Client unless named Studio, and any other kind is invalid', async () => {
  assert.equal(client.kind, 'client');
  assert.equal(client.email, null);
  assert.equal(studio.kind, 'studio');
  await rejects(review.addPerson(A, studio, { name: 'X', team: 'Acme', kind: 'editor' }), 'invalid');
});

test('a Client resolves and reopens anyone’s client-facing thread, but deletes only their own', async () => {
  const c = await review.add(A, studio, { body: 'Spacing off', anchor, audience: 'client' });
  const other = (await review.addPerson(A, studio, { name: 'Oz', team: 'Acme' })).person;
  const done = await review.resolve(A, other, { prototype: 'sample-list', id: c.id, resolved: true });
  assert.equal(done.resolvedBy?.id, other.id);
  const open = await review.resolve(A, client, { prototype: 'sample-list', id: c.id, resolved: false });
  assert.equal(open.status, 'open');
  await rejects(review.remove(A, client, { prototype: 'sample-list', id: c.id }), 'forbidden');
  const reply = await review.reply(A, other, { prototype: 'sample-list', thread: c.id, body: 'Agreed' });
  await rejects(review.remove(A, client, { prototype: 'sample-list', id: reply.id }), 'forbidden');
});

test('Studio resolves and deletes anyone’s thread', async () => {
  const c = await review.add(A, client, { body: 'Wrong icon', anchor });
  const done = await review.resolve(A, studio, { prototype: 'sample-list', id: c.id, resolved: true });
  assert.equal(done.resolvedBy?.id, studio.id);
  assert.deepEqual(await review.remove(A, studio, { prototype: 'sample-list', id: c.id }), [c.id]);
});

test('records under an older key prefix are never read: the unscoped hub3 store starts clean', async () => {
  const { client: _c, ...profile } = { ...client, id: 'old', name: 'Old' };
  const token = 'a'.repeat(43);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString(
    'hex',
  );
  const link = JSON.stringify({ person: 'old', expiresAt: '2999-01-01T00:00:00Z' });
  const comment = JSON.stringify({ id: 'x', thread: 'x', audience: 'client', anchor });
  const kv = memoryKV({
    hashes: {
      'hub3:people': { old: JSON.stringify(profile) },
      'hub3:links': { [hash]: link },
      'hub3:audiences': { 'sample-list': 'client', 'old-plan': 'client' },
      'hub3:comments:sample-list': { x: comment },
      'hub2:people': { old: JSON.stringify(profile) },
      'hub2:invites': { [hash]: link },
    },
    sets: { 'hub3:prototypes': ['sample-list'], 'hub2:prototypes': ['sample-list'] },
  });
  const fresh = createReview(kv);
  for (const key of [keyOf('studio', 'people'), keyOf(A, 'people'), keyOf(A, 'comments', 'x')])
    assert.ok(key.startsWith('hub4:'), key);
  assert.equal(await fresh.person(A, 'old'), null);
  assert.equal(await fresh.sessionPerson(A, 'old', 0), null);
  assert.equal(await fresh.peekLink(A, token), null);
  assert.equal(await fresh.useLink(A, token), null);
  assert.deepEqual(await fresh.allComments(A, studio), []);
  assert.equal(await fresh.locate(A, studio, 'x'), null);
  assert.equal(await fresh.audienceOf(A, 'old-plan'), 'internal');
  assert.deepEqual((await fresh.visiblePrototypes(A, studio)).clientFacing, []);
});

test('people edit only their own words; Studio triages anything', async () => {
  const c = await review.add(A, client, { body: 'Typo in header', anchor });
  await rejects(review.edit(A, studio, { prototype: 'sample-list', id: c.id, body: 'x' }), 'forbidden');
  await rejects(
    review.retriage(A, client, { prototype: 'sample-list', id: c.id, triage: { kind: 'copy' } }),
    'forbidden',
  );
  const t = await review.retriage(A, studio, {
    prototype: 'sample-list',
    id: c.id,
    triage: { kind: 'copy', state: 'Empty' },
    states: ['Real list', 'Empty'],
  });
  assert.deepEqual(t.triage, { kind: 'copy', state: 'Empty', by: 'person', confidence: null });
  await rejects(
    review.retriage(A, studio, {
      prototype: 'sample-list',
      id: c.id,
      triage: { state: 'Nope' },
      states: ['Empty'],
    }),
    'invalid',
  );
});

test('a revoked person and a visitor who is not signed in can do nothing', async () => {
  const gone = await review.revoke(A, studio, client.id);
  await rejects(review.add(A, gone, { body: 'x', anchor }), 'forbidden');
  await rejects(review.add(A, null, { body: 'x', anchor }), 'unauthorized');
});

test('bad input names every problem', async () => {
  await assert.rejects(
    review.add(A, client, { body: '', anchor: { ...anchor, url: 'x', offset: { x: 2, y: 0 } } }),
    (e: unknown) => {
      assert.ok(e instanceof ReviewError);
      assert.deepEqual(
        e.problems.map((p) => p.split(':')[0]),
        ['body', 'anchor.url', 'anchor.offset'],
      );
      return true;
    },
  );
});

test('triage runs on add, and a failing triager never loses the comment', async () => {
  const seen: string[][] = [];
  const triaged = createReview(memoryKV(), {
    triage: async ({ states }) => {
      seen.push(states);
      return { kind: 'bug', state: states[0] ?? null, by: 'jev', confidence: 0.9 };
    },
  });
  await triaged.setAudience(A, studio, anchor.prototype, 'client');
  const c = await triaged.add(A, client, {
    body: 'Broken',
    anchor,
    states: ['Empty', 'Empty', ' Real list '],
  });
  assert.deepEqual(seen, [['Empty', 'Real list']]);
  assert.equal(c.triage?.kind, 'bug');
  const failing = createReview(memoryKV(), { triage: async () => Promise.reject(new Error('down')) });
  await failing.setAudience(A, studio, anchor.prototype, 'client');
  assert.equal((await failing.add(A, client, { body: 'Still saved', anchor })).triage, null);
});

test('locate finds a comment by id alone', async () => {
  const c = await review.add(A, client, { body: 'Here', anchor });
  assert.equal((await review.locate(A, studio, c.id))?.prototype, 'sample-list');
  assert.equal((await review.locate(A, client, c.id))?.prototype, 'sample-list');
  assert.equal(await review.locate(A, studio, 'nope'), null);
  await rejects(review.locate(A, null, c.id), 'unauthorized');
});

// Slice 4: internal comments. One internal thread with a Studio reply, one
// client-facing thread with replies from both kinds.
async function twoThreads() {
  const at = { prototype: 'sample-list' };
  const internal = await review.add(A, studio, { body: 'Spacing token is wrong', anchor });
  const internalReply = await review.reply(A, studio, {
    ...at,
    thread: internal.id,
    body: 'Fix before Friday',
  });
  const shared = await review.add(A, client, { body: 'Header feels heavy', anchor });
  const studioReply = await review.reply(A, studio, {
    ...at,
    thread: shared.id,
    body: 'Trying a lighter one',
  });
  const clientReply = await review.reply(A, client, { ...at, thread: shared.id, body: 'Thanks' });
  return { internal, internalReply, shared, studioReply, clientReply };
}

test('audience: Studio’s thread is internal, a Client’s client-facing, and replies follow the thread', async () => {
  const t = await twoThreads();
  assert.deepEqual(
    [t.internal, t.internalReply, t.shared, t.studioReply, t.clientReply].map((c) => c.audience),
    ['internal', 'internal', 'client', 'client', 'client'],
  );
  const asked = await review.add(A, studio, { body: 'For the client', anchor, audience: 'client' });
  assert.equal(asked.audience, 'client');
  assert.equal(
    (await review.add(A, studio, { body: 'Ours', anchor, audience: 'internal' })).audience,
    'internal',
  );
  await rejects(review.add(A, studio, { body: 'x', anchor, audience: 'everyone' }), 'invalid');
});

test('a Client cannot make an internal thread by asking for one', async () => {
  const c = await review.add(A, client, { body: 'Mine', anchor, audience: 'internal' });
  assert.equal(c.audience, 'client');
  assert.ok((await review.listComments(A, client, 'sample-list')).some((x) => x.id === c.id));
});

test('a Client’s list holds no internal thread or reply; Studio’s holds all', async () => {
  const t = await twoThreads();
  const ids = (cs: { id: string }[]) => cs.map((c) => c.id);
  assert.deepEqual(ids(await review.listComments(A, client, 'sample-list')), [
    t.shared.id,
    t.studioReply.id,
    t.clientReply.id,
  ]);
  assert.equal((await review.listComments(A, studio, 'sample-list')).length, 5);
  assert.deepEqual(ids(await review.allComments(A, client)), [
    t.shared.id,
    t.studioReply.id,
    t.clientReply.id,
  ]);
  assert.equal((await review.allComments(A, studio)).length, 5);
});

test('Client view gives Studio exactly a Client’s list, and never widens a Client’s', async () => {
  await twoThreads();
  const asClient = await review.listComments(A, client, 'sample-list');
  assert.deepEqual(await review.listComments(A, studio, 'sample-list', 'client'), asClient);
  assert.deepEqual(await review.listComments(A, client, 'sample-list', 'studio'), asClient);
  assert.equal((await review.listComments(A, studio, 'sample-list', 'studio')).length, 5);
  await rejects(review.listComments(A, studio, 'sample-list', 'editor'), 'invalid');
});

test('a Client acting on an internal id is told it does not exist, by every op', async () => {
  const t = await twoThreads();
  const at = { prototype: 'sample-list' };
  for (const id of [t.internal.id, t.internalReply.id]) {
    await rejects(review.reply(A, client, { ...at, thread: id, body: 'x' }), 'not_found');
    await rejects(review.edit(A, client, { ...at, id, body: 'x' }), 'not_found');
    await rejects(review.remove(A, client, { ...at, id }), 'not_found');
    await rejects(review.resolve(A, client, { ...at, id, resolved: true }), 'not_found');
    await rejects(review.resolve(A, client, { ...at, id, resolved: false }), 'not_found');
    // Triage is Studio's whatever the id, so a Client is refused before any lookup.
    await rejects(review.retriage(A, client, { ...at, id, triage: { kind: 'bug' } }), 'forbidden');
    assert.equal(await review.locate(A, client, id), null);
    assert.ok(await review.locate(A, studio, id));
  }
  // The same answer as an id that is not there at all.
  await rejects(review.edit(A, client, { ...at, id: 'nope', body: 'x' }), 'not_found');
  // Nothing changed.
  const after = await review.listComments(A, studio, 'sample-list');
  assert.equal(after.length, 5);
  assert.equal(after.find((c) => c.id === t.internal.id)?.status, 'open');
  assert.equal(after.find((c) => c.id === t.internalReply.id)?.body, 'Fix before Friday');
});

test('a signed-out caller is refused before any comment is looked up', async () => {
  const t = await twoThreads();
  const at = { prototype: 'sample-list' };
  for (const id of [t.internal.id, 'nope']) {
    await rejects(review.edit(A, null, { ...at, id, body: 'x' }), 'unauthorized');
    await rejects(review.remove(A, null, { ...at, id }), 'unauthorized');
    await rejects(review.resolve(A, null, { ...at, id, resolved: true }), 'unauthorized');
    await rejects(review.reply(A, null, { ...at, thread: id, body: 'x' }), 'unauthorized');
  }
  await rejects(review.listComments(A, null, 'sample-list'), 'unauthorized');
  await rejects(review.allComments(A, null), 'unauthorized');
});

test('a Client still works on client-facing threads, Studio’s replies included', async () => {
  const t = await twoThreads();
  const at = { prototype: 'sample-list' };
  assert.equal(
    (await review.resolve(A, client, { ...at, id: t.shared.id, resolved: true })).status,
    'resolved',
  );
  assert.equal(
    (await review.edit(A, client, { ...at, id: t.clientReply.id, body: 'Thank you' })).body,
    'Thank you',
  );
  await rejects(review.edit(A, client, { ...at, id: t.studioReply.id, body: 'x' }), 'forbidden');
  await rejects(review.remove(A, client, { ...at, id: t.studioReply.id }), 'forbidden');
  assert.deepEqual(await review.remove(A, client, { ...at, id: t.clientReply.id }), [t.clientReply.id]);
});

test('numbers are fixed: internal and client-facing threads count apart, and none moves or is reused', async () => {
  const t = await twoThreads();
  const third = await review.add(A, client, { body: 'Third', anchor });
  const ours = await review.add(A, studio, { body: 'Ours too', anchor });
  assert.deepEqual(
    [t.internal, t.shared, third, ours].map((c) => [c.audience, c.number]),
    [
      ['internal', 1],
      ['client', 1],
      ['client', 2],
      ['internal', 2],
    ],
  );
  assert.deepEqual([t.internal, t.shared, third, ours].map(threadLabel), ['I1', '1', '2', 'I2']);
  // Replies carry their thread's number.
  assert.deepEqual([t.internalReply.number, t.studioReply.number], [1, 1]);
  // A Client sees 1 and 2: no gap where an internal thread sits.
  const roots = (cs: Comment[]) => cs.filter((c) => c.id === c.thread).map(threadLabel);
  assert.deepEqual(roots(await review.listComments(A, client, 'sample-list')), ['1', '2']);
  await review.remove(A, studio, { prototype: 'sample-list', id: t.shared.id });
  assert.deepEqual(roots(await review.listComments(A, studio, 'sample-list')), ['I1', '2', 'I2']);
  assert.deepEqual(roots(await review.listComments(A, client, 'sample-list')), ['2']);
  assert.equal((await review.add(A, client, { body: 'Fourth', anchor })).number, 3);
});

test('numbers count per prototype', async () => {
  await review.setAudience(A, studio, 'other', 'client');
  const a = await review.add(A, client, { body: 'A1', anchor });
  const b = await review.add(A, client, { body: 'B1', anchor: { ...anchor, prototype: 'other' } });
  const a2 = await review.add(A, studio, { body: 'A2', anchor, audience: 'client' });
  assert.deepEqual([a.number, b.number, a2.number], [1, 1, 2]);
});

test('the internal count starts past internal threads numbered while the two shared one count', async () => {
  const kv = memoryKV();
  const r = createReview(kv);
  const root = { ...studio, id: 'cli' };
  // Under one shared count: internal 1, client-facing 2, internal 3.
  const shared = [
    { id: 'a', audience: 'internal', number: 1 },
    { id: 'b', audience: 'client', number: 2 },
    { id: 'c', audience: 'internal', number: 3 },
  ];
  await kv.sadd(keyOf(A, 'prototypes'), 'sample-list');
  await kv.hset(keyOf(A, 'counters'), 'sample-list', '3');
  for (const c of shared)
    await kv.hset(
      keyOf(A, 'comments', 'sample-list'),
      c.id,
      JSON.stringify({
        ...c,
        thread: c.id,
        author: { id: 'cli', name: 'Ed', team: 'Studio' },
        body: 'Before',
        createdAt: '2030-01-01T00:00:00Z',
        editedAt: null,
        anchor,
        status: 'open',
        resolvedBy: null,
        triage: null,
      }),
    );
  const next = await r.add(A, root, { body: 'After', anchor });
  assert.deepEqual([next.audience, next.number], ['internal', 4]);
  assert.equal((await r.add(A, root, { body: 'Again', anchor })).number, 5);
  assert.equal((await r.add(A, root, { body: 'For them', anchor, audience: 'client' })).number, 4);
});

test('a stored comment without an audience is internal, and one without a number has none', async () => {
  const kv = memoryKV();
  const r = createReview(kv);
  const root = { ...studio, id: 'cli' };
  const rae = (await r.addPerson(A, root, { name: 'Rae', team: 'Acme' })).person;
  const legacy = {
    id: 'old',
    thread: 'old',
    author: { id: rae.id, name: 'Rae', team: 'Acme' },
    body: 'From before audiences',
    createdAt: '2030-01-01T00:00:00Z',
    editedAt: null,
    anchor,
    status: 'open',
    resolvedBy: null,
    triage: null,
  };
  await kv.sadd(keyOf(A, 'prototypes'), 'sample-list');
  await kv.hset(keyOf(A, 'comments', 'sample-list'), 'old', JSON.stringify(legacy));
  await kv.hset(
    keyOf(A, 'comments', 'sample-list'),
    'odd',
    JSON.stringify({ ...legacy, id: 'odd', thread: 'odd', audience: 'everyone' }),
  );
  const seen = await r.listComments(A, root, 'sample-list');
  assert.deepEqual(
    seen.map((c) => [c.id, c.audience, c.number]),
    [
      ['odd', 'internal', 0],
      ['old', 'internal', 0],
    ],
  );
  assert.deepEqual(await r.listComments(A, rae, 'sample-list'), []);
  assert.equal(await r.locate(A, rae, 'old'), null);
  await rejects(r.edit(A, rae, { prototype: 'sample-list', id: 'old', body: 'x' }), 'not_found');
});

test('a prototype is internal until Studio marks it client-facing, and internal again when unmarked', async () => {
  assert.equal(await review.audienceOf(A, 'secret-plan'), 'internal');
  assert.equal(await review.setAudience(A, studio, 'secret-plan', 'client'), 'client');
  assert.equal(await review.audienceOf(A, 'secret-plan'), 'client');
  assert.equal(await review.audienceOf(A, 'sample-page'), 'internal');
  assert.equal(await review.setAudience(A, studio, 'secret-plan', 'internal'), 'internal');
  assert.equal(await review.audienceOf(A, 'secret-plan'), 'internal');
  // Marking internal twice, or one never marked, is no error.
  assert.equal(await review.setAudience(A, studio, 'sample-page', 'internal'), 'internal');
});

test('only client-facing is stored: internal deletes the field, and absent or garbage reads as internal', async () => {
  const kv = memoryKV();
  const own = createReview(kv);
  await own.setAudience(A, studio, 'secret-plan', 'client');
  assert.deepEqual(await kv.hgetall(keyOf(A, 'audiences')), { 'secret-plan': 'client' });
  await own.setAudience(A, studio, 'secret-plan', 'internal');
  assert.deepEqual(await kv.hgetall(keyOf(A, 'audiences')), {});
  for (const garbage of ['Client', 'internal', '', '"client"', 'true', ' client']) {
    await kv.hset(keyOf(A, 'audiences'), 'secret-plan', garbage);
    assert.equal(await own.audienceOf(A, 'secret-plan'), 'internal', garbage);
  }
  await kv.hset(keyOf(A, 'audiences'), 'sample-page', 'yes');
  await kv.hset(keyOf(A, 'audiences'), 'guide', 'client');
  await kv.hset(keyOf(A, 'audiences'), 'Not_A_Slug', 'client');
  await kv.hset(keyOf(A, 'audiences'), 'sample-social', 'client');
  assert.deepEqual(await own.visiblePrototypes(A, studio), {
    view: 'studio',
    clientFacing: ['sample-social'],
  });
  // A name that can never be a prototype is internal without a store read.
  assert.equal(await own.audienceOf(A, 'guide'), 'internal');
  assert.equal(await own.audienceOf(A, 'all.js'), 'internal');
});

test('only Studio sets an audience: a Client is forbidden, a signed-out caller unauthorized, whatever the input', async () => {
  await rejects(review.setAudience(A, client, 'secret-plan', 'client'), 'forbidden');
  await rejects(review.setAudience(A, client, 'nope!', 'garbage'), 'forbidden');
  await rejects(review.setAudience(A, null, 'secret-plan', 'client'), 'unauthorized');
  const revoked = await review.revoke(A, studio, client.id);
  await rejects(
    review.setAudience(A, { ...revoked, kind: 'studio', client: null }, 'secret-plan', 'client'),
    'forbidden',
  );
  assert.equal(await review.audienceOf(A, 'secret-plan'), 'internal');
});

test('a prototype’s audience is checked: the slug and the value, every problem named', async () => {
  await assert.rejects(
    review.setAudience(A, studio, 'Bad Slug', 'everyone'),
    (e: unknown) =>
      e instanceof ReviewError &&
      e.code === 'invalid' &&
      e.problems.join('|') === 'prototype: a prototype slug|audience: one of internal, client',
  );
  for (const reserved of ['guide', 'api', 'assets'])
    await rejects(review.setAudience(A, studio, reserved, 'client'), 'invalid');
  await rejects(review.setAudience(A, studio, 'sample-list', null), 'invalid');
  await rejects(review.setAudience(A, studio, 'sample-list', undefined), 'invalid');
});

test('the index read: Studio’s view, Client view, and a Client’s, each with the client-facing slugs', async () => {
  await review.setAudience(A, studio, 'sample-page', 'client');
  await review.setAudience(A, studio, 'sample-list', 'client');
  const facing = ['sample-list', 'sample-page'];
  assert.deepEqual(await review.visiblePrototypes(A, studio), { view: 'studio', clientFacing: facing });
  assert.deepEqual(await review.visiblePrototypes(A, studio, 'studio'), {
    view: 'studio',
    clientFacing: facing,
  });
  assert.deepEqual(await review.visiblePrototypes(A, studio, 'client'), {
    view: 'client',
    clientFacing: facing,
  });
  // A Client asking for Studio's view still gets a Client's.
  assert.deepEqual(await review.visiblePrototypes(A, client), { view: 'client', clientFacing: facing });
  assert.deepEqual(await review.visiblePrototypes(A, client, 'studio'), {
    view: 'client',
    clientFacing: facing,
  });
  await rejects(review.visiblePrototypes(A, studio, 'everyone'), 'invalid');
  await rejects(review.visiblePrototypes(A, null), 'unauthorized');
  await rejects(review.visiblePrototypes(A, null, 'client'), 'unauthorized');
});

/** A client-facing thread with a Client's reply on it, then the prototype switched back to internal. */
async function onInternalPrototype() {
  const root = await review.add(A, studio, { body: 'For the client', anchor, audience: 'client' });
  const reply = await review.reply(A, client, { prototype: anchor.prototype, thread: root.id, body: 'Seen' });
  await review.setAudience(A, studio, anchor.prototype, 'internal');
  return { root, reply };
}

test('a Client’s list of an internal prototype is empty, as if it had no comments, and so is Studio’s Client view', async () => {
  await onInternalPrototype();
  assert.deepEqual(await review.listComments(A, client, anchor.prototype), []);
  assert.deepEqual(await review.listComments(A, client, anchor.prototype, 'studio'), []);
  assert.deepEqual(await review.listComments(A, studio, anchor.prototype, 'client'), []);
  // The same answer as a prototype nobody made.
  assert.deepEqual(await review.listComments(A, client, 'no-such-thing'), []);
  assert.equal((await review.listComments(A, studio, anchor.prototype)).length, 2);
  assert.deepEqual(await review.allComments(A, client), []);
  assert.equal((await review.allComments(A, studio)).length, 2);
  // Client-facing again: the thread is back for them, with its reply.
  await review.setAudience(A, studio, anchor.prototype, 'client');
  assert.equal((await review.listComments(A, client, anchor.prototype)).length, 2);
});

test('a Client acting on a client-facing thread of an internal prototype is told it does not exist, by every op', async () => {
  const { root, reply } = await onInternalPrototype();
  const at = { prototype: anchor.prototype };
  for (const id of [root.id, reply.id]) {
    await rejects(review.reply(A, client, { ...at, thread: id, body: 'x' }), 'not_found');
    await rejects(review.edit(A, client, { ...at, id, body: 'x' }), 'not_found');
    await rejects(review.remove(A, client, { ...at, id }), 'not_found');
    await rejects(review.resolve(A, client, { ...at, id, resolved: true }), 'not_found');
    await rejects(review.resolve(A, client, { ...at, id, resolved: false }), 'not_found');
    await rejects(review.retriage(A, client, { ...at, id, triage: { kind: 'bug' } }), 'forbidden');
    assert.equal(await review.locate(A, client, id), null);
    assert.ok(await review.locate(A, studio, id));
  }
  // The same answers as an id, and a prototype, that are not there at all.
  await rejects(review.edit(A, client, { ...at, id: 'nope', body: 'x' }), 'not_found');
  await rejects(review.edit(A, client, { prototype: 'no-such-thing', id: 'nope', body: 'x' }), 'not_found');
  // A new thread there is refused the same way, and nothing is written or counted.
  await rejects(review.add(A, client, { body: 'Hello?', anchor }), 'not_found');
  await rejects(
    review.add(A, client, { body: 'Hello?', anchor: { ...anchor, prototype: 'no-such-thing' } }),
    'not_found',
  );
  const after = await review.listComments(A, studio, anchor.prototype);
  assert.deepEqual(
    after.map((c) => [c.body, c.status]),
    [
      ['For the client', 'open'],
      ['Seen', 'open'],
    ],
  );
  // Studio, writing as Studio from Client view, still works there.
  assert.ok(await review.add(A, studio, { body: 'Internal note', anchor }));
  assert.ok(await review.reply(A, studio, { ...at, thread: root.id, body: 'Studio reply' }));
});

// Slice 6: what Studio marks on a prototype's dials and variants.
test('controls: Studio marks a dial either way and a variant on or off, one field each', async () => {
  const kv = memoryKV();
  const own = createReview(kv);
  const mark = (kind: string, id: string, audience: string) =>
    own.setControl(A, studio, { prototype: 'sample-list', kind, id, audience });
  assert.deepEqual(await own.controlsOf(A, studio, 'sample-list'), {
    view: 'studio',
    dials: {},
    variants: [],
  });
  assert.deepEqual(await mark('dial', 'Review/density', 'client'), {
    kind: 'dial',
    id: 'Review/density',
    audience: 'client',
  });
  // Internal is stored for a dial: it overrules a client() in the code.
  await mark('dial', 'Review/avatars', 'internal');
  await mark('variant', 'Lift', 'client');
  await mark('variant', 'Sink', 'client');
  await mark('variant', 'Sink', 'internal');
  // Unmarking a variant never marked is no error.
  await mark('variant', 'Baseline', 'internal');
  assert.deepEqual(await kv.hgetall(keyOf(A, 'controls', 'sample-list')), {
    'dial:Review/density': 'client',
    'dial:Review/avatars': 'internal',
    'variant:Lift': 'client',
  });
  assert.deepEqual(await own.controlsOf(A, studio, 'sample-list'), {
    view: 'studio',
    dials: { 'Review/density': 'client', 'Review/avatars': 'internal' },
    variants: ['Lift'],
  });
  // Marks are per prototype.
  assert.deepEqual(await own.controlsOf(A, studio, 'sample-page'), {
    view: 'studio',
    dials: {},
    variants: [],
  });
});

test('controls: only Studio marks, and every field is checked', async () => {
  const input = { prototype: 'sample-list', kind: 'dial', id: 'Review/density', audience: 'client' };
  await rejects(review.setControl(A, client, input), 'forbidden');
  await rejects(review.setControl(A, null, input), 'unauthorized');
  await assert.rejects(
    review.setControl(A, studio, { prototype: 'guide', kind: 'knob', id: ' x', audience: 'all' }),
    (e: unknown) =>
      e instanceof ReviewError &&
      e.code === 'invalid' &&
      e.problems.join('|') ===
        [
          'prototype: a prototype slug',
          'kind: one of dial, variant',
          'id: the control’s name, one line of at most 200 characters',
          'audience: one of internal, client',
        ].join('|'),
  );
  assert.deepEqual((await review.controlsOf(A, studio, 'sample-list')).dials, {});
});

test('controls: a Client reads the marks of a client-facing prototype, and none of an internal one', async () => {
  await review.setControl(A, studio, {
    prototype: 'sample-list',
    kind: 'dial',
    id: 'Review/density',
    audience: 'client',
  });
  await review.setControl(A, studio, {
    prototype: 'secret-plan',
    kind: 'variant',
    id: 'Lift',
    audience: 'client',
  });
  assert.deepEqual(await review.controlsOf(A, client, 'sample-list'), {
    view: 'client',
    dials: { 'Review/density': 'client' },
    variants: [],
  });
  // The same answer as for a prototype that does not exist.
  await rejects(review.controlsOf(A, client, 'secret-plan'), 'not_found');
  await rejects(review.controlsOf(A, client, 'never-made'), 'not_found');
  await rejects(review.controlsOf(A, null, 'sample-list'), 'unauthorized');
  await rejects(review.controlsOf(A, studio, 'guide'), 'invalid');
  assert.deepEqual((await review.controlsOf(A, studio, 'secret-plan')).variants, ['Lift']);
});

// Scopes: one client never reaches another's anything.
const B: Scope = { client: 'bravo', project: 'launch' };
/** A client and project nobody ever wrote to. */
const EMPTY: Scope = { client: 'zulu', project: 'void' };

/** What an op answered: its value, or its error's code, message and problems. */
const outcome = (p: Promise<unknown>) =>
  p.then(
    (value) => ({ value }),
    (e: unknown) => {
      if (!(e instanceof ReviewError)) throw e;
      return { code: e.code, message: e.message, problems: e.problems };
    },
  );

/** Client B's own things: a Client, a client-facing thread with a reply, and a marked dial. */
async function bravo() {
  const bee = await review.addPerson(B, studio, { name: 'Bea', team: 'Bravo' });
  await review.setAudience(B, studio, anchor.prototype, 'client');
  const thread = await review.add(B, bee.person, { body: 'Bravo’s note', anchor });
  const reply = await review.reply(B, studio, {
    prototype: anchor.prototype,
    thread: thread.id,
    body: 'Seen',
  });
  await review.setControl(B, studio, {
    prototype: anchor.prototype,
    kind: 'dial',
    id: 'Card/x',
    audience: 'client',
  });
  return { bee, thread, reply };
}

type Ids = { person: string; thread: string; token: string };
const at = (ids: Ids) => ({ prototype: anchor.prototype, id: ids.thread });
/** Every op with an actor, each run with the ids it names. */
const OPS: [string, (s: Scope, actor: Person, ids: Ids) => Promise<unknown>][] = [
  ['listPeople', (s, a) => review.listPeople(s, a)],
  ['addPerson', (s, a) => review.addPerson(s, a, { name: 'Oz', team: 'Bravo' })],
  ['newLink', (s, a, ids) => review.newLink(s, a, ids.person)],
  ['signOutEverywhere', (s, a, ids) => review.signOutEverywhere(s, a, ids.person)],
  ['revoke', (s, a, ids) => review.revoke(s, a, ids.person)],
  ['setAccess', (s, a, ids) => review.setAccess(s, a, ids.person, 'open')],
  ['defaultAccess', (s, a) => review.defaultAccess(s, a)],
  ['setDefaultAccess', (s, a) => review.setDefaultAccess(s, a, 'open')],
  ['listComments', (s, a) => review.listComments(s, a, anchor.prototype)],
  ['allComments', (s, a) => review.allComments(s, a)],
  ['add', (s, a) => review.add(s, a, { body: 'x', anchor })],
  [
    'reply',
    (s, a, ids) => review.reply(s, a, { prototype: anchor.prototype, thread: ids.thread, body: 'x' }),
  ],
  ['edit', (s, a, ids) => review.edit(s, a, { ...at(ids), body: 'x' })],
  ['remove', (s, a, ids) => review.remove(s, a, at(ids))],
  ['resolve', (s, a, ids) => review.resolve(s, a, { ...at(ids), resolved: true })],
  ['retriage', (s, a, ids) => review.retriage(s, a, { ...at(ids), triage: { kind: 'bug' } })],
  ['setAudience', (s, a) => review.setAudience(s, a, anchor.prototype, 'internal')],
  ['controlsOf', (s, a) => review.controlsOf(s, a, anchor.prototype)],
  [
    'setControl',
    (s, a) =>
      review.setControl(s, a, {
        prototype: anchor.prototype,
        kind: 'dial',
        id: 'Card/x',
        audience: 'internal',
      }),
  ],
  ['visiblePrototypes', (s, a) => review.visiblePrototypes(s, a)],
  ['locate', (s, a, ids) => review.locate(s, a, ids.thread)],
];
/** The ops that name an id, whose answer to an unknown one is what out of scope must match. */
const BY_ID = new Set([
  'newLink',
  'signOutEverywhere',
  'revoke',
  'setAccess',
  'reply',
  'edit',
  'remove',
  'resolve',
  'retriage',
  'locate',
]);
const UNKNOWN: Ids = { person: 'nope', thread: 'nope', token: 'b'.repeat(43) };
/** The ops that take no actor, so the cross-client test cannot run them as client A’s person. */
const ACTORLESS = ['person', 'sessionPerson', 'peekLink', 'useLink', 'audienceOf'];

test('every op of the review service is in the cross-client test or named as having no actor', () => {
  const listed = [...OPS.map(([name]) => name), ...ACTORLESS].sort();
  assert.deepEqual(Object.keys(createReview(memoryKV())).sort(), listed);
});

test('every op from client A’s person on client B’s scope answers as an unknown id does, and changes nothing', async () => {
  let snapshot = '';
  review = createReview(
    memoryKV(undefined, (s) => {
      snapshot = JSON.stringify(s);
    }),
  );
  studio = (
    await review.addPerson(A, { ...studio, id: 'cli' }, { name: 'Ed', team: 'Studio', kind: 'studio' })
  ).person;
  client = (await review.addPerson(A, studio, { name: 'Rae', team: 'Acme' })).person;
  const b = await bravo();
  const real: Ids = { person: b.bee.person.id, thread: b.thread.id, token: b.bee.token };
  for (const ids of [real, { ...real, thread: b.reply.id }, { ...real, person: studio.id }]) {
    for (const [name, op] of OPS) {
      const before = snapshot;
      const out = await outcome(op(B, client, ids));
      assert.equal(snapshot, before, `${name} wrote nothing`);
      // The same answer whether B holds anything or not.
      assert.deepEqual(out, await outcome(op(EMPTY, client, ids)), `${name}: B and an empty client`);
      if (BY_ID.has(name))
        assert.deepEqual(out, await outcome(op(B, studio, UNKNOWN)), `${name}: an unknown id`);
      if (name === 'locate') assert.deepEqual(out, { value: null });
      else assert.equal((out as { code?: string }).code, 'not_found', name);
    }
  }
  // B's things are all still there, for B.
  assert.equal((await review.listComments(B, b.bee.person, anchor.prototype)).length, 2);
  assert.equal((await review.peekLink(B, b.bee.token))?.id, b.bee.person.id);
});

test('a session, a link and a person of client A are nobody on client B; Studio is someone on both', async () => {
  const bee = await review.addPerson(B, studio, { name: 'Bea', team: 'Bravo' });
  assert.equal(await review.person(B, client.id), null);
  assert.equal(await review.sessionPerson(B, client.id, 0), null);
  assert.equal(await review.peekLink(B, clientToken), null);
  assert.equal(await review.useLink(B, clientToken), null);
  assert.equal(await review.useLink(A, bee.token), null);
  // Refused elsewhere, the link still works once where it belongs.
  assert.equal((await review.useLink(A, clientToken))?.id, client.id);
  assert.equal((await review.useLink(B, bee.token))?.client, 'bravo');
  assert.ok(await review.sessionPerson(A, client.id, 0));
  // A Studio person and their link reach every client.
  const ed = await review.addPerson(A, studio, { name: 'Jo', team: 'Studio', kind: 'studio' });
  assert.equal(ed.person.client, null);
  assert.ok(await review.sessionPerson(B, studio.id, 0));
  assert.ok(await review.sessionPerson(EMPTY, studio.id, 0));
  assert.equal((await review.useLink(B, ed.token))?.id, ed.person.id);
  // People lists hold the scope's Clients and Studio, never another client's.
  const names = async (s: Scope) => (await review.listPeople(s, studio)).map((p) => p.name).sort();
  assert.deepEqual(await names(A), ['Ed', 'Jo', 'Rae']);
  assert.deepEqual(await names(B), ['Bea', 'Ed', 'Jo']);
  // Studio manages B's person from B's scope only.
  await rejects(review.revoke(A, studio, bee.person.id), 'not_found');
  assert.ok((await review.revoke(B, studio, bee.person.id)).revokedAt);
});

test('a project’s comments, numbers, marks and audiences are its own, the same slug elsewhere included', async () => {
  const A2: Scope = { client: 'acme', project: 'other' };
  for (const s of [B, A2]) await review.setAudience(s, studio, anchor.prototype, 'client');
  const a = await review.add(A, client, { body: 'A', anchor });
  const b = await review.add(B, studio, { body: 'B', anchor, audience: 'client' });
  const a2 = await review.add(A2, client, { body: 'A2', anchor });
  assert.deepEqual([a.number, b.number, a2.number], [1, 1, 1]);
  const bodies = async (s: Scope) =>
    (await review.listComments(s, studio, anchor.prototype)).map((c) => c.body);
  assert.deepEqual([await bodies(A), await bodies(B), await bodies(A2)], [['A'], ['B'], ['A2']]);
  await rejects(review.edit(A, studio, { prototype: anchor.prototype, id: b.id, body: 'x' }), 'not_found');
  assert.equal(await review.locate(A, studio, b.id), null);
  await review.setAudience(B, studio, anchor.prototype, 'internal');
  assert.equal(await review.audienceOf(A, anchor.prototype), 'client');
  assert.equal(await review.audienceOf(B, anchor.prototype), 'internal');
  await review.setControl(B, studio, {
    prototype: anchor.prototype,
    kind: 'variant',
    id: 'Lift',
    audience: 'client',
  });
  assert.deepEqual((await review.controlsOf(A, studio, anchor.prototype)).variants, []);
  assert.deepEqual((await review.controlsOf(B, studio, anchor.prototype)).variants, ['Lift']);
  // The default access length is the studio's, the same in every client.
  await review.setDefaultAccess(B, studio, 'open');
  assert.equal(await review.defaultAccess(A, studio), 'open');
});

test('every record lives under its own scope’s keys, and Studio’s under the studio’s', async () => {
  let seen: Snapshot = { hashes: {}, sets: {} };
  review = createReview(
    memoryKV(undefined, (s) => {
      seen = s;
    }),
  );
  const ed = (
    await review.addPerson(A, { ...studio, id: 'cli' }, { name: 'Ed', team: 'Studio', kind: 'studio' })
  ).person;
  const rae = (await review.addPerson(A, ed, { name: 'Rae', team: 'Acme' })).person;
  await review.setAudience(A, ed, anchor.prototype, 'client');
  await review.add(A, rae, { body: 'x', anchor });
  await review.setControl(A, ed, {
    prototype: anchor.prototype,
    kind: 'dial',
    id: 'Card/x',
    audience: 'client',
  });
  await review.setDefaultAccess(A, ed, '6m');
  await review.revoke(A, ed, rae.id);
  assert.deepEqual(Object.keys(seen.hashes).sort(), [
    'hub4:c:acme:epochs',
    'hub4:c:acme:links',
    'hub4:c:acme:p:rebrand:audiences',
    'hub4:c:acme:p:rebrand:comments:sample-list',
    'hub4:c:acme:p:rebrand:controls:sample-list',
    'hub4:c:acme:p:rebrand:counters',
    'hub4:c:acme:people',
    'hub4:c:acme:revoked',
    'hub4:studio:links',
    'hub4:studio:people',
    'hub4:studio:settings',
  ]);
  assert.deepEqual(Object.keys(seen.sets), ['hub4:c:acme:p:rebrand:prototypes']);
  // The client is where the records are, never a field in the profile.
  assert.equal('client' in JSON.parse(seen.hashes['hub4:c:acme:people'][rae.id]), false);
});

test('a profile stored at the wrong home is no person: a Client with the studio, Studio with a client', async () => {
  const kv = memoryKV();
  const r = createReview(kv);
  const rae = (await r.addPerson(A, studio, { name: 'Rae', team: 'Acme' })).person;
  const profile = JSON.parse((await kv.hget(keyOf(A, 'people'), rae.id)) ?? '{}');
  await kv.hset(keyOf('studio', 'people'), 'moved', JSON.stringify({ ...profile, id: 'moved' }));
  await kv.hset(keyOf(A, 'people'), 'boss', JSON.stringify({ ...profile, id: 'boss', kind: 'studio' }));
  for (const id of ['moved', 'boss']) {
    assert.equal(await r.person(A, id), null, id);
    assert.equal(await r.sessionPerson(A, id, 0), null, id);
  }
  assert.deepEqual(
    (await r.listPeople(A, studio)).map((p) => p.id),
    [rae.id],
  );
});
