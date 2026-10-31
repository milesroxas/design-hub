import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kindFor } from './new.ts';

const none = () => undefined;
const has = () => 'list-v1';

test('an exploration needs nothing', () => {
  assert.equal(kindFor({ sprint: false, alternate: false }, '', none), 'exploration');
});

test('a sprint needs a feature without a primary; an alternate needs one with it', () => {
  assert.equal(kindFor({ sprint: true, alternate: false }, 'list', none), 'sprint');
  assert.throws(
    () => kindFor({ sprint: true, alternate: false }, 'list', has),
    /already has its primary prototype, list-v1/,
  );
  assert.equal(kindFor({ sprint: false, alternate: true }, 'list', has), 'alternate');
  assert.throws(() => kindFor({ sprint: false, alternate: true }, 'list', none), /no primary prototype yet/);
});

test('refuses both kinds at once, and a kind without its feature', () => {
  assert.throws(() => kindFor({ sprint: true, alternate: true }, 'list', none), /Pick one/);
  assert.throws(() => kindFor({ sprint: true, alternate: false }, '', none), /names its feature/);
});
