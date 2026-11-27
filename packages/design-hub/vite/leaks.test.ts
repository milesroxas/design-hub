/// <reference types="node" />
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ownerOf } from './boundary.ts';
import { dataUriForms, dataUrisIn, leaked, leaks, MIN, svgDataUrlPayload } from './leaks.ts';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-leaks-')));
after(() => rmSync(root, { recursive: true, force: true }));

const NOTES = 'The launch plan for the "beta" codename, which nobody outside may read.\n';
const SHARED = 'A paragraph the kit and one prototype both hold, word for word, on purpose.\n';
/** Every prototype file a test writes: by default, as if the build read each one. */
const prototypeFiles: string[] = [];
const write = (path: string, text: string) => {
  mkdirSync(join(root, path, '..'), { recursive: true });
  writeFileSync(join(root, path), text);
  if (path.startsWith('prototypes/')) prototypeFiles.push(join(root, path));
  return join(root, path);
};
write('prototypes/beta/README.md', '---\ntitle: beta\n---\n');
write('prototypes/beta/notes.md', NOTES);
write('prototypes/beta/shared.md', SHARED);
const kitShared = write('kit/shared.md', SHARED);
const prototypes = join(root, 'prototypes');
const check = (
  written: { fileName: string; source: string | Uint8Array }[],
  inputs: string[] = prototypeFiles,
) => leaks(root, prototypes, ownerOf(prototypes), inputs, written);

test('an SVG data URI is what Vite writes: trimmed, tags joined, quotes and reserved characters encoded', () => {
  assert.equal(
    svgDataUrlPayload('  <svg a="b">\n  <path d="M0 0" fill="#fff"/>\n</svg>\n'),
    "%3csvg%20a='b'%3e%3cpath%20d='M0%200'%20fill='%23fff'/%3e%3c/svg%3e",
  );
  assert.equal(svgDataUrlPayload('<svg><text>x</text></svg>'), null, 'Vite writes base64 for text');
});

test('a data URI is read for the whole content it holds: base64 decoded, or the SVG payload as written', () => {
  const bytes = Buffer.from(NOTES);
  const [b64] = dataUriForms(`data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(b64.form, 'base64');
  assert.equal(b64.size, bytes.length);
  assert.deepEqual(
    dataUriForms('data:image/svg+xml,%3csvg%3e%3c/svg%3e').map((f) => f.form),
    ['svg'],
  );
  assert.deepEqual(dataUriForms('data:text/plain,hello'), []);
  assert.deepEqual(
    dataUrisIn(
      `.a{background:url("data:image/svg+xml,%3csvg%20a='b'%3e")}.b{background:url(data:image/png;base64,AAAA) }`,
    ),
    ["data:image/svg+xml,%3csvg%20a='b'%3e", 'data:image/png;base64,AAAA'],
  );
});

test('a file shorter than MIN is never looked for', () => {
  const short = 'x'.repeat(MIN - 1);
  write('prototypes/beta/short.txt', short);
  assert.deepEqual(
    check([{ fileName: 'assets/s-1.js', source: `globalThis.s=${JSON.stringify(short)};` }]),
    [],
  );
  rmSync(join(root, 'prototypes/beta/short.txt'));
});

test('a part of a prototype’s file is not a leak: a line, or the text with more around it', () => {
  const line = NOTES.trim();
  assert.deepEqual(
    check([{ fileName: 'assets/a-1.js', source: `globalThis.x=${JSON.stringify(line)};` }]),
    [],
  );
  assert.deepEqual(
    check([{ fileName: 'assets/a-2.js', source: `globalThis.x=${JSON.stringify(`${NOTES}and more`)};` }]),
    [],
  );
});

test('a whole prototype file as a base64 data URI, or as the bytes of a built file, fails', () => {
  const uri = `data:text/markdown;base64,${Buffer.from(NOTES).toString('base64')}`;
  assert.deepEqual(check([{ fileName: 'assets/u-1.js', source: `globalThis.u=${JSON.stringify(uri)};` }]), [
    leaked('assets/u-1.js', 'prototypes/beta/notes.md', 'beta', 'base64'),
  ]);
  assert.deepEqual(check([{ fileName: 'assets/notes-1.md', source: Buffer.from(NOTES) }]), [
    leaked('assets/notes-1.md', 'prototypes/beta/notes.md', 'beta', 'bytes'),
  ]);
});

test('a file nobody may read is skipped: Vite could not have read it either', {
  skip: process.getuid?.() === 0 ? 'root reads every file' : false,
}, () => {
  const locked = write('prototypes/beta/locked.md', NOTES.replace('beta', 'gamma'));
  chmodSync(locked, 0o000);
  try {
    assert.deepEqual(
      check([
        {
          fileName: 'assets/l-1.js',
          source: `globalThis.l=${JSON.stringify(NOTES.replace('beta', 'gamma'))};`,
        },
      ]),
      [],
    );
  } finally {
    chmodSync(locked, 0o644);
    rmSync(locked);
  }
});

test('a prototype’s text in a hub script, escaped in a string, fails, naming both files', () => {
  assert.deepEqual(
    check([{ fileName: 'assets/index-1.js', source: `globalThis.x=${JSON.stringify(NOTES)};` }]),
    [leaked('assets/index-1.js', 'prototypes/beta/notes.md', 'beta', 'string')],
  );
});

test('the same text in its own folder, or text the kit holds as its own, is not a leak', () => {
  assert.deepEqual(
    check([{ fileName: '_p/beta/x.js', source: `export default ${JSON.stringify(NOTES)};` }]),
    [],
  );
  assert.deepEqual(
    check(
      [{ fileName: 'assets/kit-1.js', source: `export default ${JSON.stringify(SHARED)};` }],
      [kitShared],
    ),
    [],
  );
  assert.equal(
    check([{ fileName: 'assets/kit-1.js', source: `export default ${JSON.stringify(SHARED)};` }]).length,
    1,
  );
});

test('a string equal to a prototype’s file the build never read is not a leak: the same sentence, not the file', () => {
  const read = prototypeFiles.filter((f) => !f.endsWith('notes.md'));
  assert.deepEqual(
    check([{ fileName: '_p/alpha/x.js', source: `export default ${JSON.stringify(NOTES)};` }], read),
    [],
  );
  // A data URI is judged against every file, read or not: Vite inlines some without a hook seeing them.
  const uri = `data:text/markdown;base64,${Buffer.from(NOTES).toString('base64')}`;
  assert.deepEqual(
    check([{ fileName: '_p/alpha/u.js', source: `export default ${JSON.stringify(uri)};` }], read),
    [leaked('_p/alpha/u.js', 'prototypes/beta/notes.md', 'beta', 'base64')],
  );
});

test('a data URI inside a longer string of a script fails, as in `?inline` CSS', () => {
  const css = `.y{background:url(data:image/png;base64,${Buffer.from(NOTES).toString('base64')})}`;
  assert.deepEqual(check([{ fileName: 'assets/c-1.js', source: `export default ${JSON.stringify(css)};` }]), [
    leaked('assets/c-1.js', 'prototypes/beta/notes.md', 'beta', 'base64'),
  ]);
});

test('a folder nobody may list is skipped, as a file nobody may read is', {
  skip: process.getuid?.() === 0 ? 'root lists every folder' : false,
}, () => {
  const locked = join(root, 'prototypes/beta/private');
  mkdirSync(locked);
  chmodSync(locked, 0o000);
  try {
    assert.deepEqual(check([{ fileName: 'assets/n-1.js', source: 'export default 1;' }]), []);
  } finally {
    chmodSync(locked, 0o755);
    rmSync(locked, { recursive: true });
  }
});

test('a built script that does not parse fails the check: it is never skipped', () => {
  assert.match(
    check([{ fileName: 'assets/x.js', source: 'export const = ;' }])[0],
    /assets\/x\.js does not parse/,
  );
});
