import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Scope } from './model.ts';
import { keyOf } from './store.ts';

const A: Scope = { client: 'acme', project: 'rebrand' };

test('keys: the studio’s, a client’s and a project’s, each under hub4:', () => {
  assert.equal(keyOf('studio', 'people'), 'hub4:studio:people');
  assert.equal(keyOf('studio', 'settings'), 'hub4:studio:settings');
  assert.equal(keyOf(A, 'people'), 'hub4:c:acme:people');
  assert.equal(keyOf({ client: 'acme' }, 'links'), 'hub4:c:acme:links');
  assert.equal(keyOf(A, 'audiences'), 'hub4:c:acme:p:rebrand:audiences');
  assert.equal(keyOf(A, 'prototypes'), 'hub4:c:acme:p:rebrand:prototypes');
  assert.equal(keyOf(A, 'comments', 'sample-list'), 'hub4:c:acme:p:rebrand:comments:sample-list');
  assert.equal(keyOf(A, 'controls', 'sample-list'), 'hub4:c:acme:p:rebrand:controls:sample-list');
  // A reserved prototype name is read like any other, and finds nothing.
  assert.equal(keyOf(A, 'comments', 'guide'), 'hub4:c:acme:p:rebrand:comments:guide');
});

test('a key is never built from a part that could reach another scope’s keys', () => {
  const bad: [string, () => string][] = [
    ['a client with a colon', () => keyOf({ client: 'acme:p:x' }, 'people')],
    ['an empty client', () => keyOf({ client: '' }, 'people')],
    ['the studio’s host as a client', () => keyOf({ client: 'studio' }, 'people')],
    ['a reserved client', () => keyOf({ client: 'www' }, 'people')],
    ['a project op with no project', () => keyOf({ client: 'acme' }, 'audiences')],
    ['a project with a colon', () => keyOf({ client: 'acme', project: 'a:b' }, 'counters')],
    ['a reserved project', () => keyOf({ client: 'acme', project: 'invite' }, 'counters')],
    ['a prototype with a colon', () => keyOf(A, 'comments', 'x:y')],
    ['no prototype', () => keyOf(A, 'controls', undefined as unknown as string)],
    ['a client that is not text', () => keyOf({ client: 3 as unknown as string }, 'people')],
  ];
  for (const [what, build] of bad) assert.throws(build, /Not a store key/, what);
});
