import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMap, pick } from './fixtures-pull.ts';

test('maps keys to fieldData paths, nulling what is not there', () => {
  const item = { id: 'a1', fieldData: { name: 'Ana', thumbnail: { url: 'https://x/y.png', alt: null } } };
  const maps = ['title=name', 'cover=thumbnail.url', 'owner=author.name'].map(parseMap);
  assert.deepEqual(pick(item, maps), { id: 'a1', title: 'Ana', cover: 'https://x/y.png', owner: null });
});

test('refuses a map without key=path', () => {
  assert.throws(() => parseMap('name'), /key=field.path/);
  assert.throws(() => parseMap('1x=name'), /key=field.path/);
});
