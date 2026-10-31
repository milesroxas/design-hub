import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Anchor, Person } from './model.ts';
import { createReview, type Review, ReviewError } from './service.ts';
import { memoryKV } from './store.ts';

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
let editor: Person;
let reviewer: Person;
let reviewerToken: string;

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
    role: 'editor',
    createdAt: '',
    revokedAt: null,
    epoch: 0,
  } as Person;
  editor = (await review.invite(root, { name: 'Ed', team: 'Studio', role: 'editor' })).person;
  const r = await review.invite(editor, { name: 'Rae', team: 'Acme' });
  reviewer = r.person;
  reviewerToken = r.token;
});

test('an invite signs its person in until it is reissued or revoked', async () => {
  assert.equal((await review.acceptInvite(reviewerToken))?.id, reviewer.id);
  const { token } = await review.reissue(editor, reviewer.id);
  assert.equal(await review.acceptInvite(reviewerToken), null);
  assert.equal((await review.acceptInvite(token))?.epoch, 1);
  await review.revoke(editor, reviewer.id);
  assert.equal(await review.acceptInvite(token), null);
});

test('a reissue or revoke ends every session signed with the old epoch', async () => {
  assert.ok(await review.sessionPerson(reviewer.id, 0));
  await review.reissue(editor, reviewer.id);
  assert.equal(await review.sessionPerson(reviewer.id, 0), null);
  assert.ok(await review.sessionPerson(reviewer.id, 1));
  await review.revoke(editor, reviewer.id);
  assert.equal(await review.sessionPerson(reviewer.id, 2), null);
});

test('an invite expires', async () => {
  clock += 15 * 86_400_000;
  assert.equal(await review.acceptInvite(reviewerToken), null);
});

test('only editors manage people, and nobody revokes themselves', async () => {
  await rejects(review.invite(reviewer, { name: 'X', team: 'Acme' }), 'forbidden');
  await rejects(review.listPeople(null), 'unauthorized');
  await rejects(review.revoke(editor, editor.id), 'invalid');
  assert.deepEqual(
    (await review.listPeople(editor)).map((p) => p.name),
    ['Rae', 'Ed'],
  );
});

test('a comment, its replies, resolving and deleting the thread', async () => {
  const root = await review.add(reviewer, { body: '  Row height jumps on empty  ', anchor });
  assert.equal(root.body, 'Row height jumps on empty');
  await review.reply(editor, { prototype: 'sample-list', thread: root.id, body: 'Fixed in v2' });
  assert.equal((await review.listComments(reviewer, 'sample-list')).length, 2);
  const done = await review.resolve(reviewer, { prototype: 'sample-list', id: root.id, resolved: true });
  assert.equal(done.resolvedBy?.id, reviewer.id);
  assert.deepEqual((await review.remove(reviewer, { prototype: 'sample-list', id: root.id })).length, 2);
  assert.deepEqual(await review.listComments(editor, 'sample-list'), []);
});

test('people edit only their own words; editors resolve and triage anything', async () => {
  const c = await review.add(reviewer, { body: 'Typo in header', anchor });
  await rejects(review.edit(editor, { prototype: 'sample-list', id: c.id, body: 'x' }), 'forbidden');
  const other = (await review.invite(editor, { name: 'Oz', team: 'Acme' })).person;
  await rejects(review.resolve(other, { prototype: 'sample-list', id: c.id, resolved: true }), 'forbidden');
  await rejects(
    review.retriage(reviewer, { prototype: 'sample-list', id: c.id, triage: { kind: 'copy' } }),
    'forbidden',
  );
  const t = await review.retriage(editor, {
    prototype: 'sample-list',
    id: c.id,
    triage: { kind: 'copy', state: 'Empty' },
    states: ['Real list', 'Empty'],
  });
  assert.deepEqual(t.triage, { kind: 'copy', state: 'Empty', by: 'person', confidence: null });
  await rejects(
    review.retriage(editor, {
      prototype: 'sample-list',
      id: c.id,
      triage: { state: 'Nope' },
      states: ['Empty'],
    }),
    'invalid',
  );
});

test('a revoked person and a password-only visitor can do nothing', async () => {
  const gone = await review.revoke(editor, reviewer.id);
  await rejects(review.add(gone, { body: 'x', anchor }), 'forbidden');
  await rejects(review.add(null, { body: 'x', anchor }), 'unauthorized');
});

test('bad input names every problem', async () => {
  await assert.rejects(
    review.add(reviewer, { body: '', anchor: { ...anchor, url: 'x', offset: { x: 2, y: 0 } } }),
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
  const c = await triaged.add(reviewer, {
    body: 'Broken',
    anchor,
    states: ['Empty', 'Empty', ' Real list '],
  });
  assert.deepEqual(seen, [['Empty', 'Real list']]);
  assert.equal(c.triage?.kind, 'bug');
  const failing = createReview(memoryKV(), { triage: async () => Promise.reject(new Error('down')) });
  assert.equal((await failing.add(reviewer, { body: 'Still saved', anchor })).triage, null);
});

test('locate finds a comment by id alone', async () => {
  const c = await review.add(reviewer, { body: 'Here', anchor });
  assert.equal((await review.locate(c.id))?.prototype, 'sample-list');
  assert.equal(await review.locate('nope'), null);
});
