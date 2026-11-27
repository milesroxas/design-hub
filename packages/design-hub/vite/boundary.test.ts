import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { after, test } from 'node:test';
import {
  chunkProblems,
  copyFor,
  crossImport,
  ENTRY_ID,
  isFixed,
  looseFile,
  newUrlTargets,
  ownerOf,
  ownersOf,
  placed,
  placementsOf,
  readsAcross,
  repointText,
  unreadable,
  unrecorded,
  workerRefused,
} from './boundary.ts';
import { fileOfRef, modulesChain, valueRefs } from './css-boundary.ts';

const P = '/work/project/prototypes';

/** Every temp folder or link a test makes, removed when the file is done. */
const made: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const path of made) rmSync(path, { recursive: true, force: true });
});

test('a module belongs to the prototype folder it sits in, whatever its query', () => {
  const owner = ownerOf(P);
  assert.equal(owner(`${P}/alpha/index.tsx`), 'alpha');
  assert.equal(owner(`${P}/alpha/deep/x.css?inline`), 'alpha');
  assert.equal(owner(`\0${P}/alpha/README.md?raw`), 'alpha');
  assert.equal(owner(`\0${ENTRY_ID}alpha`), 'alpha');
  assert.equal(owner(`${ENTRY_ID}beta`), 'beta');
  assert.equal(owner(`${P}/_shared/x.ts`), '_shared');
  // A file directly in prototypes/ is owned by its own name: never the hub's.
  assert.equal(owner(`${P}/top.ts`), 'top.ts');
  assert.equal(owner(`${P}-other/alpha/x.ts`), null);
  assert.equal(owner('/work/project/kit/Space.tsx'), null);
  assert.equal(owner('\0vite/preload-helper.js'), null);
  assert.deepEqual(ownersOf(owner, [`${P}/b/x`, `${P}/a/y`, '/kit/z', `${P}/a/z`]), ['a', 'b']);
});

test('owners on Windows paths: backslashes from realpath, forward slashes from Vite, either drive-letter case', () => {
  // Not run on Windows here: the paths are fed to the Windows path rules (path.win32).
  const owner = ownerOf('C:\\work\\project\\prototypes', win32);
  assert.equal(owner('C:\\work\\project\\prototypes\\alpha\\index.tsx'), 'alpha');
  assert.equal(owner('C:/work/project/prototypes/alpha/deep/x.css?inline'), 'alpha');
  assert.equal(owner('c:\\work\\project\\prototypes\\alpha\\x.ts'), 'alpha');
  assert.equal(owner('C:\\work\\project\\prototypes\\top.ts'), 'top.ts');
  assert.equal(owner('C:\\work\\project\\prototypes'), null);
  assert.equal(owner('C:\\work\\project\\prototypes-other\\alpha\\x.ts'), null);
  assert.equal(owner('C:\\work\\project\\kit\\Space.tsx'), null);
  assert.equal(owner('D:\\work\\project\\prototypes\\alpha\\x.ts'), null);
  assert.equal(owner('\0vite/preload-helper.js'), null);
  assert.equal(owner(`\0${ENTRY_ID}alpha`), 'alpha');
});

test('a module reached through a symlinked project still belongs to its prototype', () => {
  const real = realpathSync(temp('own-'));
  mkdirSync(join(real, 'prototypes', 'alpha'), { recursive: true });
  const link = `${real}-link`;
  symlinkSync(real, link);
  made.push(link);
  const owner = ownerOf(join(link, 'prototypes'));
  assert.equal(owner(join(real, 'prototypes', 'alpha', 'index.tsx')), 'alpha');
  assert.equal(owner(join(link, 'prototypes', 'alpha', 'index.tsx')), 'alpha');
});

test('a file goes under _p/<slug>/ for one prototype, and to assets/ for none or two', () => {
  assert.equal(placed(['alpha'], '[name]-[hash].js'), '_p/alpha/[name]-[hash].js');
  assert.equal(placed([], '[name]-[hash].js'), 'assets/[name]-[hash].js');
  assert.equal(placed(['a', 'b'], '[name].css'), 'assets/[name].css');
  assert.equal(placed(['a'], '[name].png', true), 'assets/[name].png');
});

test('a chunk sits under its one prototype’s folder, and never holds two', () => {
  assert.deepEqual(chunkProblems('_p/alpha/x.js', ['alpha']), []);
  assert.deepEqual(chunkProblems('assets/index.js', []), []);
  assert.deepEqual(chunkProblems('assets/x.js', ['alpha']), [
    'assets/x.js holds files of prototypes/alpha/ but is not under _p/alpha/',
  ]);
  assert.deepEqual(chunkProblems('_p/alpha-two/x.js', ['alpha']), [
    '_p/alpha-two/x.js holds files of prototypes/alpha/ but is not under _p/alpha/',
  ]);
  assert.deepEqual(chunkProblems('_p/alpha/x.js', ['alpha', 'beta']), [
    '_p/alpha/x.js holds files of prototypes/alpha/ and prototypes/beta/',
  ]);
});

test('an asset goes where the owners of its content are: one copy each, named from its own source', () => {
  const slugs = ['pricing-page', 'secret-rebrand', 'secret-one', 'alpha', 'beta'];
  const css = (owner: string) => ({ owner, file: `prototypes/${owner}/styles.css` });
  // Twin stylesheets: one copy each, none named for the other.
  assert.deepEqual(
    placementsOf(
      '_p/pricing-page/pricing-page-AbCdEfGh.css',
      [css('pricing-page'), css('secret-rebrand')],
      slugs,
      'h1h2h3h4',
    ),
    [
      { owner: 'pricing-page', fileName: '_p/pricing-page/styles-h1h2h3h4.css' },
      { owner: 'secret-rebrand', fileName: '_p/secret-rebrand/styles-h1h2h3h4.css' },
    ],
  );
  // The hub's font and a prototype's with the same bytes: assets/ takes the hub source's name.
  assert.deepEqual(
    placementsOf(
      'assets/acme-rebrand-typeface-AbCdEfGh.woff2',
      [
        { owner: null, file: 'node_modules/geist/geist-latin-wght-normal.woff2' },
        { owner: 'secret-one', file: 'prototypes/secret-one/acme-rebrand-typeface.woff2' },
      ],
      slugs,
      'h1h2h3h4',
    ),
    [
      { owner: null, fileName: 'assets/geist-latin-wght-normal-h1h2h3h4.woff2' },
      { owner: 'secret-one', fileName: '_p/secret-one/acme-rebrand-typeface-AbCdEfGh.woff2' },
    ],
  );
  // A kit sheet and a prototype's with the same bytes, named for the prototype's module: assets/ takes the kit's name.
  assert.deepEqual(
    placementsOf(
      'assets/nightfall-codename-AbCdEfGh.css',
      [
        { owner: null, file: 'kit/card.css' },
        { owner: 'beta', file: 'prototypes/beta/night.css' },
      ],
      slugs,
      'h1h2h3h4',
    ),
    [
      { owner: 'beta', fileName: '_p/beta/night-h1h2h3h4.css' },
      { owner: null, fileName: 'assets/card-h1h2h3h4.css' },
    ],
  );
  // A name Rolldown made safe stays safe: a copy named from a raw source is made safe the same way.
  assert.deepEqual(
    placementsOf(
      '_p/alpha/half50_-AbCdEfGh.png',
      [
        { owner: null, file: 'kit/half.png' },
        { owner: 'alpha', file: 'prototypes/alpha/half50%.png' },
      ],
      slugs,
      'h1h2h3h4',
    ),
    [
      { owner: 'alpha', fileName: '_p/alpha/half50_-AbCdEfGh.png' },
      { owner: null, fileName: 'assets/half-h1h2h3h4.png' },
    ],
  );
  assert.deepEqual(
    placementsOf(
      '_p/beta/beta-AbCdEfGh.png',
      [{ owner: 'alpha', file: 'prototypes/alpha/a&b[1];c,d=e%.png' }],
      ['alpha', 'beta'],
      'h',
    ),
    [{ owner: 'alpha', fileName: '_p/alpha/a_b_1__c_d_e_-h.png' }],
  );
  // A stylesheet only one prototype's modules made, written to assets/: moved, keeping its name.
  assert.deepEqual(placementsOf('assets/shared-AbCdEfGh.css', [css('alpha')], slugs, 'h'), [
    { owner: 'alpha', fileName: '_p/alpha/shared-AbCdEfGh.css' },
  ]);
  // Already where its one owner is, or kit-only, or of unknown source, or a fixed name: it stays.
  assert.equal(placementsOf('_p/alpha/a-AbCdEfGh.css', [css('alpha')], slugs, 'h'), null);
  assert.equal(
    placementsOf('assets/ui-AbCdEfGh.css', [{ owner: null, file: 'kit/ui.css' }], slugs, 'h'),
    null,
  );
  assert.equal(placementsOf('assets/w-AbCdEfGh.js', null, slugs, 'h'), null);
  assert.equal(placementsOf('_p/all.js', [css('alpha')], slugs, 'h'), null);
  assert.equal(placementsOf('_gate/geist.woff2', [{ owner: null, file: 'x' }], slugs, 'h'), null);
});

test('a reader gets its own copy, else the hub’s; a prototype’s file is never another’s', () => {
  const places = [
    { owner: 'alpha', fileName: '_p/alpha/l.png' },
    { owner: null, fileName: 'assets/l.png' },
  ];
  assert.deepEqual(copyFor(places, 'alpha'), places[0]);
  assert.deepEqual(copyFor(places, 'beta'), places[1]);
  assert.deepEqual(copyFor(places, null), places[1]);
  assert.equal(copyFor([places[0]], 'beta'), null);
  assert.equal(copyFor([places[0]], null), null);
  assert.match(
    readsAcross('_p/alpha/x.js', { owner: 'beta', file: 'prototypes/beta/bg.png' }),
    /^_p\/alpha\/x\.js reads prototypes\/beta\/bg\.png, which belongs to prototypes\/beta\/\./,
  );
  assert.match(
    unrecorded('assets/x-1.js'),
    /^assets\/x-1\.js was written with no record of where its content comes from/,
  );
  assert.match(
    workerRefused('/work/project', `${P}/alpha/w.ts`),
    /^prototypes\/alpha\/w\.ts is in a web worker\. A worker cannot use a prototype's files/,
  );
});

test('fixed names are never moved or read for references', () => {
  for (const name of ['_p/all.js', '_p/alpha/entry.js', '_gate/geist.woff2', 'index.html', 'favicon.svg'])
    assert.equal(isFixed(name), true, name);
  for (const name of ['assets/ui-AbCdEfGh.css', '_p/alpha/alpha-AbCdEfGh.js', '_p/alpha/entry-x.js'])
    assert.equal(isFixed(name), false, name);
});

test('a reference is pointed at the copy whole, and relative to the file that makes it', () => {
  assert.equal(
    repointText('m.f=["_p/a/a-1.css","assets/x.js"]', '_p/b/entry.js', '_p/a/a-1.css', '_p/b/b-2.css'),
    'm.f=["_p/b/b-2.css","assets/x.js"]',
  );
  assert.equal(
    repointText('url(/_p/a/l.png)', 'assets/i.css', '_p/a/l.png', 'assets/l.png'),
    'url(/assets/l.png)',
  );
  assert.equal(repointText('url(../a/l.png)', '_p/b/s.css', '_p/a/l.png', '_p/b/l.png'), 'url(l.png)');
  assert.equal(
    repointText('"../../assets/l.png"', '_p/b/x.js', 'assets/l.png', '_p/b/l.png'),
    '"../../_p/b/l.png"',
  );
});

test('in a stylesheet only references count: url(), image-set() strings; never content text', () => {
  assert.deepEqual(valueRefs('url(../beta/bg.png)'), ['../beta/bg.png']);
  assert.deepEqual(valueRefs('url( "../beta/bg.png" ) no-repeat'), ['../beta/bg.png']);
  assert.deepEqual(valueRefs('image-set("../beta/a.png" 1x, url(./b.png) 2x)'), ['./b.png', '../beta/a.png']);
  assert.deepEqual(valueRefs('-webkit-image-set("./a.png" 1x)'), ['./a.png']);
  assert.deepEqual(valueRefs('"../beta-proto/readme"'), []);
  assert.deepEqual(valueRefs("url('data:image/png;base64,x'), url(#f), url(https://x.test/a.png)"), []);
});

test('a reference is a file beside its stylesheet, or an absolute path that exists', () => {
  const dir = temp('ref-');
  writeFileSync(join(dir, 'there.png'), '');
  assert.equal(fileOfRef('../beta/bg.png?x#y', '/p/prototypes/alpha/s.css'), '/p/prototypes/beta/bg.png');
  assert.equal(fileOfRef(join(dir, 'there.png'), '/p/prototypes/alpha/s.css'), join(dir, 'there.png'));
  assert.equal(fileOfRef('/public.png', '/p/prototypes/alpha/s.css'), null);
  assert.equal(fileOfRef('@kit/x.png', '/p/prototypes/alpha/s.css'), null);
});

test('a composes chain is read from the files, through every module it names, each once', async () => {
  const root = temp('comp-');
  const alpha = join(root, 'prototypes', 'alpha');
  const beta = join(root, 'prototypes', 'beta');
  mkdirSync(alpha, { recursive: true });
  mkdirSync(beta, { recursive: true });
  writeFileSync(join(alpha, 'x.module.css'), ".a { composes: m from './mid.module.css'; }");
  writeFileSync(
    join(alpha, 'mid.module.css'),
    ".m { composes: b from '../beta/y.module.css'; composes: a from './x.module.css'; }",
  );
  writeFileSync(
    join(beta, 'y.module.css'),
    '@value v from "./v.module.css";\n:import("./w.module.css") { w: w; }\n.b { color: red; }',
  );
  writeFileSync(join(beta, 'v.module.css'), '@value v: red;');
  writeFileSync(join(beta, 'w.module.css'), '.w { color: red; }');
  assert.deepEqual(await modulesChain(join(alpha, 'x.module.css')), [
    join(alpha, 'mid.module.css'),
    join(beta, 'y.module.css'),
    join(beta, 'v.module.css'),
    join(beta, 'w.module.css'),
    join(alpha, 'x.module.css'),
  ]);
});

test('a cross-prototype reach names the files from the project root', () => {
  assert.equal(
    crossImport('/work/project', `${P}/alpha/index.tsx`, `${P}/beta/heavy.ts?raw`),
    "prototypes/alpha/index.tsx imports prototypes/beta/heavy.ts, another prototype's file. A prototype imports only @kit/* and its own folder: copy the file into this prototype, or move it into kit/.",
  );
  assert.match(
    crossImport('/work/project', '/work/project/kit/tokens.css', `${P}/beta/bg.png`, false),
    /^kit\/tokens\.css imports prototypes\/beta\/bg\.png, a prototype's file, which the kit and the hub never read\./,
  );
});

test('new URL targets are found with a parser, never in a comment, a string, a regex or JSX text', () => {
  const open = '$' + '{';
  const code = [
    'const q = /"/g;',
    "const a = new URL('../beta/tiny.png?inline', import.meta.url);",
    'const b = new URL ("./own.png", import.meta.url);',
    "const c = new URL(/* c */ '../beta/bg.png', import.meta.url);",
    "// new URL('../beta/x.png', import.meta.url)",
    'const s = "new URL(\'../beta/y.png\', import.meta.url)";',
    "const d = new URL(/* @vite-ignore */ '../beta/z.png', import.meta.url);",
    `const e = new URL(\`./dir/${open}name}.png\`, import.meta.url);`,
    'const t = new URL(`./plain.png`, import.meta.url);',
    "const f = new URL('data:text/plain,x', import.meta.url);",
    "const g = new URL('../beta/elsewhere.png', location.href);",
    "const r = /'/;",
    "const h = new URL('../beta/after-regex.png', import.meta.url);",
  ].join('\n');
  assert.deepEqual(newUrlTargets(code, '/p/prototypes/alpha/x.ts'), [
    '../beta/tiny.png?inline',
    './own.png',
    '../beta/bg.png',
    './plain.png',
    '../beta/after-regex.png',
  ]);
  assert.equal(newUrlTargets('const = ;', '/p/x.ts'), null);
});

test('a reach into prototypes/ outside any prototype, and a stylesheet that does not parse, say what to do', () => {
  assert.match(
    looseFile('/work/project', `${P}/alpha/x.ts`, `${P}/common.ts`),
    /^prototypes\/alpha\/x\.ts imports prototypes\/common\.ts, which is in prototypes\/ but in no prototype's folder\. .*shared code belongs in kit\/\./,
  );
  assert.match(
    unreadable('/work/project', `${P}/alpha/s.css`, 3, 7, 'Unclosed block'),
    /^prototypes\/alpha\/s\.css:3:7: this stylesheet does not parse \(Unclosed block\)\. Fix the stylesheet/,
  );
});

test('a copy is never named for another owner’s file or the chunk another owner wrote', () => {
  const slugs = ['alpha', 'beta'];
  // A kit-only sheet that a prototype's chunk wrote, so Vite named it for the prototype's module.
  assert.deepEqual(
    placementsOf(
      'assets/nightfall-launch-AbCdEfGh.css',
      [{ owner: null, file: 'kit/panel.css', writer: 'alpha' }],
      slugs,
      'h1h2h3h4',
    ),
    [{ owner: null, fileName: 'assets/panel-h1h2h3h4.css' }],
  );
  // The same bytes in two prototypes: each copy named for its own file.
  assert.deepEqual(
    placementsOf(
      '_p/alpha/hero-AbCdEfGh.png',
      [
        { owner: 'alpha', file: 'prototypes/alpha/nightfall-codename.png' },
        { owner: 'beta', file: 'prototypes/beta/hero.png' },
      ],
      slugs,
      'h1h2h3h4',
    ),
    [
      { owner: 'alpha', fileName: '_p/alpha/nightfall-codename-h1h2h3h4.png' },
      { owner: 'beta', fileName: '_p/beta/hero-AbCdEfGh.png' },
    ],
  );
});
