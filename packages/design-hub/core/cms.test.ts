import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fieldPaths,
  fieldRoot,
  itemsInFile,
  missingEnv,
  pageRequest,
  plainText,
  readPage,
  valueAt,
} from './cms.ts';

test('each source builds its page request', () => {
  const webflow = pageRequest('webflow', { WEBFLOW_TOKEN: 't' }, 'abc', 2, false);
  assert.equal(webflow.url, 'https://api.webflow.com/v2/collections/abc/items/live?offset=100&limit=100');
  assert.equal(webflow.headers.authorization, 'Bearer t');
  assert.match(pageRequest('webflow', {}, 'abc', 1, true).url, /\/items\?offset=0/);

  const payload = pageRequest(
    'payload',
    { PAYLOAD_URL: 'https://cms.x/', PAYLOAD_API_KEY: 'k' },
    'posts',
    1,
    true,
  );
  assert.equal(payload.url, 'https://cms.x/api/posts?limit=100&page=1&depth=1&draft=true');
  assert.equal(payload.headers.authorization, 'users API-Key k');
  assert.equal(
    pageRequest(
      'payload',
      { PAYLOAD_URL: 'https://cms.x', PAYLOAD_API_KEY: 'k', PAYLOAD_AUTH_COLLECTION: 'admins' },
      'posts',
      1,
      false,
    ).headers.authorization,
    'admins API-Key k',
  );

  const wp = pageRequest('wordpress', { WORDPRESS_URL: 'https://site.x' }, 'posts', 3, false);
  assert.equal(wp.url, 'https://site.x/wp-json/wp/v2/posts?per_page=100&page=3&_embed=1');
  assert.equal(wp.headers.authorization, undefined);
  const wpDrafts = pageRequest(
    'wordpress',
    { WORDPRESS_URL: 'https://site.x', WORDPRESS_USER: 'ed', WORDPRESS_APP_PASSWORD: 'p w' },
    'posts',
    1,
    true,
  );
  assert.match(wpDrafts.url, /status=any/);
  assert.equal(wpDrafts.headers.authorization, `Basic ${btoa('ed:p w')}`);
});

test('each source reads its page and says whether another follows', () => {
  const wf = readPage(
    'webflow',
    { items: [{ id: 'a' }, { id: 'b', isArchived: true }], pagination: { total: 150, offset: 0 } },
    1,
  );
  assert.deepEqual(wf, { items: [{ id: 'a' }], more: true });
  assert.equal(
    readPage('webflow', { items: [{ id: 'a' }], pagination: { total: 150, offset: 100 } }, 2).more,
    false,
  );
  assert.deepEqual(readPage('payload', { docs: [{ id: 1 }], hasNextPage: false }, 1), {
    items: [{ id: 1 }],
    more: false,
  });
  assert.equal(readPage('wordpress', [{ id: 1 }], 1, '2').more, true);
  assert.equal(readPage('wordpress', [{ id: 1 }], 2, '2').more, false);
  assert.equal(readPage('wordpress', [], 1, '5').more, false);
});

test('a file holds its items in an array, at the top or under a common key', () => {
  assert.deepEqual(itemsInFile([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(itemsInFile({ entries: [{ a: 1 }] }), [{ a: 1 }]);
  assert.deepEqual(itemsInFile({ data: { items: [{ a: 1 }] } }), [{ a: 1 }]);
  assert.equal(itemsInFile({ nothing: 1 }), null);
  assert.equal(itemsInFile('x'), null);
});

test('fields are read by path, with WordPress HTML made plain', () => {
  const item = {
    id: 7,
    title: { rendered: 'Caf&eacute; &amp; <em>bar</em> &#8217;s' },
    _embedded: { 'wp:featuredmedia': [{ source_url: 'https://x/y.jpg' }] },
  };
  assert.equal(valueAt(item, ['_embedded', 'wp:featuredmedia', '0', 'source_url']), 'https://x/y.jpg');
  assert.equal(valueAt(item, ['title', 'rendered']), 'Café & bar ’s');
  assert.equal(valueAt(item, ['author', 'name']), undefined);
  assert.equal(plainText('<p>One\n two</p>&nbsp;'), 'One two');
  assert.deepEqual(fieldRoot('webflow', { id: 'a', fieldData: { name: 'x' } }), { name: 'x' });
  assert.deepEqual(fieldRoot('payload', { id: 'a' }), { id: 'a' });
});

test('field paths list every leaf with a sample', () => {
  assert.deepEqual(fieldPaths({ title: 'Hi', image: { url: 'u' }, tags: ['a', 'b'] }), [
    { path: 'title', sample: '"Hi"' },
    { path: 'image.url', sample: '"u"' },
    { path: 'tags.0', sample: '"a"' },
  ]);
  assert.deepEqual(missingEnv('payload', { PAYLOAD_URL: 'x' }), ['PAYLOAD_API_KEY']);
});
