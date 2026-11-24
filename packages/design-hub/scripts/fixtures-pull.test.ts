import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMap, pick, sourceFor } from './fixtures-pull.ts';

test("maps keys to field paths from the source's root, nulling what is not there", () => {
  const item = { id: 'a1', fieldData: { name: 'Ana', thumbnail: { url: 'https://x/y.png', alt: null } } };
  const maps = ['title=name', 'cover=thumbnail.url', 'owner=author.name'].map(parseMap);
  assert.deepEqual(pick('webflow', item, maps), {
    id: 'a1',
    title: 'Ana',
    cover: 'https://x/y.png',
    owner: null,
  });
  assert.deepEqual(
    pick('wordpress', { id: 9, title: { rendered: 'A &amp; B' } }, [parseMap('title=title.rendered')]),
    {
      id: '9',
      title: 'A & B',
    },
  );
  assert.deepEqual(pick('file', { data: { id: 'e1', title: 'T' } }, [parseMap('title=data.title')]), {
    id: '',
    title: 'T',
  });
});

test('refuses a map without key=path', () => {
  assert.throws(() => parseMap('name'), /key=field.path/);
  assert.throws(() => parseMap('1x=name'), /key=field.path/);
});

test('the source follows --from, then --source, then the website platform', () => {
  assert.equal(sourceFor(undefined, 'items.json', 'payload'), 'file');
  assert.equal(sourceFor('wordpress', undefined, 'payload'), 'wordpress');
  assert.equal(sourceFor(undefined, undefined, 'payload'), 'payload');
  assert.equal(sourceFor(undefined, undefined, 'webflow'), 'webflow');
  assert.equal(sourceFor(undefined, undefined, undefined), 'webflow');
  assert.throws(() => sourceFor(undefined, undefined, 'emdash'), /from a file/);
});
