import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_FILE,
  entryFile,
  isClientSlug,
  isProjectSlug,
  isPrototypeSlug,
  probeEntry,
  prototypeOfPath,
  RESERVED,
  RESERVED_CLIENTS,
} from './prototype.ts';

test('a prototype or project slug is kebab-case and never a first segment the gate answers', () => {
  assert.deepEqual(
    [...RESERVED],
    ['invite', 'api', '_gate', '_p', 'assets', 'guide', 'index.html', 'favicon.svg'],
  );
  for (const reserved of RESERVED) {
    assert.equal(isPrototypeSlug(reserved), false, reserved);
    assert.equal(isProjectSlug(reserved), false, reserved);
  }
  assert.equal(isPrototypeSlug('sample-list'), true);
  assert.equal(isProjectSlug('rebrand'), true);
  for (const bad of ['_p', 'Sample', 'a_b', '', 'a.js', 'a/b', null, 3])
    assert.equal(isPrototypeSlug(bad), false);
  assert.equal(entryFile('sample-list'), '_p/sample-list/entry.js');
  assert.equal(ALL_FILE, '_p/all.js');
});

test('a client slug is kebab-case and never the studio’s own host names', () => {
  assert.deepEqual([...RESERVED_CLIENTS], ['studio', 'www', 'api']);
  for (const reserved of RESERVED_CLIENTS) assert.equal(isClientSlug(reserved), false, reserved);
  assert.equal(isClientSlug('acme'), true);
  // A prototype's reserved names are no concern of a host's.
  assert.equal(isClientSlug('guide'), true);
  for (const bad of ['Acme', 'a_b', 'a:b', '', 'a.b', null, 3]) assert.equal(isClientSlug(bad), false);
});

test('a path names its prototype, or none for the hub’s own', () => {
  const cases: [string, string | null][] = [
    ['/', null],
    ['/assets/index-abc.js', null],
    ['/guide/sample/', null],
    ['/api/review', null],
    ['/favicon.svg', null],
    ['/_gate/geist.woff2', null],
    ['/index.html', null],
    ['/robots.txt', ''],
    // A link path the gate does not answer is no prototype's and no hub path: refused to a Client.
    ['/invite/short', ''],
    ['/Sample-List/', ''],
    ['/_p;x/secret/entry.js', ''],
    ['/_p./secret/entry.js', ''],
    ['/_p%20/secret/entry.js', ''],
    ['/_p%00/secret/entry.js', ''],
    ['/%EF%BC%BFp/secret/entry.js', ''],
    ['/＿p/secret/entry.js', ''],
    ['/assets;x/y.js', ''],
    ['/sample-list/', 'sample-list'],
    ['/sample-list', 'sample-list'],
    ['/sample-list/deep/path', 'sample-list'],
    ['/_p/sample-list/entry.js', 'sample-list'],
    ['/_p/sample-list', 'sample-list'],
    ['/_p/all.js', 'all.js'],
    ['/_p/', ''],
    ['/_p', ''],
    ['//_p//sample-list/x.js', ''],
    ['/assets/..%2f_p/secret/entry.js', ''],
    ['/api/..%2f_p/secret/entry.js', ''],
    ['/_p/open/..%2fsecret/entry.js', ''],
    ['/_p/open/.%2fentry.js', ''],
    ['/assets//x.js', ''],
    ['/_P/secret/entry.js', ''],
    ['/_P/all.js', ''],
    ['/%255Fp/secret/entry.js', ''],
    ['/_p%5csecret%5centry.js', ''],
    ['/assets%5cx.js', ''],
    ['/assets/a%20b.png', null],
    ['/assets/caf%C3%A9.png', null],
    ['/_p/secret/caf%C3%A9%20x.png', 'secret'],
    ['/guide/', null],
    ['/%5Fp/sample-list/entry.js', 'sample-list'],
    ['/_p/sample%2Dlist/entry.js', 'sample-list'],
    ['/_p%2Fsample-list%2Fentry.js', 'sample-list'],
    ['/%73ample-list/', 'sample-list'],
    ['/%E0%A4%A/', ''],
  ];
  for (const [path, owner] of cases) assert.equal(prototypeOfPath(path), owner, path);
});

test('an entry is there on a JavaScript 200, not there on a 404 or the host’s page, and an error otherwise', async () => {
  const asked: [string, RequestInit | undefined][] = [];
  const answer = (status: number, type = 'text/javascript') =>
    (async (url: string, init?: RequestInit) => {
      asked.push([url, init]);
      return new Response(null, { status, headers: { 'content-type': type } });
    }) as unknown as typeof fetch;
  assert.equal(await probeEntry('/_p/a/entry.js', answer(200)), true);
  assert.equal(
    await probeEntry('/_p/a/entry.js', answer(200, 'application/javascript; charset=utf-8')),
    true,
  );
  assert.equal(await probeEntry('/_p/a/entry.js', answer(404)), false);
  assert.equal(await probeEntry('/_p/a/entry.js', answer(200, 'text/html; charset=utf-8')), false);
  for (const status of [401, 403, 500, 503])
    await assert.rejects(probeEntry('/_p/a/entry.js', answer(status)), new RegExp(`answered ${status}`));
  assert.deepEqual(asked[0], ['/_p/a/entry.js', { method: 'HEAD', credentials: 'same-origin' }]);
});
