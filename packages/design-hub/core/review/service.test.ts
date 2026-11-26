import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { type Anchor, accessEnd, type Person } from './model.ts';
import { createReview, type Review, ReviewError } from './service.ts';
import { KEY, type KV, memoryKV, type Snapshot } from './store.ts';

const anchor: Anchor = {
  prototype: 'sample-list',
  feature: 'sample',
  url: '/sample-list/#/items',
  dials: { Review: { fixtures: 'empty' } },
  target: 'main > ul > li:nth-child(2)',
  offset: { x: 0.5, y: 0.25 },
  viewport: { width: 1440, height: 900 },
};

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
    email: null,
    accessEndsAt: null,
    createdAt: '',
    revokedAt: null,
    epoch: 0,
  } as Person;
  studio = (await review.addPerson(root, { name: 'Ed', team: 'Studio', kind: 'studio' })).person;
  const r = await review.addPerson(studio, { name: 'Rae', team: 'Acme' });
  client = r.person;
  clientToken = r.token;
});

test('a link works once, and looking at it uses nothing up', async () => {
  assert.equal((await review.peekLink(clientToken))?.id, client.id);
  assert.equal((await review.peekLink(clientToken))?.id, client.id);
  assert.equal((await review.useLink(clientToken))?.id, client.id);
  assert.equal(await review.useLink(clientToken), null);
  assert.equal(await review.peekLink(clientToken), null);
  assert.equal(await review.useLink('not a token'), null);
});

test('two requests with one link at once sign in one device', async () => {
  const both = await Promise.all([review.useLink(clientToken), review.useLink(clientToken)]);
  assert.deepEqual(
    both.map((p) => p?.id ?? null),
    [client.id, null],
  );
});

test('a new link is for another device: sessions and other links stay', async () => {
  const { token: second } = await review.newLink(studio, client.id);
  const { token: third } = await review.newLink(studio, client.id);
  assert.notEqual(second, clientToken);
  assert.equal((await review.useLink(second))?.id, client.id);
  assert.ok(await review.sessionPerson(client.id, 0));
  assert.equal((await review.useLink(clientToken))?.epoch, 0);
  assert.equal((await review.useLink(third))?.epoch, 0);
});

test('sign out everywhere ends every session and unused link, and gives one new link', async () => {
  const { token: spare } = await review.newLink(studio, client.id);
  const { person, token } = await review.signOutEverywhere(studio, client.id);
  assert.equal(person.epoch, 1);
  assert.equal(await review.sessionPerson(client.id, 0), null);
  assert.equal(await review.useLink(clientToken), null);
  assert.equal(await review.useLink(spare), null);
  assert.equal((await review.useLink(token))?.epoch, 1);
  assert.ok(await review.sessionPerson(client.id, 1));
});

test('a revoke ends every session and link, and a revoked person gets no new link', async () => {
  await review.revoke(studio, client.id);
  assert.equal(await review.sessionPerson(client.id, 1), null);
  assert.equal(await review.peekLink(clientToken), null);
  await rejects(review.newLink(studio, client.id), 'invalid');
  await rejects(review.signOutEverywhere(studio, client.id), 'invalid');
  await rejects(review.setAccess(studio, client.id, 'open'), 'invalid');
  await rejects(review.newLink(studio, 'nobody'), 'not_found');
});

test('a store failure before the claim leaves the link usable', async () => {
  const kv = memoryKV();
  let failPeople = false;
  const flaky: KV = {
    ...kv,
    hget: async (key, field) => {
      if (failPeople && key === KEY.people) throw new Error('store down');
      return kv.hget(key, field);
    },
  };
  const r = createReview(flaky);
  const root = { ...studio, id: 'cli' };
  const { token } = await r.addPerson(root, { name: 'Rae', team: 'Acme' });
  failPeople = true;
  await assert.rejects(r.useLink(token), /store down/);
  failPeople = false;
  assert.equal((await r.useLink(token))?.name, 'Rae');
});

test('the store never holds a link token in clear', async () => {
  let seen: Snapshot = { hashes: {}, sets: {} };
  const r = createReview(
    memoryKV(undefined, (snapshot) => {
      seen = snapshot;
    }),
  );
  const root = { ...studio, id: 'cli' };
  const added = await r.addPerson(root, { name: 'Rae', team: 'Acme' });
  const tokens = [
    added.token,
    (await r.newLink(root, added.person.id)).token,
    (await r.signOutEverywhere(root, added.person.id)).token,
  ];
  const stored = JSON.stringify(seen);
  assert.ok(Object.keys(seen.hashes[KEY.links] ?? {}).length > 0);
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
  const { person } = await r.addPerson(root, { name: 'Rae', team: 'Acme' });
  writes.length = 0;
  await r.revoke(root, person.id);
  assert.deepEqual(writes, [`set ${KEY.revoked}`, `incr ${KEY.epochs}`, `del ${KEY.links}`]);
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
      if (arm && key === KEY.people) {
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
  const { person, token } = await r.addPerson(root, { name: 'Rae', team: 'Acme' });
  const { token: spare } = await r.newLink(root, person.id);
  armNextProfileWrite();
  // setAccess reads the person (active, epoch 0), then waits at its write.
  const stale = r.setAccess(root, person.id, 'open');
  await paused;
  await between(r, root, person.id);
  release();
  const answer = await stale;
  return { r, kv, person, token, spare, answer };
}

test('a stale setAccess written after a revoke never revives the person', async () => {
  const { r, kv, person, token, spare, answer } = await racedSetAccess((r, root, id) => r.revoke(root, id));
  const now = await r.person(person.id);
  assert.ok(now?.revokedAt);
  assert.equal(now?.accessEndsAt, null);
  assert.ok(answer.revokedAt);
  assert.equal(await r.sessionPerson(person.id, 0), null);
  assert.equal(await r.sessionPerson(person.id, now?.epoch ?? 0), null);
  assert.equal(await r.peekLink(token), null);
  assert.equal(await r.peekLink(spare), null);
  assert.deepEqual(Object.keys(await kv.hgetall(KEY.links)), []);
  assert.ok((await r.listPeople(studio)).find((p) => p.id === person.id)?.revokedAt);
});

test('a stale setAccess written after a sign out everywhere keeps the new epoch', async () => {
  let fresh = '';
  const { r, person, spare } = await racedSetAccess(async (r, root, id) => {
    fresh = (await r.signOutEverywhere(root, id)).token;
  });
  const now = await r.person(person.id);
  assert.equal(now?.epoch, 1);
  assert.equal(now?.accessEndsAt, null);
  assert.equal(await r.sessionPerson(person.id, 0), null);
  assert.ok(await r.sessionPerson(person.id, 1));
  assert.equal(await r.peekLink(spare), null);
  assert.equal((await r.useLink(fresh))?.epoch, 1);
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
  ['a revoke', (r: Review, root: Person, id: string) => r.revoke(root, id)],
  ['a sign out everywhere', (r: Review, root: Person, id: string) => r.signOutEverywhere(root, id)],
] as const)
  test(`a link used while ${what} lands signs nobody in`, async () => {
    const { store, arm, pauses } = pausing(memoryKV(), {
      claim: { method: 'hdel', key: KEY.links },
      drop: { method: 'hgetall', key: KEY.links },
    });
    const r = createReview(store);
    const root = { ...studio, id: 'cli' };
    const { person, token } = await r.addPerson(root, { name: 'Rae', team: 'Acme' });
    // useLink checks the person (active, epoch 0), then waits at its claim.
    arm('claim');
    const using = r.useLink(token);
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
  const a = (await r.addPerson(root, { name: 'Rae', team: 'Acme' })).person;
  await kv.hset(KEY.revoked, a.id, '');
  assert.ok((await r.person(a.id))?.revokedAt);
  assert.equal(await r.sessionPerson(a.id, 0), null);
  const b = await r.addPerson(root, { name: 'Oz', team: 'Acme' });
  const profile = JSON.parse((await kv.hget(KEY.people, b.person.id)) ?? '{}');
  await kv.hset(KEY.people, b.person.id, JSON.stringify({ ...profile, accessEndsAt: 'someday' }));
  assert.equal(await r.sessionPerson(b.person.id, 0), null);
  assert.equal(await r.peekLink(b.token), null);
  assert.equal(await r.useLink(b.token), null);
});

test('a profile that is not a well-formed person is no person, and listPeople skips it', async () => {
  const kv = memoryKV();
  const r = createReview(kv);
  const root = { ...studio, id: 'cli' };
  const { person } = await r.addPerson(root, { name: 'Rae', team: 'Acme' });
  await kv.hset(KEY.people, 'junk', 'not json');
  await kv.hset(KEY.people, 'array', '[]');
  await kv.hset(KEY.people, 'nokind', JSON.stringify({ id: 'nokind', name: 'X', team: 'Y', createdAt: '' }));
  await kv.hset(
    KEY.people,
    'oddend',
    JSON.stringify({
      ...JSON.parse((await kv.hget(KEY.people, person.id)) ?? '{}'),
      id: 'oddend',
      accessEndsAt: 5,
    }),
  );
  for (const id of ['junk', 'array', 'nokind', 'oddend']) {
    assert.equal(await r.person(id), null);
    assert.equal(await r.sessionPerson(id, 0), null);
  }
  assert.deepEqual(
    (await r.listPeople(root)).map((p) => p.id),
    [person.id],
  );
});

test('two sign outs everywhere at once both end the earlier sessions', async () => {
  const root = { ...studio, id: 'cli' };
  const [a, b] = await Promise.all([
    review.signOutEverywhere(root, client.id),
    review.signOutEverywhere(root, client.id),
  ]);
  assert.deepEqual([a.person.epoch, b.person.epoch].sort(), [1, 2]);
  assert.equal((await review.person(client.id))?.epoch, 2);
  assert.equal(await review.sessionPerson(client.id, 0), null);
});

test('a profile write never carries revocation or epoch', async () => {
  const kv = memoryKV();
  const r = createReview(kv);
  const root = { ...studio, id: 'cli' };
  const { person } = await r.addPerson(root, { name: 'Rae', team: 'Acme' });
  await r.signOutEverywhere(root, person.id);
  await r.setAccess(root, person.id, '6m');
  const profile = JSON.parse((await kv.hget(KEY.people, person.id)) ?? '{}');
  assert.equal('epoch' in profile, false);
  assert.equal('revokedAt' in profile, false);
  // A profile that does carry them (an older write, a hand edit) is overruled by the records that own them.
  await kv.hset(KEY.people, person.id, JSON.stringify({ ...profile, epoch: 0, revokedAt: null }));
  await r.revoke(root, person.id);
  await kv.hset(KEY.people, person.id, JSON.stringify({ ...profile, epoch: 0, revokedAt: null }));
  const now = await r.person(person.id);
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
  assert.ok(await review.peekLink(clientToken));
  clock += 2 * DAY;
  assert.equal(await review.peekLink(clientToken), null);
  assert.equal(await review.useLink(clientToken), null);
});

test('a Client gets the project default, Studio is open-ended, and a length given wins', async () => {
  assert.match(client.accessEndsAt ?? '', /^2030-04-01/);
  assert.equal(studio.accessEndsAt, null);
  assert.equal(await review.defaultAccess(studio), '3m');
  assert.equal(await review.setDefaultAccess(studio, '6m'), '6m');
  const later = (await review.addPerson(studio, { name: 'Oz', team: 'Acme' })).person;
  assert.match(later.accessEndsAt ?? '', /^2030-07-01/);
  const open = (await review.addPerson(studio, { name: 'Lu', team: 'Acme', access: 'open' })).person;
  assert.equal(open.accessEndsAt, null);
  const short = (await review.addPerson(studio, { name: 'Jo', team: 'Studio', kind: 'studio', access: '3m' }))
    .person;
  assert.match(short.accessEndsAt ?? '', /^2030-04-01/);
});

test('access ends sessions and links when it runs out, and Studio can change it', async () => {
  assert.ok(await review.sessionPerson(client.id, 0));
  clock += 91 * DAY;
  assert.equal(await review.sessionPerson(client.id, 0), null);
  await rejects(review.newLink(studio, client.id), 'invalid');
  const changed = await review.setAccess(studio, client.id, '6m');
  assert.ok((changed.accessEndsAt ?? '') > new Date(clock).toISOString());
  assert.ok(await review.sessionPerson(client.id, 0));
  assert.equal((await review.setAccess(studio, client.id, 'open')).accessEndsAt, null);
});

test('access lengths are checked and every problem is named', async () => {
  await assert.rejects(
    review.addPerson(studio, { name: '', team: 'Acme', access: '1y' }),
    (e: unknown) =>
      e instanceof ReviewError && e.problems.join() === 'name: required,access: one of 3m, 6m, open',
  );
  await rejects(review.setAccess(studio, client.id, 'forever'), 'invalid');
  await rejects(review.setDefaultAccess(studio, null), 'invalid');
});

test('only Studio manages people, links, access and the default, and nobody revokes themselves', async () => {
  await rejects(review.addPerson(client, { name: 'X', team: 'Acme' }), 'forbidden');
  await rejects(review.listPeople(client), 'forbidden');
  await rejects(review.listPeople(null), 'unauthorized');
  await rejects(review.newLink(client, client.id), 'forbidden');
  await rejects(review.signOutEverywhere(client, client.id), 'forbidden');
  await rejects(review.revoke(client, studio.id), 'forbidden');
  await rejects(review.setAccess(client, client.id, 'open'), 'forbidden');
  await rejects(review.defaultAccess(client), 'forbidden');
  await rejects(review.setDefaultAccess(client, 'open'), 'forbidden');
  await rejects(review.revoke(studio, studio.id), 'invalid');
  assert.deepEqual(
    (await review.listPeople(studio)).map((p) => p.name),
    ['Rae', 'Ed'],
  );
});

test('a comment, its replies, resolving and deleting the thread', async () => {
  const root = await review.add(client, { body: '  Row height jumps on empty  ', anchor });
  assert.equal(root.body, 'Row height jumps on empty');
  await review.reply(studio, { prototype: 'sample-list', thread: root.id, body: 'Fixed in v2' });
  assert.equal((await review.listComments(client, 'sample-list')).length, 2);
  const done = await review.resolve(client, { prototype: 'sample-list', id: root.id, resolved: true });
  assert.equal(done.resolvedBy?.id, client.id);
  assert.deepEqual((await review.remove(client, { prototype: 'sample-list', id: root.id })).length, 2);
  assert.deepEqual(await review.listComments(studio, 'sample-list'), []);
});

test('a new person is a Client unless named Studio, and any other kind is invalid', async () => {
  assert.equal(client.kind, 'client');
  assert.equal(client.email, null);
  assert.equal(studio.kind, 'studio');
  await rejects(review.addPerson(studio, { name: 'X', team: 'Acme', kind: 'editor' }), 'invalid');
});

test('a Client resolves and reopens anyone’s client-facing thread, but deletes only their own', async () => {
  const c = await review.add(studio, { body: 'Spacing off', anchor, audience: 'client' });
  const other = (await review.addPerson(studio, { name: 'Oz', team: 'Acme' })).person;
  const done = await review.resolve(other, { prototype: 'sample-list', id: c.id, resolved: true });
  assert.equal(done.resolvedBy?.id, other.id);
  const open = await review.resolve(client, { prototype: 'sample-list', id: c.id, resolved: false });
  assert.equal(open.status, 'open');
  await rejects(review.remove(client, { prototype: 'sample-list', id: c.id }), 'forbidden');
  const reply = await review.reply(other, { prototype: 'sample-list', thread: c.id, body: 'Agreed' });
  await rejects(review.remove(client, { prototype: 'sample-list', id: reply.id }), 'forbidden');
});

test('Studio resolves and deletes anyone’s thread', async () => {
  const c = await review.add(client, { body: 'Wrong icon', anchor });
  const done = await review.resolve(studio, { prototype: 'sample-list', id: c.id, resolved: true });
  assert.equal(done.resolvedBy?.id, studio.id);
  assert.deepEqual(await review.remove(studio, { prototype: 'sample-list', id: c.id }), [c.id]);
});

test('records under an older key prefix are never read, 0.6 links included', async () => {
  const old: Person = { ...client, id: 'old', name: 'Old' };
  const token = 'a'.repeat(43);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString(
    'hex',
  );
  const kv = memoryKV({
    hashes: {
      'hub2:people': { old: JSON.stringify(old) },
      'hub2:invites': { [hash]: JSON.stringify({ person: 'old', expiresAt: '2999-01-01T00:00:00Z' }) },
      'hub2:comments:sample-list': { x: JSON.stringify({ id: 'x', thread: 'x' }) },
    },
    sets: { 'hub2:prototypes': ['sample-list'] },
  });
  const fresh = createReview(kv);
  assert.ok(KEY.people.startsWith('hub3:'));
  assert.equal(await fresh.person('old'), null);
  assert.equal(await fresh.sessionPerson('old', 0), null);
  assert.equal(await fresh.peekLink(token), null);
  assert.equal(await fresh.useLink(token), null);
  assert.deepEqual(await fresh.allComments(studio), []);
  assert.equal(await fresh.locate(studio, 'x'), null);
});

test('people edit only their own words; Studio triages anything', async () => {
  const c = await review.add(client, { body: 'Typo in header', anchor });
  await rejects(review.edit(studio, { prototype: 'sample-list', id: c.id, body: 'x' }), 'forbidden');
  await rejects(
    review.retriage(client, { prototype: 'sample-list', id: c.id, triage: { kind: 'copy' } }),
    'forbidden',
  );
  const t = await review.retriage(studio, {
    prototype: 'sample-list',
    id: c.id,
    triage: { kind: 'copy', state: 'Empty' },
    states: ['Real list', 'Empty'],
  });
  assert.deepEqual(t.triage, { kind: 'copy', state: 'Empty', by: 'person', confidence: null });
  await rejects(
    review.retriage(studio, {
      prototype: 'sample-list',
      id: c.id,
      triage: { state: 'Nope' },
      states: ['Empty'],
    }),
    'invalid',
  );
});

test('a revoked person and a visitor who is not signed in can do nothing', async () => {
  const gone = await review.revoke(studio, client.id);
  await rejects(review.add(gone, { body: 'x', anchor }), 'forbidden');
  await rejects(review.add(null, { body: 'x', anchor }), 'unauthorized');
});

test('bad input names every problem', async () => {
  await assert.rejects(
    review.add(client, { body: '', anchor: { ...anchor, url: 'x', offset: { x: 2, y: 0 } } }),
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
  const c = await triaged.add(client, {
    body: 'Broken',
    anchor,
    states: ['Empty', 'Empty', ' Real list '],
  });
  assert.deepEqual(seen, [['Empty', 'Real list']]);
  assert.equal(c.triage?.kind, 'bug');
  const failing = createReview(memoryKV(), { triage: async () => Promise.reject(new Error('down')) });
  assert.equal((await failing.add(client, { body: 'Still saved', anchor })).triage, null);
});

test('locate finds a comment by id alone', async () => {
  const c = await review.add(client, { body: 'Here', anchor });
  assert.equal((await review.locate(studio, c.id))?.prototype, 'sample-list');
  assert.equal((await review.locate(client, c.id))?.prototype, 'sample-list');
  assert.equal(await review.locate(studio, 'nope'), null);
  await rejects(review.locate(null, c.id), 'unauthorized');
});

// Slice 4: internal comments. One internal thread with a Studio reply, one
// client-facing thread with replies from both kinds.
async function twoThreads() {
  const at = { prototype: 'sample-list' };
  const internal = await review.add(studio, { body: 'Spacing token is wrong', anchor });
  const internalReply = await review.reply(studio, { ...at, thread: internal.id, body: 'Fix before Friday' });
  const shared = await review.add(client, { body: 'Header feels heavy', anchor });
  const studioReply = await review.reply(studio, { ...at, thread: shared.id, body: 'Trying a lighter one' });
  const clientReply = await review.reply(client, { ...at, thread: shared.id, body: 'Thanks' });
  return { internal, internalReply, shared, studioReply, clientReply };
}

test('audience: Studio’s thread is internal, a Client’s client-facing, and replies follow the thread', async () => {
  const t = await twoThreads();
  assert.deepEqual(
    [t.internal, t.internalReply, t.shared, t.studioReply, t.clientReply].map((c) => c.audience),
    ['internal', 'internal', 'client', 'client', 'client'],
  );
  const asked = await review.add(studio, { body: 'For the client', anchor, audience: 'client' });
  assert.equal(asked.audience, 'client');
  assert.equal(
    (await review.add(studio, { body: 'Ours', anchor, audience: 'internal' })).audience,
    'internal',
  );
  await rejects(review.add(studio, { body: 'x', anchor, audience: 'everyone' }), 'invalid');
});

test('a Client cannot make an internal thread by asking for one', async () => {
  const c = await review.add(client, { body: 'Mine', anchor, audience: 'internal' });
  assert.equal(c.audience, 'client');
  assert.ok((await review.listComments(client, 'sample-list')).some((x) => x.id === c.id));
});

test('a Client’s list holds no internal thread or reply; Studio’s holds all', async () => {
  const t = await twoThreads();
  const ids = (cs: { id: string }[]) => cs.map((c) => c.id);
  assert.deepEqual(ids(await review.listComments(client, 'sample-list')), [
    t.shared.id,
    t.studioReply.id,
    t.clientReply.id,
  ]);
  assert.equal((await review.listComments(studio, 'sample-list')).length, 5);
  assert.deepEqual(ids(await review.allComments(client)), [t.shared.id, t.studioReply.id, t.clientReply.id]);
  assert.equal((await review.allComments(studio)).length, 5);
});

test('Client view gives Studio exactly a Client’s list, and never widens a Client’s', async () => {
  await twoThreads();
  const asClient = await review.listComments(client, 'sample-list');
  assert.deepEqual(await review.listComments(studio, 'sample-list', 'client'), asClient);
  assert.deepEqual(await review.listComments(client, 'sample-list', 'studio'), asClient);
  assert.equal((await review.listComments(studio, 'sample-list', 'studio')).length, 5);
  await rejects(review.listComments(studio, 'sample-list', 'editor'), 'invalid');
});

test('a Client acting on an internal id is told it does not exist, by every op', async () => {
  const t = await twoThreads();
  const at = { prototype: 'sample-list' };
  for (const id of [t.internal.id, t.internalReply.id]) {
    await rejects(review.reply(client, { ...at, thread: id, body: 'x' }), 'not_found');
    await rejects(review.edit(client, { ...at, id, body: 'x' }), 'not_found');
    await rejects(review.remove(client, { ...at, id }), 'not_found');
    await rejects(review.resolve(client, { ...at, id, resolved: true }), 'not_found');
    await rejects(review.resolve(client, { ...at, id, resolved: false }), 'not_found');
    // Triage is Studio's whatever the id, so a Client is refused before any lookup.
    await rejects(review.retriage(client, { ...at, id, triage: { kind: 'bug' } }), 'forbidden');
    assert.equal(await review.locate(client, id), null);
    assert.ok(await review.locate(studio, id));
  }
  // The same answer as an id that is not there at all.
  await rejects(review.edit(client, { ...at, id: 'nope', body: 'x' }), 'not_found');
  // Nothing changed.
  const after = await review.listComments(studio, 'sample-list');
  assert.equal(after.length, 5);
  assert.equal(after.find((c) => c.id === t.internal.id)?.status, 'open');
  assert.equal(after.find((c) => c.id === t.internalReply.id)?.body, 'Fix before Friday');
});

test('a signed-out caller is refused before any comment is looked up', async () => {
  const t = await twoThreads();
  const at = { prototype: 'sample-list' };
  for (const id of [t.internal.id, 'nope']) {
    await rejects(review.edit(null, { ...at, id, body: 'x' }), 'unauthorized');
    await rejects(review.remove(null, { ...at, id }), 'unauthorized');
    await rejects(review.resolve(null, { ...at, id, resolved: true }), 'unauthorized');
    await rejects(review.reply(null, { ...at, thread: id, body: 'x' }), 'unauthorized');
  }
  await rejects(review.listComments(null, 'sample-list'), 'unauthorized');
  await rejects(review.allComments(null), 'unauthorized');
});

test('a Client still works on client-facing threads, Studio’s replies included', async () => {
  const t = await twoThreads();
  const at = { prototype: 'sample-list' };
  assert.equal((await review.resolve(client, { ...at, id: t.shared.id, resolved: true })).status, 'resolved');
  assert.equal(
    (await review.edit(client, { ...at, id: t.clientReply.id, body: 'Thank you' })).body,
    'Thank you',
  );
  await rejects(review.edit(client, { ...at, id: t.studioReply.id, body: 'x' }), 'forbidden');
  await rejects(review.remove(client, { ...at, id: t.studioReply.id }), 'forbidden');
  assert.deepEqual(await review.remove(client, { ...at, id: t.clientReply.id }), [t.clientReply.id]);
});

test('numbers are fixed: a delete or a hidden thread moves no other number, and none is reused', async () => {
  const t = await twoThreads();
  const third = await review.add(client, { body: 'Third', anchor });
  assert.deepEqual([t.internal.number, t.shared.number, third.number], [1, 2, 3]);
  // Replies carry their thread's number.
  assert.deepEqual([t.internalReply.number, t.studioReply.number], [1, 2]);
  // A Client sees 2 and 3: the internal thread is hidden and leaves a gap.
  const roots = (cs: { id: string; thread: string; number: number }[]) =>
    cs.filter((c) => c.id === c.thread).map((c) => c.number);
  assert.deepEqual(roots(await review.listComments(client, 'sample-list')), [2, 3]);
  await review.remove(studio, { prototype: 'sample-list', id: t.shared.id });
  assert.deepEqual(roots(await review.listComments(studio, 'sample-list')), [1, 3]);
  assert.deepEqual(roots(await review.listComments(client, 'sample-list')), [3]);
  assert.equal((await review.add(client, { body: 'Fourth', anchor })).number, 4);
});

test('numbers count per prototype', async () => {
  const a = await review.add(client, { body: 'A1', anchor });
  const b = await review.add(client, { body: 'B1', anchor: { ...anchor, prototype: 'other' } });
  const a2 = await review.add(studio, { body: 'A2', anchor });
  assert.deepEqual([a.number, b.number, a2.number], [1, 1, 2]);
});

test('a stored comment without an audience is internal, and one without a number has none', async () => {
  const kv = memoryKV();
  const r = createReview(kv);
  const root = { ...studio, id: 'cli' };
  const rae = (await r.addPerson(root, { name: 'Rae', team: 'Acme' })).person;
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
  await kv.sadd(KEY.prototypes, 'sample-list');
  await kv.hset(KEY.comments('sample-list'), 'old', JSON.stringify(legacy));
  await kv.hset(
    KEY.comments('sample-list'),
    'odd',
    JSON.stringify({ ...legacy, id: 'odd', thread: 'odd', audience: 'everyone' }),
  );
  const seen = await r.listComments(root, 'sample-list');
  assert.deepEqual(
    seen.map((c) => [c.id, c.audience, c.number]),
    [
      ['odd', 'internal', 0],
      ['old', 'internal', 0],
    ],
  );
  assert.deepEqual(await r.listComments(rae, 'sample-list'), []);
  assert.equal(await r.locate(rae, 'old'), null);
  await rejects(r.edit(rae, { prototype: 'sample-list', id: 'old', body: 'x' }), 'not_found');
});
