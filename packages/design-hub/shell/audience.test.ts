import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AUDIENCE_LABEL,
  audienceIn,
  emptyState,
  hiddenFor,
  lensOf,
  slugsFor,
  withAudience,
} from './audience.ts';

const studio = { kind: 'studio' as const };
const client = { kind: 'client' as const };

test('a prototype is client-facing only when the server lists it', () => {
  assert.equal(audienceIn(['a', 'b'], 'a'), 'client');
  assert.equal(audienceIn(['a', 'b'], 'c'), 'internal');
  assert.equal(audienceIn([], 'a'), 'internal');
  assert.deepEqual(AUDIENCE_LABEL, { internal: 'Internal', client: 'Client-facing' });
});

test('switching one prototype changes only it, and switching back restores the list', () => {
  const start = ['b', 'd'];
  const on = withAudience(start, 'c', 'client');
  assert.deepEqual(on, ['b', 'c', 'd']);
  assert.deepEqual(withAudience(on, 'c', 'client'), ['b', 'c', 'd']);
  assert.deepEqual(withAudience(on, 'c', 'internal'), start);
  assert.deepEqual(withAudience(start, 'x', 'internal'), start);
  // The rollback after a failed switch is the switch the other way.
  assert.deepEqual(withAudience(withAudience(start, 'b', 'internal'), 'b', 'client'), start);
  assert.deepEqual(start, ['b', 'd']);
});

test('Studio’s view loads every slug; a Client’s view only the client-facing', () => {
  const all = ['a', 'b', 'c'];
  assert.deepEqual(slugsFor({ view: 'studio', clientFacing: ['b'] }, all), all);
  assert.deepEqual(slugsFor({ view: 'client', clientFacing: ['b'] }, all), ['b']);
  assert.deepEqual(slugsFor({ view: 'client', clientFacing: [] }, all), []);
});

test('Studio’s controls show outside Client view only; the Client view note for Studio only', () => {
  assert.deepEqual(lensOf(studio, 'studio'), { controls: true, clientView: false });
  assert.deepEqual(lensOf(studio, 'client'), { controls: false, clientView: true });
  assert.deepEqual(lensOf(client, 'client'), { controls: false, clientView: false });
  // A Client's stored Client view changes nothing; nobody signed in gets neither.
  assert.deepEqual(lensOf(client, 'studio'), { controls: false, clientView: false });
  assert.deepEqual(lensOf(null, 'studio'), { controls: false, clientView: false });
});

test('the empty index speaks to its view', () => {
  assert.equal(emptyState('studio', 0), 'studio');
  assert.equal(emptyState('client', 0), 'client');
  assert.equal(emptyState('client', 2), null);
  assert.equal(emptyState('studio', 1), null);
});

test('in Client view an internal prototype’s page reads as missing; no answer hides nothing', () => {
  assert.equal(hiddenFor({ view: 'client', clientFacing: ['a'] }, 'b'), true);
  assert.equal(hiddenFor({ view: 'client', clientFacing: ['a'] }, 'a'), false);
  assert.equal(hiddenFor({ view: 'studio', clientFacing: [] }, 'b'), false);
  assert.equal(hiddenFor(null, 'b'), false);
});
