import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kindFor, main, templateFor } from './new.ts';

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

test("--app picks the track's shell; a project without tracks keeps the product shell", () => {
  assert.equal(templateFor('website', true), 'site');
  assert.equal(templateFor('product', true), 'app');
  assert.equal(templateFor('', true), 'app');
  assert.equal(templateFor('website', false), 'space');
  assert.equal(templateFor('brand', false), 'brand');
  assert.equal(templateFor('brand', true), 'brand');
});

test('refuses a slug the hub owns, before anything is written', () => {
  for (const slug of ['guide', 'api', 'assets'])
    assert.throws(
      () => main({ positionals: [slug], flags: {} } as never),
      /the hub's own path \(guide, api, assets\)/,
    );
  assert.throws(() => main({ positionals: ['_p'], flags: {} } as never), /kebab-case/);
});
