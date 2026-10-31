import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Person } from '../_core/review/model.ts';
import { createReview, type Review } from '../_core/review/service.ts';
import { memoryKV } from '../_core/review/store.ts';
import { actorFrom, handleReview } from './api.ts';
import { issuePersonToken, PERSON_COOKIE } from './session.ts';

const origin = 'https://hub.example';
const gate = { password: 'pw-123456', secret: 's'.repeat(32) };
let review: Review;
let editor: Person;

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
const call = async (r: Request, actor: Person | null = editor) => {
  const res = await handleReview(r, { review, actor });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

beforeEach(async () => {
  review = createReview(memoryKV());
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
});

test('me says who is signed in, without the epoch', async () => {
  assert.deepEqual((await call(get('me'), null)).body, { person: null });
  const me = (await call(get('me'))).body.person;
  assert.equal(me.name, 'Ed');
  assert.equal('epoch' in me, false);
});

test('an invite returns a link, and the link signs that person in', async () => {
  const { body } = await call(post({ op: 'people.invite', name: 'Rae', team: 'Acme' }));
  assert.match(body.link, /^\/invite\/[\w-]+$/);
  const person = await review.acceptInvite(body.link.split('/').pop());
  assert.equal(person?.name, 'Rae');
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
  assert.equal((await call(post({ op: 'people.invite' }, { 'sec-fetch-site': 'cross-site' }))).status, 403);
  const form = new Request(`${origin}/api/review`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: 'op=x',
  });
  assert.equal((await call(form)).status, 400);
});

test('the cookie names the actor until a reissue bumps the epoch', async () => {
  const token = await issuePersonToken(gate, { id: editor.id, epoch: editor.epoch });
  const withCookie = new Request(`${origin}/`, { headers: { cookie: `${PERSON_COOKIE}=${token}` } });
  assert.equal((await actorFrom(withCookie, review, gate))?.id, editor.id);
  const root = { ...editor, id: 'cli' };
  await review.reissue(root, editor.id);
  assert.equal(await actorFrom(withCookie, review, gate), null);
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

  const invited = (await call(post({ op: 'people.invite', name: 'Rae', team: 'Acme' }))).body.person;
  assert.match((await call(post({ op: 'people.reissue', id: invited.id }))).body.link, /^\/invite\//);
  assert.ok((await call(post({ op: 'people.revoke', id: invited.id }))).body.person.revokedAt);
  assert.equal((await call(get('people'))).body.people.length, 2);
  assert.equal((await call(post({ op: 'nope' }))).status, 400);
});
