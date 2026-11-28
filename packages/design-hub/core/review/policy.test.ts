import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Audience, Comment, Person, PersonKind, Scope } from './model.ts';
import { type Action, audienceFor, can, inScope, viewOf, visibleTo } from './policy.ts';

const person = (id: string, kind: PersonKind, revokedAt: string | null = null): Person => ({
  id,
  name: id,
  team: kind === 'studio' ? 'Studio' : 'Acme',
  kind,
  client: kind === 'studio' ? null : 'acme',
  email: null,
  accessEndsAt: null,
  createdAt: '',
  revokedAt,
  epoch: 0,
});

const comment = (id: string, thread: string, author: string, audience: Audience): Comment => ({
  id,
  thread,
  author: { id: author, name: author, team: 'Acme' },
  body: 'x',
  createdAt: '',
  editedAt: null,
  anchor: null,
  status: 'open',
  resolvedBy: null,
  triage: null,
  audience,
  number: 1,
});
const thread = (author: string, audience: Audience = 'client') => comment('c', 'c', author, audience);

// The rule table, one row per action and thread audience:
// [Studio own, Studio other's, Client own, Client other's].
const TABLE: [Action, Audience, boolean, boolean, boolean, boolean][] = [
  ['read', 'client', true, true, true, true],
  ['read', 'internal', true, true, false, false],
  ['comment', 'client', true, true, true, true],
  ['comment', 'internal', true, true, false, false],
  ['edit', 'client', true, false, true, false],
  ['edit', 'internal', true, false, false, false],
  ['resolve', 'client', true, true, true, true],
  ['resolve', 'internal', true, true, false, false],
  ['delete', 'client', true, true, true, false],
  ['delete', 'internal', true, true, false, false],
  ['triage', 'client', true, true, false, false],
  ['triage', 'internal', true, true, false, false],
  ['people', 'client', true, true, false, false],
  ['people', 'internal', true, true, false, false],
  ['audience', 'client', true, true, false, false],
  ['audience', 'internal', true, true, false, false],
];

/** Where the table runs: the Client's own client. */
const A: Scope = { client: 'acme', project: 'rebrand' };
/** Another client's: the service answers anything here as not found. */
const B: Scope = { client: 'bravo', project: 'launch' };

const studio = person('s', 'studio');
const client = person('c', 'client');

for (const [action, audience, studioOwn, studioOther, clientOwn, clientOther] of TABLE) {
  test(`${action} on a ${audience} thread: Studio and Client, own and another's`, () => {
    assert.equal(can(studio, A, action, thread(studio.id, audience)), studioOwn, 'Studio, own');
    assert.equal(can(studio, A, action, thread('someone', audience)), studioOther, "Studio, another's");
    assert.equal(can(client, A, action, thread(client.id, audience)), clientOwn, 'Client, own');
    assert.equal(can(client, A, action, thread('someone', audience)), clientOther, "Client, another's");
  });

  test(`${action} on a ${audience} thread in another client’s scope: Studio as anywhere, a Client never`, () => {
    assert.equal(can(studio, B, action, thread(studio.id, audience)), studioOwn, 'Studio, own');
    assert.equal(can(studio, B, action, thread('someone', audience)), studioOther, "Studio, another's");
    assert.equal(can(client, B, action, thread(client.id, audience)), false, 'Client, own');
    assert.equal(can(client, B, action, thread('someone', audience)), false, "Client, another's");
    assert.equal(can(client, B, action), false, 'Client, no thread');
  });

  test(`${action} on a ${audience} thread: nobody signed in and a revoked person may not`, () => {
    for (const kind of ['studio', 'client'] as const) {
      const gone = person('r', kind, '2030-01-01T00:00:00Z');
      assert.equal(can(gone, A, action, thread(gone.id, audience)), false, `revoked ${kind}, own`);
      assert.equal(can(gone, A, action, thread('someone', audience)), false, `revoked ${kind}, another's`);
    }
    assert.equal(can(null, A, action, thread('someone', audience)), false, 'null');
    assert.equal(can(null, A, action), false, 'null, no subject');
  });
}

// The scope rows: who an op in a scope belongs to at all.
const SCOPES: [string, Pick<Person, 'kind' | 'client'>, Scope, boolean][] = [
  ['Studio, in a client', { kind: 'studio', client: null }, A, true],
  ['Studio, in another client', { kind: 'studio', client: null }, B, true],
  ['Studio, in a client with no project', { kind: 'studio', client: null }, { client: 'bravo' }, true],
  ['a Client, in their own client', { kind: 'client', client: 'acme' }, A, true],
  [
    'a Client, in another project of it',
    { kind: 'client', client: 'acme' },
    { client: 'acme', project: 'x' },
    true,
  ],
  ['a Client, in another client', { kind: 'client', client: 'acme' }, B, false],
  ['a Client, in a client spelled otherwise', { kind: 'client', client: 'acme' }, { client: 'Acme' }, false],
  ['Studio that names a client', { kind: 'studio', client: 'acme' }, A, false],
  ['a Client with no client', { kind: 'client', client: null }, A, false],
  // A scope that names no client is nobody's, a Client who names none included.
  ['Studio, in a scope with an empty client', { kind: 'studio', client: null }, { client: '' }, false],
  [
    'a Client with no client, in a scope with none',
    { kind: 'client', client: undefined as unknown as null },
    {} as Scope,
    false,
  ],
  [
    'a Client with a null client, in a scope with a null one',
    { kind: 'client', client: null },
    { client: null } as unknown as Scope,
    false,
  ],
];

for (const [who, actor, scope, inside] of SCOPES)
  test(`inScope: ${who} is ${inside ? 'in' : 'out of'} scope`, () => {
    assert.equal(inScope(actor, scope), inside);
    // can() asks inScope first, so out of scope nothing is allowed, whatever the action.
    if (!inside)
      for (const action of ['read', 'comment', 'resolve', 'people'] as const)
        assert.equal(can({ ...studio, ...actor }, scope, action), false, action);
  });

test('with no thread, both kinds read and start one; only Studio triages, manages people and sets a prototype’s audience', () => {
  for (const action of ['read', 'comment'] as const) {
    assert.equal(can(studio, A, action), true);
    assert.equal(can(client, A, action), true);
  }
  for (const action of ['triage', 'people', 'audience'] as const) {
    assert.equal(can(studio, A, action), true);
    assert.equal(can(client, A, action), false);
  }
});

test('a reply is judged by its own author, and inside its thread’s audience', () => {
  const root = thread(studio.id, 'client');
  const mine = comment('r', 'c', client.id, 'client');
  assert.equal(can(client, A, 'edit', root, mine), true);
  assert.equal(can(client, A, 'delete', root, mine), true);
  assert.equal(can(studio, A, 'edit', root, mine), false);
  assert.equal(can(studio, A, 'delete', root, mine), true);
  // A client-facing reply in an internal thread, or an internal reply in a client-facing one: never a Client's.
  assert.equal(can(client, A, 'edit', thread(studio.id, 'internal'), mine), false);
  assert.equal(can(client, A, 'read', root, comment('r', 'c', client.id, 'internal')), false);
});

test('a record without an audience is internal to the rules', () => {
  const legacy = { ...thread(client.id), audience: undefined } as unknown as Comment;
  assert.equal(can(client, A, 'read', legacy), false);
  assert.equal(can(studio, A, 'read', legacy), true);
  assert.deepEqual(visibleTo('client', [legacy]), []);
});

test('visibleTo: Studio sees everything; a Client, client-facing threads and their client-facing replies', () => {
  const all = [
    comment('i', 'i', 's', 'internal'),
    comment('i1', 'i', 's', 'internal'),
    comment('k', 'k', 'c', 'client'),
    comment('k1', 'k', 's', 'client'),
    comment('k2', 'k', 'c', 'client'),
    // Nothing writes these, but a Client still never gets them.
    comment('odd', 'k', 's', 'internal'),
    comment('stray', 'i', 's', 'client'),
    comment('orphan', 'gone', 'c', 'client'),
  ];
  assert.deepEqual(visibleTo('studio', all), all);
  assert.deepEqual(
    visibleTo('client', all).map((c) => c.id),
    ['k', 'k1', 'k2'],
  );
});

test('viewOf: Studio may narrow to a Client’s view; a Client is never widened', () => {
  assert.equal(viewOf(studio), 'studio');
  assert.equal(viewOf(studio, 'studio'), 'studio');
  assert.equal(viewOf(studio, 'client'), 'client');
  assert.equal(viewOf(client), 'client');
  assert.equal(viewOf(client, 'studio'), 'client');
  assert.equal(viewOf(null), 'client');
});

test('audienceFor: a Client’s thread is client-facing; Studio’s is internal unless asked', () => {
  assert.equal(audienceFor(client, null), 'client');
  assert.equal(audienceFor(client, 'internal'), 'client');
  assert.equal(audienceFor(studio, null), 'internal');
  assert.equal(audienceFor(studio, 'client'), 'client');
  assert.equal(audienceFor(studio, 'internal'), 'internal');
});
