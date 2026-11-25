import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Anchor, Person } from './model.ts';
import { createReview, type Review, ReviewError } from './service.ts';
import { KEY, memoryKV } from './store.ts';

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
    createdAt: '',
    revokedAt: null,
    epoch: 0,
  } as Person;
  studio = (await review.invite(root, { name: 'Ed', team: 'Studio', kind: 'studio' })).person;
  const r = await review.invite(studio, { name: 'Rae', team: 'Acme' });
  client = r.person;
  clientToken = r.token;
});

test('an invite signs its person in until it is reissued or revoked', async () => {
  assert.equal((await review.acceptInvite(clientToken))?.id, client.id);
  const { token } = await review.reissue(studio, client.id);
  assert.equal(await review.acceptInvite(clientToken), null);
  assert.equal((await review.acceptInvite(token))?.epoch, 1);
  await review.revoke(studio, client.id);
  assert.equal(await review.acceptInvite(token), null);
});

test('a reissue or revoke ends every session signed with the old epoch', async () => {
  assert.ok(await review.sessionPerson(client.id, 0));
  await review.reissue(studio, client.id);
  assert.equal(await review.sessionPerson(client.id, 0), null);
  assert.ok(await review.sessionPerson(client.id, 1));
  await review.revoke(studio, client.id);
  assert.equal(await review.sessionPerson(client.id, 2), null);
});

test('an invite expires', async () => {
  clock += 15 * 86_400_000;
  assert.equal(await review.acceptInvite(clientToken), null);
});

test('only Studio manages people, and nobody revokes themselves', async () => {
  await rejects(review.invite(client, { name: 'X', team: 'Acme' }), 'forbidden');
  await rejects(review.listPeople(client), 'forbidden');
  await rejects(review.listPeople(null), 'unauthorized');
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
  assert.equal(studio.kind, 'studio');
  await rejects(review.invite(studio, { name: 'X', team: 'Acme', kind: 'editor' }), 'invalid');
});

test('a Client resolves and reopens anyone’s thread, but deletes only their own', async () => {
  const c = await review.add(studio, { body: 'Spacing off', anchor });
  const other = (await review.invite(studio, { name: 'Oz', team: 'Acme' })).person;
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

test('records under the old key prefix are never read', async () => {
  const old: Person = { ...client, id: 'old', name: 'Old' };
  const kv = memoryKV({
    hashes: {
      'hub:people': { old: JSON.stringify(old) },
      'hub:comments:sample-list': { x: JSON.stringify({ id: 'x', thread: 'x' }) },
    },
    sets: { 'hub:prototypes': ['sample-list'] },
  });
  const fresh = createReview(kv);
  assert.ok(KEY.people.startsWith('hub2:'));
  assert.equal(await fresh.person('old'), null);
  assert.deepEqual(await fresh.allComments(), []);
  assert.equal(await fresh.locate('x'), null);
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

test('a revoked person and a password-only visitor can do nothing', async () => {
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
  assert.equal((await review.locate(c.id))?.prototype, 'sample-list');
  assert.equal(await review.locate('nope'), null);
});
