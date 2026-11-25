import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Comment, Person, PersonKind } from './model.ts';
import { type Action, can } from './policy.ts';

const person = (id: string, kind: PersonKind, revokedAt: string | null = null): Person => ({
  id,
  name: id,
  team: kind === 'studio' ? 'Studio' : 'Acme',
  kind,
  createdAt: '',
  revokedAt,
  epoch: 0,
});

const thread = (author: string): Comment => ({
  id: 'c',
  thread: 'c',
  author: { id: author, name: author, team: 'Acme' },
  body: 'x',
  createdAt: '',
  editedAt: null,
  anchor: null,
  status: 'open',
  resolvedBy: null,
  triage: null,
});

// The rule table, one row per action: [Studio own, Studio other's, Client own, Client other's].
const TABLE: [Action, boolean, boolean, boolean, boolean][] = [
  ['read', true, true, true, true],
  ['comment', true, true, true, true],
  ['edit', true, false, true, false],
  ['resolve', true, true, true, true],
  ['delete', true, true, true, false],
  ['triage', true, true, false, false],
  ['people', true, true, false, false],
];

const studio = person('s', 'studio');
const client = person('c', 'client');

for (const [action, studioOwn, studioOther, clientOwn, clientOther] of TABLE) {
  test(`${action}: Studio and Client, own and another's`, () => {
    assert.equal(can(studio, action, thread(studio.id)), studioOwn, 'Studio, own');
    assert.equal(can(studio, action, thread('someone')), studioOther, "Studio, another's");
    assert.equal(can(client, action, thread(client.id)), clientOwn, 'Client, own');
    assert.equal(can(client, action, thread('someone')), clientOther, "Client, another's");
  });

  test(`${action}: nobody signed in and a revoked person may not`, () => {
    for (const kind of ['studio', 'client'] as const) {
      const gone = person('r', kind, '2030-01-01T00:00:00Z');
      assert.equal(can(gone, action, thread(gone.id)), false, `revoked ${kind}, own`);
      assert.equal(can(gone, action, thread('someone')), false, `revoked ${kind}, another's`);
    }
    assert.equal(can(null, action, thread('someone')), false, 'null');
    assert.equal(can(null, action), false, 'null, no subject');
  });
}
