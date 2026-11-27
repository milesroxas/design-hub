/// <reference types="node" />
// A real Vite build of a small project, read file by file: everything built
// from prototypes/<slug>/ is under _p/<slug>/ and nowhere else, every
// reference a prototype's files make points into its own folder or the shared
// assets/, no file outside _p/ names a slug, and a prototype that reaches into
// another (an import, a CSS @import or url(), a new URL) or starts a worker
// fails the build. Each build has its own project folder, output and cache.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { after, before, test } from 'node:test';
import { build, type Plugin } from 'vite';
import type { Track } from '../core/project.ts';
import { PACKAGE, TEMPLATES } from '../server/paths.ts';
import { hubConfig } from './plugin.ts';

/** Prototypes with a sentinel in every kind of file. */
const SLUGS = ['alpha-proto', 'beta-proto'] as const;
/** A prototype whose font has the same bytes as the hub's own Geist. */
const FONTED = 'secret-one';
/** Two prototypes fresh from `design-hub new`: their styles.css are byte for byte the same. */
const TWINS = ['pricing-page', 'secret-rebrand'] as const;
/** One prototype from each other template `design-hub new` copies: their READMEs share most lines. */
const SCAFFOLDS = [
  ['fixture-app-shell', 'product', true],
  ['fixture-site-shell', 'website', true],
  ['fixture-brand-board', 'brand', false],
] as const;
const ALL = [...SLUGS, ...TWINS, ...SCAFFOLDS.map(([slug]) => slug), FONTED];
const KINDS = ['README', 'CODE', 'CSS', 'FIXTURE', 'LAZY', 'BG', 'PHOTO', 'SHAREDCSS'] as const;
const sentinel = (kind: string, slug: string) => `${kind}-SENTINEL-${slug.toUpperCase()}`;

/** One image copied into both prototypes and the project's kit/, byte for byte: Rolldown would write it once. */
const SHARED = Buffer.concat([Buffer.from('SHARED-SENTINEL'), randomBytes(6 * 1024)]);
/** Image bytes over Vite's 4 KB inline limit, unique per prototype, carrying a sentinel. */
const image = (kind: string, slug: string) =>
  Buffer.concat([Buffer.from(sentinel(kind, slug)), randomBytes(6 * 1024)]);

const README = (slug: string, body = '') =>
  `---\ntitle: ${slug}\nsummary: x\ncontext: space\ntrack: product\nstatus: exploring\nkind: exploration\nfeature: ''\ncreated: 2030-01-01\n---\n\n${body}\n`;

function prototype(root: string, slug: string) {
  const dir = join(root, 'prototypes', slug);
  mkdirSync(dir, { recursive: true });
  const s = (kind: string) => sentinel(kind, slug);
  // Prose that names fixed files and another prototype's folder: never a reference.
  writeFileSync(
    join(dir, 'README.md'),
    README(slug, `${s('README')}\n\nSee _p/all.js, _gate/geist.woff2 and ../beta-proto/ for the other one.`),
  );
  writeFileSync(join(dir, 'bg.png'), image('BG', slug));
  writeFileSync(join(dir, 'photo.jpg'), image('PHOTO', slug));
  writeFileSync(join(dir, 'logo.png'), SHARED);
  writeFileSync(join(dir, 'fixtures.json'), JSON.stringify({ text: s('FIXTURE'), href: '../beta-proto/' }));
  writeFileSync(
    join(dir, 'styles.css'),
    `/* @import '../beta-proto/styles.css'; was here */\n.x-${slug} { content: "${s('CSS')}"; background: url(./bg.png); }\n`,
  );
  // A module the entry and the lazy chunk both import, with CSS of its own.
  writeFileSync(join(dir, 'shared.css'), `.s-${slug} { content: "${s('SHAREDCSS')}"; }\n`);
  writeFileSync(join(dir, 'shared.ts'), "import './shared.css';\nexport const shared = () => 1;\n");
  writeFileSync(
    join(dir, 'heavy.ts'),
    `import { shared } from './shared.ts';\nexport const run = () => console.log(${JSON.stringify(s('LAZY'))}, shared());\n`,
  );
  writeFileSync(
    join(dir, 'index.tsx'),
    [
      "import './styles.css';",
      "import photo from './photo.jpg';",
      "import logo from './logo.png';",
      "import fixtures from './fixtures.json';",
      "import { shared } from './shared.ts';",
      "// new URL('../beta-proto/bg.png', import.meta.url) and new Worker(new URL('./w.ts', import.meta.url)) are gone.",
      "export const jobs = '/jobs?worker';",
      'export const link = \'<a href="../beta-proto/">The other one</a>\';',
      'export default function Prototype() {',
      `  console.log(${JSON.stringify(s('CODE'))}, fixtures.text, photo, logo, shared());`,
      "  void import('./heavy.ts').then((m) => m.run());",
      '  return null;',
      '}',
      '',
    ].join('\n'),
  );
}

/**
 * A prototype as `design-hub new` scaffolds it, as files by path: the
 * package's template folder its track and `--app` pick (`templateFor` in
 * scripts/new.ts: `space`, `app` for a product, `site` for a website, `brand`
 * for brand collateral), its placeholders filled.
 */
function fromTemplate(slug: string, track: Track = 'product', app = false): Record<string, string> {
  const dir = join(
    TEMPLATES,
    track === 'brand' ? 'brand' : !app ? 'space' : track === 'website' ? 'site' : 'app',
  );
  const vars: Record<string, string> = {
    title: slug,
    slug,
    created: '2030-01-01',
    kind: 'exploration',
    feature: '',
    track,
  };
  return Object.fromEntries(
    readdirSync(dir).map((name) => {
      let text = readFileSync(join(dir, name), 'utf8');
      for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{{${k}}}`, () => v);
      return [`prototypes/${slug}/${name}`, text];
    }),
  );
}

/** The project `npm create` makes: its kit, and its sample prototypes. */
const TEMPLATE_PROJECT = join(PACKAGE, '..', 'create-design-hub', 'template');
/** A folder of the template project (its kit, or a sample prototype), as files by path. */
const fromProject = (path: string): Record<string, Buffer> =>
  Object.fromEntries(
    files(join(TEMPLATE_PROJECT, path)).map((f) => [relative(TEMPLATE_PROJECT, f), readFileSync(f)]),
  );

const geist = join(
  dirname(createRequire(import.meta.url).resolve('@fontsource-variable/geist')),
  'files',
  'geist-latin-wght-normal.woff2',
);

/** A prototype with a font byte for byte the hub's Geist latin, under a name that must never reach assets/. */
function fonted(root: string) {
  const dir = join(root, 'prototypes', FONTED);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), README(FONTED));
  cpSync(geist, join(dir, 'acme-rebrand-typeface.woff2'));
  writeFileSync(
    join(dir, 'styles.css'),
    "@font-face { font-family: Acme; src: url(./acme-rebrand-typeface.woff2) format('woff2'); }\n.f { font-family: Acme; }\n",
  );
  writeFileSync(
    join(dir, 'index.tsx'),
    "import './styles.css';\nexport default function P() { return null; }\n",
  );
}

function project() {
  const root = mkdtempSync(join(tmpdir(), 'hub-build-'));
  // The hub imports @kit/tokens.css, the project's own file; it uses the image both prototypes copied.
  mkdirSync(join(root, 'kit'), { recursive: true });
  writeFileSync(join(root, 'kit', 'logo.png'), SHARED);
  writeFileSync(join(root, 'kit', 'tokens.css'), ':root { --logo: url(./logo.png); }\n');
  // The template project's kit shells, which the app and site templates stand in; the tokens are this fixture's.
  const { 'kit/tokens.css': _, ...shells } = fromProject('kit');
  write(root, shells);
  for (const slug of SLUGS) prototype(root, slug);
  for (const slug of TWINS) write(root, fromTemplate(slug));
  for (const [slug, track, app] of SCAFFOLDS) write(root, fromTemplate(slug, track, app));
  fonted(root);
  return root;
}

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)],
  );

/** Every warning Rolldown raised, by code. */
let warnings: string[] = [];

/**
 * What a row adds to the hub's config: a test-only plugin, the aliases a
 * project's own vite.config.ts might set, or the names of the hub's own
 * plugins to leave out.
 */
type Extra = { plugins?: Plugin[]; alias?: Record<string, string>; without?: string[] };

const quiet = (root: string, { plugins = [], alias, without = [] }: Extra = {}) => {
  const config = hubConfig({ root }, 'build');
  const flat = (p: unknown): unknown[] => (Array.isArray(p) ? p.flatMap(flat) : [p]);
  const own = flat(config.plugins ?? []).filter(
    (p) => !(p && typeof p === 'object' && 'name' in p && without.includes(String(p.name))),
  ) as Plugin[];
  return {
    ...config,
    plugins: [...own, ...plugins],
    resolve: { ...config.resolve, ...(alias ? { alias } : {}) },
    logLevel: 'silent' as const,
    build: {
      ...config.build,
      rolldownOptions: {
        onLog: (_level: string, log: { code?: string; message: string }) => {
          warnings.push(`${log.code}: ${log.message}`);
        },
      },
    },
  };
};

let root: string;
let dist: Map<string, Buffer>;

before(async () => {
  root = project();
  warnings = [];
  await build(quiet(root));
  const out = join(root, 'dist');
  dist = new Map(files(out).map((f) => [relative(out, f), readFileSync(f)]));
});

after(() => rmSync(root, { recursive: true, force: true }));

const holding = (text: string) => [...dist].filter(([, bytes]) => bytes.includes(text)).map(([name]) => name);
const under = (slug: string) => [...dist].filter(([name]) => name.startsWith(`_p/${slug}/`));

/** The files an entry preloads with its loader, from Vite's dependency list. */
function preloads(slug: string): string[] {
  const code = dist.get(`_p/${slug}/entry.js`)?.toString() ?? '';
  const list = code.match(/m\.f=\[([^\]]*)\]/)?.[1] ?? '';
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test('everything built from a prototype is under _p/<slug>/, and found there', () => {
  for (const slug of SLUGS)
    for (const kind of KINDS) {
      const where = holding(sentinel(kind, slug));
      assert.ok(where.length > 0, `${kind} of ${slug} is in the build`);
      for (const name of where) assert.ok(name.startsWith(`_p/${slug}/`), `${kind} of ${slug} in ${name}`);
    }
  // The README text sits in the entry alone, and the entry has no hash.
  for (const slug of SLUGS) assert.deepEqual(holding(sentinel('README', slug)), [`_p/${slug}/entry.js`]);
});

test('every file an entry preloads is its own or shared, and exists', () => {
  for (const slug of ALL) {
    const list = preloads(slug);
    assert.ok(
      list.some((f) => f.endsWith('.css')),
      `${slug} preloads its CSS`,
    );
    for (const file of list) {
      assert.ok(file.startsWith(`_p/${slug}/`) || file.startsWith('assets/'), `${slug} preloads ${file}`);
      assert.ok(dist.has(file), `${slug} preloads ${file}, which is in the build`);
    }
  }
});

test('no file under one prototype’s folder refers into another’s, or carries its slug in its name', () => {
  for (const a of ALL)
    for (const b of ALL) {
      if (a === b) continue;
      const named = under(a)
        .filter(([name, bytes]) => name.includes(b) || bytes.includes(`_p/${b}/`))
        .map(([name]) => name);
      assert.deepEqual(named, [], `${b} in _p/${a}/`);
    }
});

test('prose that names fixed files or another prototype is left as written, and fixed files stay put', () => {
  const entry = dist.get('_p/alpha-proto/entry.js')?.toString() ?? '';
  assert.match(entry, /See _p\/all\.js, _gate\/geist\.woff2 and \.\.\/beta-proto\/ for the other one\./);
  assert.ok(dist.has('_p/all.js'));
  assert.ok(dist.has('_gate/geist.woff2'));
  assert.deepEqual([...dist.keys()].filter((n) => /all\.js$|geist\.woff2$/.test(n)).sort(), [
    '_gate/geist.woff2',
    '_p/all.js',
  ]);
  for (const slug of ALL) assert.ok(dist.has(`_p/${slug}/entry.js`), slug);
});

test('a prototype’s font with the hub font’s bytes: its own copy in its folder, and assets/ named for the hub’s', () => {
  const bytes = readFileSync(geist);
  const same = [...dist].filter(([, b]) => b.equals(bytes)).map(([n]) => n);
  assert.ok(
    same.some((n) => /^_p\/secret-one\/acme-rebrand-typeface-[\w-]+\.woff2$/.test(n)),
    same.join(', '),
  );
  assert.ok(
    same.some((n) => /^assets\/geist-latin-wght-normal-[\w-]+\.woff2$/.test(n)),
    same.join(', '),
  );
  assert.deepEqual(
    holding('acme-rebrand').filter((n) => !n.startsWith('_p/secret-one/')),
    [],
  );
  const own = under(FONTED).filter(([n]) => n.endsWith('.css'));
  assert.ok(own.some(([, b]) => /_p\/secret-one\/acme-rebrand-typeface-[\w-]+\.woff2/.test(b.toString())));
});

test('no hub or kit stylesheet sits under _p/ or exists twice', () => {
  const sheets = [...dist].filter(([n]) => n.endsWith('.css'));
  for (const [name, bytes] of sheets.filter(([n]) => n.startsWith('assets/'))) {
    const twins = sheets.filter(([n, b]) => n !== name && b.equals(bytes)).map(([n]) => n);
    assert.deepEqual(twins, [], name);
  }
  assert.deepEqual(
    sheets
      .map(([n]) => n)
      .filter((n) => n.startsWith('_p/') && /\/(ui|dials|Variants|Space|index|Notice|mount)-/.test(n)),
    [],
  );
});

test('the build raises no file-name conflict', () => {
  assert.deepEqual(
    warnings.filter((w) => w.startsWith('FILE_NAME_CONFLICT')),
    [],
  );
});

test('an image copied into prototypes and kit/ is one file each, and each points at its own', () => {
  const where = holding('SHARED-SENTINEL').sort();
  assert.equal(where.length, 3, where.join(', '));
  assert.match(where[0], /^_p\/alpha-proto\/logo-[\w-]+\.png$/);
  assert.match(where[1], /^_p\/beta-proto\/logo-[\w-]+\.png$/);
  assert.match(where[2], /^assets\/logo-[\w-]+\.png$/);
  for (const [i, slug] of SLUGS.entries()) {
    const code = under(slug).filter(([name]) => name.endsWith('.js'));
    assert.ok(
      code.some(([, bytes]) => bytes.includes(where[i])),
      `${slug} points at its copy`,
    );
    assert.ok(!code.some(([, bytes]) => bytes.includes(where[1 - i])), `${slug} never points at another's`);
    assert.ok(!code.some(([, bytes]) => bytes.includes(where[2])), `${slug} never points at the hub's`);
  }
  // The hub's stylesheet, sent to everyone, points at the shared copy.
  const hub = [...dist].filter(([name]) => !name.startsWith('_p/'));
  assert.ok(hub.some(([, bytes]) => bytes.includes(where[2])));
});

test('no file outside _p/ names a slug or refers into _p/<slug>/, and _p/all.js lists them all', () => {
  for (const slug of ALL) {
    const outside = holding(slug).filter((name) => !name.startsWith('_p/'));
    assert.deepEqual(outside, [], slug);
  }
  // The hub names `_p/` itself (it fetches `_p/all.js` and `_p/<slug>/entry.js`), never a prototype's folder.
  for (const slug of ALL)
    assert.deepEqual(
      holding(`_p/${slug}/`).filter((name) => !name.startsWith(`_p/${slug}/`)),
      [],
      slug,
    );
  assert.ok(dist.has('index.html'));
  assert.equal(
    dist.get('_p/all.js')?.toString(),
    `export const slugs = ${JSON.stringify([...ALL].sort())};\n`,
  );
});

// The tables. Each row builds a small project of its own: alpha-proto and
// beta-proto, each with an index, a stylesheet and a lazy module, and beta's
// files to reach for; the row adds or replaces files by path from the project
// root. A function value gets the project root (for absolute paths), and a
// `link` makes a symlink.

type Content = string | Buffer | ((root: string) => string);
type Files = Record<string, Content>;

const tiny = Buffer.concat([Buffer.from('TINY-SENTINEL'), randomBytes(40)]);
const BETA_FILES: Files = {
  'prototypes/beta-proto/plain.css': '.plain-beta { content: "PLAIN-BETA-SENTINEL"; }\n',
  'prototypes/beta-proto/tiny.png': tiny,
  'prototypes/beta-proto/bg.png': image('BG', 'beta-proto'),
  'prototypes/beta-proto/y.module.css': '.b { color: green; }\n',
  'prototypes/beta-proto/small.json': '{"a":1}\n',
  'prototypes/beta-proto/fixtures.json': '{"secret":"BETA-FIXTURE-SENTINEL"}\n',
};
const INDEX =
  "import './styles.css';\nexport default function P() { void import('./heavy.ts').then((m) => console.log(m)); return null; }\n";

function small(): string {
  const root = mkdtempSync(join(tmpdir(), 'hub-row-'));
  const base: Files = {
    'kit/tokens.css': ':root { --t: 1; }\n',
    'kit/card.css': '.card { content: "KIT-CARD-SENTINEL"; }\n',
    ...BETA_FILES,
  };
  for (const slug of SLUGS) {
    base[`prototypes/${slug}/README.md`] = README(slug);
    base[`prototypes/${slug}/index.tsx`] = INDEX;
    base[`prototypes/${slug}/styles.css`] = `.${slug} { color: red; }\n`;
    base[`prototypes/${slug}/heavy.ts`] = 'export const run = 1;\n';
  }
  write(root, base);
  return root;
}

function write(root: string, files: Files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === 'function' ? content(root) : content);
  }
}

/** Builds a small project with a row's files; the build's files by name, or the error it failed with. */
async function buildRow(
  files: Files,
  links: Record<string, string> = {},
  extra: (root: string) => Extra = () => ({}),
  setup: (root: string) => void = () => {},
  teardown: (root: string) => void = () => {},
) {
  const root = small();
  write(root, files);
  for (const [path, target] of Object.entries(links)) symlinkSync(target, join(root, path));
  try {
    setup(root);
    await build(quiet(root, extra(root)));
    const out = join(root, 'dist');
    return { dist: new Map(files_(out).map((f) => [relative(out, f), readFileSync(f)])) };
  } catch (error) {
    return { error: error as Error };
  } finally {
    teardown(root);
    rmSync(root, { recursive: true, force: true });
  }
}
const files_ = files;

const A = 'prototypes/alpha-proto';
const CROSS = /prototypes\/alpha-proto\/\S+ imports prototypes\/beta-proto\/\S+, another prototype's file/;
const KIT =
  /kit\/\S+ imports prototypes\/beta-proto\/\S+, a prototype's file, which the kit and the hub never read/;
const WORKER =
  /prototypes\/(alpha|beta)-proto\/\S+ is in a web worker\. A worker cannot use a prototype's files/;
const withIndex = (extra: string) => INDEX + extra;

/** Reaches that must fail the build, naming reader and source. */
/** An alias into beta's folder, as a project's own vite.config.ts could set one. */
const BETA_ALIAS = (root: string): Extra => ({ alias: { '@beta': join(root, 'prototypes/beta-proto') } });
const SASS =
  /prototypes\/alpha-proto\/\S+ imports prototypes\/alpha-proto\/\S+\.(scss|sass|less|styl|stylus)\b.*Sass, Less and Stylus are refused.*plain CSS or \.pcss/s;
const KIT_SASS =
  /kit\/\S+ imports kit\/\S+\.(scss|sass|less|styl|stylus)\b.*Sass, Less and Stylus are refused/s;

const REFUSED: {
  name: string;
  files: Files;
  links?: Record<string, string>;
  extra?: (root: string) => Extra;
  message: RegExp;
}[] = [
  {
    name: 'a JS import',
    files: { [`${A}/index.tsx`]: `import '../beta-proto/fixtures.json';\n${INDEX}` },
    message: CROSS,
  },
  ...(
    [
      ['@import', "@import '../beta-proto/plain.css';"],
      ['@import with no space', '@import"../beta-proto/plain.css";'],
      ['@import with a comment', "@import /**/ '../beta-proto/plain.css';"],
      ['url()', '.y { background: url("../beta-proto/bg.png"); }'],
      ['url() of a small file', '.y { background: url(../beta-proto/tiny.png); }'],
      ['image-set()', '.y { background-image: image-set("../beta-proto/bg.png" 1x); }'],
    ] as const
  ).map(([what, css]) => ({
    name: `a stylesheet by ${what}`,
    files: { [`${A}/styles.css`]: css },
    message: CROSS,
  })),
  {
    name: 'a nested stylesheet’s @import',
    files: {
      [`${A}/styles.css`]: "@import './sub/more.css';",
      [`${A}/sub/more.css`]: "@import '../../beta-proto/plain.css';",
    },
    message: CROSS,
  },
  {
    name: 'a nested stylesheet’s url()',
    files: {
      [`${A}/styles.css`]: "@import './sub/more.css';",
      [`${A}/sub/more.css`]: '.z { background: url(../../beta-proto/tiny.png); }',
    },
    message: CROSS,
  },
  {
    // CSS escapes: `\/` is `/`, as Vite reads the path before it resolves it.
    name: 'a url() with escaped slashes, in a sheet imported ?inline',
    files: {
      [`${A}/evil.css`]: '.y { background: url(..\\/beta-proto\\/tiny.png?inline); }\n',
      [`${A}/heavy.ts`]: "import css from './evil.css?inline';\nexport const run = css;\n",
    },
    message: CROSS,
  },
  {
    name: 'composes from another prototype',
    files: {
      [`${A}/x.module.css`]: ".a { composes: b from '../beta-proto/y.module.css'; }\n",
      [`${A}/index.tsx`]: withIndex("import x from './x.module.css';\nconsole.log(x);\n"),
    },
    message: CROSS,
  },
  {
    name: 'composes through a module of its own',
    files: {
      [`${A}/x.module.css`]: ".a { composes: m from './mid.module.css'; }\n",
      [`${A}/mid.module.css`]: ".m { composes: b from '../beta-proto/y.module.css'; }\n",
      [`${A}/index.tsx`]: withIndex("import x from './x.module.css';\nconsole.log(x);\n"),
    },
    message: CROSS,
  },
  {
    name: 'a .pcss stylesheet',
    files: {
      [`${A}/more.pcss`]: "@import '../beta-proto/plain.css';\n",
      [`${A}/index.tsx`]: withIndex("import './more.pcss';\n"),
    },
    message: CROSS,
  },
  {
    name: 'an absolute @import',
    files: { [`${A}/styles.css`]: (root) => `@import '${join(root, 'prototypes/beta-proto/plain.css')}';` },
    message: CROSS,
  },
  {
    name: 'an absolute url()',
    files: {
      [`${A}/styles.css`]: (root) =>
        `.y { background: url(${join(root, 'prototypes/beta-proto/tiny.png')}); }`,
    },
    message: CROSS,
  },
  {
    name: 'an @import through a symlink',
    files: { [`${A}/styles.css`]: "@import './link/plain.css';" },
    links: { [`${A}/link`]: '../beta-proto' },
    message: CROSS,
  },
  {
    name: 'a url() through a symlink',
    files: { [`${A}/styles.css`]: '.y { background: url(./link/tiny.png); }' },
    links: { [`${A}/link`]: '../beta-proto' },
    message: CROSS,
  },
  {
    name: 'a new URL through a symlink',
    files: { [`${A}/heavy.ts`]: "export const run = new URL('./link/tiny.png', import.meta.url).href;\n" },
    links: { [`${A}/link`]: '../beta-proto' },
    message: CROSS,
  },
  ...(
    [
      ['new URL', "new URL('../beta-proto/bg.png', import.meta.url)"],
      ['new URL with a space', "new URL ('../beta-proto/bg.png', import.meta.url)"],
      ['new URL with a comment', "new URL(/* c */ '../beta-proto/bg.png', import.meta.url)"],
      ['new URL of a small image', "new URL('../beta-proto/tiny.png', import.meta.url)"],
      ['new URL of a small JSON file', "new URL('../beta-proto/small.json', import.meta.url)"],
      ['new URL of a README', "new URL('../beta-proto/README.md', import.meta.url)"],
    ] as const
  ).map(([what, js]) => ({
    name: `a script by ${what}`,
    files: { [`${A}/heavy.ts`]: `export const run = ${js}.href;\n` },
    message: CROSS,
  })),
  {
    name: 'a kit sheet the hub loads, by @import',
    files: { 'kit/tokens.css': "@import '../prototypes/beta-proto/plain.css';" },
    message: KIT,
  },
  {
    name: 'a kit sheet the hub loads, by url()',
    files: { 'kit/tokens.css': ':root { --x: url(../prototypes/beta-proto/tiny.png); }' },
    message: KIT,
  },
  {
    name: 'a kit sheet a prototype loads',
    files: {
      'kit/reach.css': "@import '../prototypes/beta-proto/plain.css';",
      [`${A}/index.tsx`]: withIndex("import '@kit/reach.css';\n"),
    },
    message: KIT,
  },
  {
    name: 'a worker in a prototype',
    files: {
      [`${A}/w.ts`]: 'self.postMessage(1);\n',
      [`${A}/heavy.ts`]: "export const run = () => new Worker(new URL('./w.ts', import.meta.url));\n",
    },
    message: WORKER,
  },
  {
    name: 'a ?worker in a prototype',
    files: {
      [`${A}/w.ts`]: 'self.postMessage(1);\n',
      [`${A}/heavy.ts`]: "import W from './w.ts?worker';\nexport const run = () => new W();\n",
    },
    message: WORKER,
  },
  {
    name: 'an inline worker reaching another prototype',
    files: {
      [`${A}/wk.ts`]: "import data from '../beta-proto/fixtures.json';\nself.postMessage(data);\n",
      [`${A}/heavy.ts`]: "import W from './wk.ts?worker&inline';\nexport const run = () => new W();\n",
    },
    message: WORKER,
  },
  {
    name: 'a kit worker reaching a prototype',
    files: {
      'kit/wk.ts': "import data from '../prototypes/beta-proto/fixtures.json';\nself.postMessage(data);\n",
      [`${A}/heavy.ts`]: "import W from '@kit/wk.ts?worker';\nexport const run = () => new W();\n",
    },
    message: WORKER,
  },
  // N1: new URL with ?inline: Vite inlines before asking anything.
  ...(['tiny.png', 'small.json', 'README.md', 'bg.png'] as const).map((file) => ({
    name: `a script by new URL of ${file}?inline`,
    files: {
      [`${A}/heavy.ts`]: `export const run = new URL('../beta-proto/${file}?inline', import.meta.url).href;\n`,
    },
    message: CROSS,
  })),
  {
    name: 'kit code the hub imports, by new URL of a README?inline',
    files: {
      'kit/format.ts':
        "export * from '@milesroxas/design-hub/kit/format';\nexport const leak = new URL('../prototypes/beta-proto/README.md?inline', import.meta.url).href;\n",
    },
    message: KIT,
  },
  // N2: a kit worker reaching a prototype's file, every way a worker bundle can.
  ...(
    [
      ['?raw', "import r from '../prototypes/beta-proto/README.md?raw';\nself.postMessage(r);"],
      [
        'a raw glob',
        "const all = import.meta.glob('../prototypes/*/README.md', { query: '?raw', eager: true });\nself.postMessage(Object.keys(all));",
      ],
      ['?inline', "import t from '../prototypes/beta-proto/tiny.png?inline';\nself.postMessage(t);"],
      ['an asset import', "import b from '../prototypes/beta-proto/bg.png';\nself.postMessage(b);"],
      ['?url', "import u from '../prototypes/beta-proto/small.json?url';\nself.postMessage(u);"],
      ['new URL', "self.postMessage(new URL('../prototypes/beta-proto/bg.png', import.meta.url).href);"],
    ] as const
  ).map(([what, code]) => ({
    name: `a kit worker reaching a prototype by ${what}`,
    files: {
      'kit/wk.ts': `${code}\n`,
      [`${A}/heavy.ts`]: "import W from '@kit/wk.ts?worker';\nexport const run = () => new W();\n",
    },
    message: /prototypes\/(alpha|beta)-proto\/\S+ is in a web worker|kit\/wk\.ts imports prototypes\//,
  })),
  // N3: CSS modules' other ways to name another file.
  {
    name: '@value from another prototype',
    files: {
      'prototypes/beta-proto/vals.module.css': '@value secret: red;\n.v { color: secret; }\n',
      [`${A}/x.module.css`]: '@value secret from "../beta-proto/vals.module.css";\n.a { color: secret; }\n',
      [`${A}/index.tsx`]: withIndex("import x from './x.module.css';\nconsole.log(x);\n"),
    },
    message: CROSS,
  },
  {
    name: ':import from another prototype',
    files: {
      'prototypes/beta-proto/vals.module.css': '.v { color: red; }\n',
      [`${A}/x.module.css`]:
        ':import("../beta-proto/vals.module.css") { imported: v; }\n.a { color: red; }\n',
      [`${A}/index.tsx`]: withIndex("import x from './x.module.css';\nconsole.log(x);\n"),
    },
    message: CROSS,
  },
  // N6: nothing under prototypes/ is shared.
  ...(
    [
      [
        'a script directly in prototypes/',
        {
          'prototypes/common.ts': 'export const c = 1;\n',
          [`${A}/heavy.ts`]: "import { c } from '../common.ts';\nexport const run = c;\n",
        },
      ],
      [
        'a stylesheet directly in prototypes/',
        {
          'prototypes/common.css': '.c { color: red; }\n',
          [`${A}/styles.css`]: "@import '../common.css';\n",
        },
      ],
      [
        'a folder in prototypes/ that is no prototype',
        {
          'prototypes/shared/x.ts': 'export const x = 1;\n',
          [`${A}/heavy.ts`]: "import { x } from '../shared/x.ts';\nexport const run = x;\n",
        },
      ],
    ] as const
  ).map(([what, files]) => ({
    name: `importing ${what}`,
    files: files as Files,
    message: /in no prototype's folder.*shared code belongs in kit\//s,
  })),
  // N8: a stylesheet the build cannot read fails, saying where.
  {
    name: 'a stylesheet that does not parse',
    files: { [`${A}/styles.css`]: '.a { color: red;\n' },
    message: /prototypes\/alpha-proto\/styles\.css:1:\d+.*does not parse.*fix the stylesheet/is,
  },
  // A: a quote in a regex literal or in JSX text must not hide a new URL.
  {
    name: 'a new URL after a regex literal with a quote',
    files: {
      [`${A}/heavy.ts`]:
        "const q = /\"/g;\nexport const run = [q, new URL('../beta-proto/tiny.png?inline', import.meta.url).href];\n",
    },
    message: CROSS,
  },
  {
    name: 'a new URL between JSX text with apostrophes',
    files: {
      [`${A}/index.tsx`]:
        "import './styles.css';\nexport default function P() {\n  return (\n    <div>\n      <p>Don't panic</p>\n      {new URL('../beta-proto/README.md?inline', import.meta.url).href}\n      <p>It's fine</p>\n    </div>\n  );\n}\n",
    },
    message: CROSS,
  },
  {
    name: 'kit code the hub imports, a new URL after a regex literal',
    files: {
      'kit/format.ts':
        "export * from '@milesroxas/design-hub/kit/format';\nconst q = /\"/g;\nexport const leak = [q, new URL('../prototypes/beta-proto/README.md?inline', import.meta.url).href];\n",
    },
    message: KIT,
  },
  {
    name: 'a kit worker, a new URL after a regex literal',
    files: {
      'kit/wk.ts':
        "const q = /\"/g;\nself.postMessage([String(q), new URL('../prototypes/beta-proto/bg.png', import.meta.url).href]);\n",
      [`${A}/heavy.ts`]: "import W from '@kit/wk.ts?worker';\nexport const run = () => new W();\n",
    },
    message: /prototypes\/(alpha|beta)-proto\/\S+ is in a web worker/,
  },
  {
    name: 'a kit worker, a new URL inlined after a regex literal',
    files: {
      'kit/wk.ts':
        "const q = /\"/g;\nself.postMessage([String(q), new URL('../prototypes/beta-proto/tiny.png?inline', import.meta.url).href]);\n",
      [`${A}/heavy.ts`]: "import W from '@kit/wk.ts?worker';\nexport const run = () => new W();\n",
    },
    message: /prototypes\/(alpha|beta)-proto\/\S+ is in a web worker/,
  },
  {
    name: 'a new URL in a package inside a prototype’s own folder',
    files: {
      [`${A}/node_modules/vendor/u.js`]:
        "export const u = new URL('../../../beta-proto/tiny.png?inline', import.meta.url).href;\n",
      [`${A}/heavy.ts`]: "import { u } from './node_modules/vendor/u.js';\nexport const run = u;\n",
    },
    message: CROSS,
  },
  // A CSS reference through an alias or a package path, which only Vite's own resolvers (handed to the
  // stylesheet check) follow. An @import, composes, @value or :import through an alias is not here: Vite
  // inlines the @import and loads the module through the plugins, where the other checks refuse it first.
  ...(
    [
      ['url()', '.y { background: url(@beta/tiny.png); }'],
      ['image-set()', '.y { background-image: image-set("@beta/bg.png" 1x); }'],
    ] as const
  ).map(([what, css]) => ({
    name: `a stylesheet by ${what} through an alias`,
    files: { [`${A}/styles.css`]: css },
    extra: BETA_ALIAS,
    message: CROSS,
  })),
  {
    name: 'a url() by a package path that lands in another prototype',
    files: {
      'prototypes/beta-proto/pkg/package.json': '{"name":"beta-pkg","version":"1.0.0"}\n',
      'prototypes/beta-proto/pkg/tiny.png': tiny,
      'node_modules/.keep': '',
      [`${A}/styles.css`]: '.y { background: url(beta-pkg/tiny.png); }',
    },
    links: { 'node_modules/beta-pkg': '../prototypes/beta-proto/pkg' },
    message: CROSS,
  },
  {
    name: 'composes by a package path that lands in another prototype',
    files: {
      'prototypes/beta-proto/pkg/package.json': '{"name":"beta-pkg","version":"1.0.0"}\n',
      'prototypes/beta-proto/pkg/y.module.css': '.b { color: green; }\n',
      'node_modules/.keep': '',
      [`${A}/x.module.css`]: ".a { composes: b from 'beta-pkg/y.module.css'; }\n",
      [`${A}/index.tsx`]: withIndex("import x from './x.module.css';\nconsole.log(x);\n"),
    },
    links: { 'node_modules/beta-pkg': '../prototypes/beta-proto/pkg' },
    message: CROSS,
  },
  // Item 3: Sass, Less and Stylus resolve their own imports where no check sees them.
  ...(['scss', 'sass', 'less', 'styl', 'stylus'] as const).map((ext) => ({
    name: `a .${ext} stylesheet in a prototype`,
    files: {
      [`${A}/x.${ext}`]: '.x { color: red; }\n',
      [`${A}/index.tsx`]: withIndex(`import './x.${ext}';\n`),
    },
    message: SASS,
  })),
  {
    name: 'a .scss stylesheet a prototype’s plain CSS imports',
    files: { [`${A}/x.scss`]: '.x { color: red; }\n', [`${A}/styles.css`]: "@import './x.scss';\n" },
    message: SASS,
  },
  {
    name: 'a .less stylesheet in the project’s kit/',
    files: {
      'kit/panel.less': '.panel { color: red; }\n',
      'kit/Panel.ts': "import './panel.less';\nexport const panel = 1;\n",
      [`${A}/index.tsx`]: withIndex("import { panel } from '@kit/Panel';\nconsole.log(panel);\n"),
    },
    message: KIT_SASS,
  },
  {
    name: 'a .scss stylesheet a prototype’s plain CSS imports, the CSS imported with a query',
    files: {
      [`${A}/x.scss`]: '.x { color: red; }\n',
      [`${A}/q.css`]: "@import './x.scss';\n",
      [`${A}/index.tsx`]: withIndex("import './q.css?theme=dark';\n"),
    },
    message: SASS,
  },
];

for (const row of REFUSED)
  test(`refused: ${row.name}`, async () => {
    const { error } = await buildRow(row.files, row.links, row.extra);
    assert.ok(error, 'the build failed');
    assert.match(error.message, row.message);
  });

/** Whether this disk folds letter case: `Prototypes/` and `prototypes/` are then one folder. */
const foldsCase = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-case-'));
  try {
    writeFileSync(join(dir, 'a'), '');
    return existsSync(join(dir, 'A'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();

/** Reaches spelled with another letter case: one file on a disk that folds case, so the same reach. */
const RECASED: { name: string; files: Files; message: RegExp }[] = [
  {
    name: 'a JS import of a stylesheet',
    files: { [`${A}/heavy.ts`]: "import '../../Prototypes/beta-proto/plain.css';\nexport const run = 1;\n" },
    message: new RegExp(CROSS.source, 'i'),
  },
  {
    name: 'an asset import',
    files: {
      [`${A}/heavy.ts`]: "import bg from '../../Prototypes/beta-proto/bg.png';\nexport const run = bg;\n",
    },
    message: new RegExp(CROSS.source, 'i'),
  },
  {
    name: 'a CSS url()',
    files: { [`${A}/styles.css`]: '.y { background: url(../../Prototypes/beta-proto/bg.png); }\n' },
    message: new RegExp(CROSS.source, 'i'),
  },
  {
    name: 'a kit file’s ?raw import',
    files: {
      'kit/notes.ts': "export { default } from '../Prototypes/beta-proto/fixtures.json?raw';\n",
      [`${A}/heavy.ts`]: "import notes from '@kit/notes';\nexport const run = notes;\n",
    },
    message: new RegExp(KIT.source, 'i'),
  },
];

for (const row of RECASED)
  test(`refused, spelled in another case: ${row.name}`, {
    skip: foldsCase
      ? false
      : 'This disk tells letter case apart: Prototypes/ is not prototypes/, so there is no reach',
  }, async () => {
    const { error } = await buildRow(row.files);
    assert.ok(error, 'the build failed');
    assert.match(error.message, row.message);
  });

/**
 * A test-only plugin that gets round every input check: it loads a
 * prototype's file through Vite's own pipeline (`this.load`, so Vite itself
 * writes the form: a data URI, a `?raw` string, minified CSS) and pastes what
 * Vite made into the hub's entry as a string. Nothing imports the file, so no
 * resolver, no transform check, no stylesheet check and no chunk check sees
 * it: only the output-side check can.
 */
const inliner =
  (target: string, wrap?: (s: string) => string) =>
  (root: string): Extra => ({
    plugins: [
      {
        name: 'test-inliner',
        async transform(code, id) {
          if (!id.endsWith('/shell/main.tsx')) return null;
          const made = (await this.load({ id: join(root, target) })).code ?? '';
          const literal = made.match(/export default ([\s\S]+?);?\s*$/)?.[1];
          assert.ok(literal, `Vite made a string of ${target}: ${made.slice(0, 200)}`);
          return `${code}\nglobalThis.__leak = ${wrap ? JSON.stringify(wrap(JSON.parse(literal))) : literal};\n`;
        },
      },
    ],
  });

const B = 'prototypes/beta-proto';
/** What only the output-side check sees: beta's content written into the hub's bundle, in each form Vite writes. */
const LEAKS: {
  name: string;
  files: Files;
  target: string;
  wrap?: (s: string) => string;
  message: RegExp;
}[] = [
  {
    name: 'an image as a base64 data URI',
    files: {},
    target: `${B}/bg.png?inline`,
    message: /assets\/\S+\.js holds prototypes\/beta-proto\/bg\.png as a base64 data URI/,
  },
  {
    // As Vite writes `?inline` CSS: the data URI is part of a longer string.
    name: 'an image as a base64 data URI inside a longer string',
    files: {},
    target: `${B}/bg.png?inline`,
    wrap: (uri) => `.y{background:url(${uri})}`,
    message: /assets\/\S+\.js holds prototypes\/beta-proto\/bg\.png as a base64 data URI/,
  },
  {
    name: 'an SVG as a URL-encoded data URI',
    files: {
      [`${B}/mark.svg`]:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <desc>MARK-SENTINEL of the beta codename</desc>\n  <path d="M0 0h10v10H0z" fill="#123456"/>\n</svg>\n',
    },
    target: `${B}/mark.svg?inline`,
    message: /assets\/\S+\.js holds prototypes\/beta-proto\/mark\.svg as a URL-encoded SVG data URI/,
  },
  {
    name: 'a text file as a ?raw string',
    files: {
      [`${B}/notes.md`]:
        // Every quote, so no string literal holds it unescaped: only a parsed string matches.
        '# Notes\n\nNOTES-SENTINEL: the "beta" launch, the `codename` and it\'s what nobody outside may read.\n',
    },
    target: `${B}/notes.md?raw`,
    message: /assets\/\S+\.js holds prototypes\/beta-proto\/notes\.md as a string/,
  },
];

for (const row of LEAKS)
  test(`refused at the output: ${row.name}`, async () => {
    const { error } = await buildRow(row.files, {}, inliner(row.target, row.wrap));
    assert.ok(error, 'the build failed');
    assert.match(error.message, row.message);
  });

const sheets = (dist: Map<string, Buffer>) => [...dist].filter(([n]) => n.endsWith('.css'));
const holdingIn = (dist: Map<string, Buffer>, text: string) =>
  [...dist].filter(([, b]) => b.includes(text)).map(([n]) => n);
const onlyUnder = (dist: Map<string, Buffer>, text: string, folder: string) => {
  const where = holdingIn(dist, text);
  assert.ok(where.length > 0, `${text} is in the build`);
  for (const n of where) assert.ok(n.startsWith(folder), `${text} in ${n}`);
};
const half = Buffer.concat([Buffer.from('HALF-SENTINEL'), randomBytes(6 * 1024)]);
const SVG_HEAD =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const BLOCK = 'display: flex; align-items: center; justify-content: space-between;';

/** Honest shapes that must build, each with what must hold of the result. */
const BUILDS: {
  name: string;
  files: Files;
  extra?: (root: string) => Extra;
  setup?: (root: string) => void;
  teardown?: (root: string) => void;
  check: (dist: Map<string, Buffer>) => void;
}[] = [
  {
    name: 'a url() through an alias into the kit',
    files: {
      'kit/brand/mark.png': image('MARK', 'kit'),
      [`${A}/styles.css`]: '.m { background: url(@brand/mark.png); }\n',
    },
    extra: (root) => ({ alias: { '@brand': join(root, 'kit/brand') } }),
    check: (dist) => {
      onlyUnder(dist, sentinel('MARK', 'kit'), 'assets/');
      const own = sheets(dist).filter(([n]) => n.startsWith('_p/alpha-proto/'));
      assert.ok(
        own.some(([, b]) => /assets\/mark-[\w-]+\.png/.test(b.toString())),
        'the sheet points at it',
      );
    },
  },
  {
    name: 'a kit worker that imports @kit/format',
    files: {
      'kit/wk.ts':
        "import { plural } from '@kit/format';\nself.postMessage(plural(2, 'KIT-FORMAT-WORKER'));\n",
      [`${A}/heavy.ts`]: "import W from '@kit/wk.ts?worker';\nexport const run = () => new W();\n",
    },
    check: (dist) => {
      const worker = [...dist].filter(([, b]) => b.includes('KIT-FORMAT-WORKER'));
      assert.equal(worker.length, 1, 'one worker file');
      const [name, bytes] = worker[0];
      assert.ok(name.startsWith('assets/'), name);
      // An import Rolldown could not resolve stays external: a bare `@kit/…` in ES output, a
      // `_kit_<name>` global the IIFE worker expects in its default format.
      assert.doesNotMatch(bytes.toString(), /["'`]@kit\/|@milesroxas\/design-hub\/kit\/|\b_kit_\w+/);
    },
  },
  {
    name: 'a sheet the entry and a lazy module both import',
    files: {
      [`${A}/shared.css`]: '.s { content: "SHARED-SHEET-SENTINEL"; }\n',
      [`${A}/index.tsx`]: withIndex("import './shared.css';\n"),
      [`${A}/heavy.ts`]: "import './shared.css';\nexport const run = 1;\n",
    },
    check: (dist) => onlyUnder(dist, 'SHARED-SHEET-SENTINEL', '_p/alpha-proto/'),
  },
  {
    name: 'two lazy modules sharing one sheet, with an image over 4 KB',
    files: {
      [`${A}/lazy.css`]: '.l { content: "LAZY-SHEET-SENTINEL"; background: url(./big.png); }\n',
      [`${A}/big.png`]: image('BIG', 'alpha-proto'),
      [`${A}/heavy.ts`]: "import './lazy.css';\nexport const run = 1;\n",
      [`${A}/other.ts`]: "import './lazy.css';\nexport const run = 2;\n",
      [`${A}/index.tsx`]:
        "import './styles.css';\nexport default function P() { void import('./heavy.ts'); void import('./other.ts'); return null; }\n",
    },
    check: (dist) => {
      onlyUnder(dist, 'LAZY-SHEET-SENTINEL', '_p/alpha-proto/');
      onlyUnder(dist, sentinel('BIG', 'alpha-proto'), '_p/alpha-proto/');
    },
  },
  {
    name: 'a prototype importing the kit’s and the hub’s own sheets',
    files: { [`${A}/index.tsx`]: withIndex("import '@kit/tokens.css';\nimport '@kit/ui/ui.css';\n") },
    check: (dist) => {
      assert.deepEqual(holdingIn(dist, '--t:').filter((n) => n.endsWith('.css')).length, 1);
      for (const [name, bytes] of sheets(dist).filter(([n]) => n.startsWith('_p/')))
        assert.ok(
          !sheets(dist).some(([n, b]) => n !== name && n.startsWith('assets/') && b.equals(bytes)),
          name,
        );
      assert.deepEqual(
        holdingIn(dist, '--t:').filter((n) => n.startsWith('_p/')),
        [],
      );
    },
  },
  {
    name: 'a kit sheet one prototype imports',
    files: { [`${A}/index.tsx`]: withIndex("import '@kit/card.css';\n") },
    check: (dist) =>
      assert.deepEqual(
        holdingIn(dist, 'KIT-CARD-SENTINEL').map((n) => n.split('/')[0]),
        ['assets'],
      ),
  },
  {
    name: 'a kit sheet two prototypes import',
    files: {
      [`${A}/index.tsx`]: withIndex("import '@kit/card.css';\n"),
      'prototypes/beta-proto/index.tsx': withIndex("import '@kit/card.css';\n"),
    },
    check: (dist) =>
      assert.deepEqual(
        holdingIn(dist, 'KIT-CARD-SENTINEL').map((n) => n.split('/')[0]),
        ['assets'],
      ),
  },
  {
    name: 'a kit sheet two prototypes import, and a prototype’s lazy sheet with the same bytes',
    files: {
      [`${A}/index.tsx`]: withIndex("import '@kit/card.css';\n"),
      'prototypes/beta-proto/index.tsx': withIndex(
        "import '@kit/card.css';\nvoid import('./nightfall-codename.ts');\n",
      ),
      'prototypes/beta-proto/nightfall-codename.ts': "import './night.css';\nexport const n = 1;\n",
      'prototypes/beta-proto/night.css': '.card { content: "KIT-CARD-SENTINEL"; }\n',
    },
    check: (dist) => {
      assert.deepEqual(
        [...dist.keys()].filter((n) => n.includes('nightfall') && !n.startsWith('_p/beta-proto/')),
        [],
      );
      assert.deepEqual(
        holdingIn(dist, 'nightfall').filter((n) => !n.startsWith('_p/beta-proto/')),
        [],
      );
      assert.equal(holdingIn(dist, 'KIT-CARD-SENTINEL').filter((n) => n.startsWith('assets/')).length, 1);
    },
  },
  {
    name: 'a sheet imported as ?url and as ?raw',
    files: {
      [`${A}/dark.css`]: '.d { color: black; }\n',
      [`${A}/index.tsx`]: withIndex(
        "import dark from './dark.css?url';\nimport raw from './dark.css?raw';\nconsole.log(dark, raw);\n",
      ),
    },
    check: () => {},
  },
  {
    name: 'a content string naming another prototype’s folder',
    files: { [`${A}/styles.css`]: '.y::after { content: "../beta-proto/readme"; }\n' },
    check: () => {},
  },
  {
    name: 'a kit worker that touches no prototype, used by one prototype',
    files: {
      'kit/wk.ts': 'self.postMessage("KIT-WORKER-SENTINEL");\n',
      [`${A}/heavy.ts`]: "import W from '@kit/wk.ts?worker';\nexport const run = () => new W();\n",
    },
    check: (dist) => onlyUnder(dist, 'KIT-WORKER-SENTINEL', 'assets/'),
  },
  {
    name: 'file names a URL would trip on, one also in the kit',
    files: {
      [`${A}/half50%.png`]: half,
      [`${A}/a&b.png`]: image('AMP', 'alpha-proto'),
      [`${A}/c[1].png`]: image('BRACKET', 'alpha-proto'),
      [`${A}/d;e.png`]: image('SEMI', 'alpha-proto'),
      [`${A}/f,g.png`]: image('COMMA', 'alpha-proto'),
      [`${A}/h=i.png`]: image('EQ', 'alpha-proto'),
      [`${A}/styles.css`]:
        '.a { background: url("./half50%25.png"), url("./a&b.png"), url("./c[1].png"), url("./d;e.png"), url("./f,g.png"), url("./h=i.png"); }\n',
      'kit/half.png': half,
      'kit/tokens.css': ':root { --half: url(./half.png); }\n',
    },
    check: (dist) => {
      assert.deepEqual(
        [...dist.keys()].filter((n) => /[%&[\];,=]/.test(n)),
        [],
      );
      assert.equal(holdingIn(dist, 'HALF-SENTINEL').length, 2);
    },
  },
  {
    name: 'a prototype’s small SVG in its stylesheet is a file of its own',
    files: {
      [`${A}/icon.svg`]: '<svg xmlns="http://www.w3.org/2000/svg"><title>ICON-SENTINEL</title></svg>',
      [`${A}/styles.css`]: '.i { background: url(./icon.svg); }\n',
    },
    check: (dist) => {
      onlyUnder(dist, 'ICON-SENTINEL', '_p/alpha-proto/');
      assert.deepEqual(
        holdingIn(dist, 'data:image/svg').filter((n) => n.startsWith('_p/')),
        [],
      );
    },
  },
  // N1: what only looks like a reach.
  {
    name: 'a comment and a string that look like a new URL, and one of its own ?inline',
    files: {
      [`${A}/own.png`]: tiny,
      [`${A}/heavy.ts`]: [
        "// new URL('../beta-proto/tiny.png?inline', import.meta.url)",
        "/* new URL('../beta-proto/bg.png', import.meta.url) */",
        `export const s = "new URL('../beta-proto/tiny.png?inline', import.meta.url)";`,
        "export const run = new URL('./own.png?inline', import.meta.url).href;",
        '',
      ].join('\n'),
    },
    check: (dist) => assert.deepEqual(holdingIn(dist, 'TINY-SENTINEL').length, 0),
  },
  // N4: queries that only look like ?inline, ?raw or ?url.
  {
    name: 'a sheet imported with queries that only look like inline, raw or url',
    files: {
      [`${A}/lazy.css`]: '.l { content: "QUERY-SHEET-SENTINEL"; }\n',
      [`${A}/heavy.ts`]:
        "import './lazy.css?no-inline';\nimport './lazy.css?theme=raw';\nimport './lazy.css?from=inline-styles';\nexport const run = 1;\n",
    },
    check: (dist) => onlyUnder(dist, 'QUERY-SHEET-SENTINEL', '_p/alpha-proto/'),
  },
  // N5: the same bytes in two prototypes, each copy named for its own owner's file.
  {
    name: 'an image and a lazy sheet with the same bytes in two prototypes',
    files: {
      [`${A}/nightfall-codename.png`]: half,
      'prototypes/beta-proto/hero.png': half,
      [`${A}/alpha-look.css`]: '.same { background: red; }\n',
      'prototypes/beta-proto/beta-look.css': '.same { background: red; }\n',
      [`${A}/heavy.ts`]:
        "import './alpha-look.css';\nimport u from './nightfall-codename.png';\nexport const run = u;\n",
      'prototypes/beta-proto/heavy.ts':
        "import './beta-look.css';\nimport u from './hero.png';\nexport const run = u;\n",
    },
    check: (dist) => {
      const names = [...dist.keys()];
      assert.deepEqual(
        names.filter((n) => n.startsWith('_p/alpha-proto/') && /hero|beta-look|beta-proto/.test(n)),
        [],
      );
      assert.deepEqual(
        names.filter((n) => n.startsWith('_p/beta-proto/') && /nightfall|alpha-look|alpha-proto/.test(n)),
        [],
      );
      assert.equal(holdingIn(dist, 'HALF-SENTINEL').length, 2);
    },
  },
  // N6: a folder with only a README is a prototype.
  {
    name: 'a prototype folder with only a README',
    files: { 'prototypes/gamma-proto/README.md': README('gamma-proto') },
    check: (dist) => assert.ok(dist.has('_p/gamma-proto/entry.js')),
  },
  // N10: a prototype's lazy module whose only CSS is the kit's.
  {
    name: 'a lazy prototype module whose only CSS is a kit component’s',
    files: {
      'kit/Panel.ts': "import './panel.css';\nexport const panel = 1;\n",
      'kit/panel.css': '.panel { content: "KIT-PANEL-SENTINEL"; }\n',
      [`${A}/nightfall-launch.ts`]: "import { panel } from '@kit/Panel';\nexport const n = panel;\n",
      [`${A}/heavy.ts`]: "export const run = () => import('./nightfall-launch.ts');\n",
    },
    check: (dist) => {
      assert.deepEqual(
        [...dist.keys()].filter((n) => n.startsWith('assets/') && /nightfall|alpha-proto/.test(n)),
        [],
      );
      assert.ok(holdingIn(dist, 'KIT-PANEL-SENTINEL').length > 0);
    },
  },
  // N11: two kit sheets with one base name stay two sheets.
  {
    name: 'two kit sheets with one base name',
    files: {
      'kit/card.css': '.c1 { content: "CARD-ONE-SENTINEL"; }\n',
      'kit/sub/card.css': '.c2 { content: "CARD-TWO-SENTINEL"; }\n',
      [`${A}/index.tsx`]: withIndex("import '@kit/card.css';\nimport '@kit/sub/card.css';\n"),
    },
    check: (dist) => {
      const one = holdingIn(dist, 'CARD-ONE-SENTINEL');
      const two = holdingIn(dist, 'CARD-TWO-SENTINEL');
      assert.equal(one.length, 1);
      assert.equal(two.length, 1);
      assert.notEqual(one[0], two[0]);
      assert.ok(one[0].startsWith('assets/') && two[0].startsWith('assets/'));
    },
  },
  // C: whatever a prototype imports from a kit sheet in dev, it gets in a build.
  ...(
    [
      [
        'a default import of a kit CSS module',
        "import chip from '@kit/chip.module.css';\nexport const cls = chip.chip;\n",
      ],
      [
        'a named import of a kit CSS module',
        "import { chip } from '@kit/chip.module.css';\nexport const cls = chip;\n",
      ],
      [
        'a kit CSS module by relative path',
        "import chip from '../../kit/chip.module.css';\nexport const cls = chip.chip;\n",
      ],
    ] as const
  ).map(([what, code]) => ({
    name: what,
    files: {
      'kit/chip.module.css': '.chip { content: "CHIP-SENTINEL"; }\n',
      [`${A}/index.tsx`]: `${code}export default function P() { return cls; }\n`,
    },
    check: (dist: Map<string, Buffer>) => {
      const css = sheets(dist).find(([, b]) => b.includes('CHIP-SENTINEL'));
      assert.ok(css, 'the kit module’s sheet is in the build');
      const cls = css[1].toString().match(/\.(_chip_[\w-]+)/)?.[1];
      assert.ok(cls, 'a hashed class name');
      assert.ok(
        [...dist].some(([n, b]) => n.endsWith('.js') && b.includes(cls)),
        `${cls} is what the prototype renders with`,
      );
    },
  })),
  {
    name: 'a kit sheet as ?inline, ?url and ?raw',
    files: {
      [`${A}/index.tsx`]: withIndex(
        "import i from '@kit/card.css?inline';\nimport u from '@kit/card.css?url';\nimport r from '@kit/card.css?raw';\nconsole.log(i, u, r);\n",
      ),
    },
    check: (dist) => assert.ok(holdingIn(dist, 'KIT-CARD-SENTINEL').length > 0),
  },
  {
    name: 'a regex literal and JSX text with quotes, and a new URL of its own',
    files: {
      [`${A}/own.png`]: tiny,
      [`${A}/index.tsx`]:
        "import './styles.css';\nconst q = /\"/g;\nexport default function P() {\n  return <p>Don't panic {String(q)} {new URL('./own.png', import.meta.url).href} it's fine</p>;\n}\n",
    },
    check: (dist) => onlyUnder(dist, 'TINY-SENTINEL', '_p/alpha-proto/'),
  },
  // The output check looks for whole files only: what two honest prototypes share in part builds.
  {
    name: 'a product app and a website app, fresh from design-hub new',
    files: {
      ...fromProject('kit'),
      ...fromTemplate('billing', 'product', true),
      ...fromTemplate('landing', 'website', true),
    },
    check: (dist) => {
      assert.ok(dist.has('_p/billing/entry.js') && dist.has('_p/landing/entry.js'));
    },
  },
  {
    name: 'the brand sample and a brand prototype fresh from design-hub new',
    files: {
      ...fromProject('kit'),
      ...fromProject('prototypes/sample-social'),
      ...fromTemplate('launch-post', 'brand'),
    },
    check: (dist) => {
      assert.ok(dist.has('_p/sample-social/entry.js') && dist.has('_p/launch-post/entry.js'));
    },
  },
  {
    name: 'a README line another README extends, and uses as UI copy',
    files: {
      [`${A}/README.md`]: README('alpha-proto', '- Dial `density` switches compact and roomy rows'),
      [`${B}/README.md`]: README(
        'beta-proto',
        '- Dial `density` switches compact and roomy rows; roomy is the default',
      ),
      [`${B}/index.tsx`]:
        "import './styles.css';\nexport default function P() { return <h1>- Dial `density` switches compact and roomy rows</h1>; }\n",
    },
    check: () => {},
  },
  {
    name: 'an SVG file in one prototype, the same markup as a string in another',
    files: {
      [`${A}/check.svg`]: `${SVG_HEAD}\n  <path d="M20 6 9 17l-5-5"/>\n</svg>\n`,
      [`${A}/index.tsx`]: `import u from './check.svg';\n${INDEX}console.log(u);\n`,
      [`${B}/index.tsx`]: `${INDEX}export const icon = ${JSON.stringify(`${SVG_HEAD}<path d="M18 6 6 18"/></svg>`)};\nconsole.log(icon);\n`,
    },
    check: () => {},
  },
  {
    name: 'a flat rule in one prototype, the same declarations nested in another',
    files: {
      [`${A}/styles.css`]: `.bar { ${BLOCK} }\n`,
      [`${B}/styles.css`]: `.row { ${BLOCK} &:hover { color: red; } }\n`,
    },
    check: () => {},
  },
  {
    name: 'a file nobody may read beside a prototype',
    files: { [`${A}/reference/locked.pdf`]: Buffer.alloc(500, 7) },
    setup: (root) => chmodSync(join(root, A, 'reference/locked.pdf'), 0o000),
    check: () => {},
  },
  {
    name: 'a 3 GB recording beside a prototype, imported by nothing',
    files: { [`${A}/reference/.keep`]: '' },
    setup: (root) => {
      // Sparse: the disk holds none of it, but its size is 3 GB.
      const fd = openSync(join(root, A, 'reference/recording.mov'), 'w');
      ftruncateSync(fd, 3 * 1024 ** 3);
      closeSync(fd);
    },
    check: () => {},
  },
  {
    name: 'a folder nobody may list beside a prototype, imported by nothing',
    files: { [`${A}/reference/private/notes.txt`]: 'x'.repeat(100) },
    setup: (root) => chmodSync(join(root, A, 'reference/private'), 0o000),
    teardown: (root) => chmodSync(join(root, A, 'reference/private'), 0o755),
    check: () => {},
  },
  {
    name: 'a text file nothing imports in one prototype, the same sentence as JSX text in another',
    files: {
      [`${A}/tagline.txt`]: 'Send invoices your customers actually pay on time.',
      [`${B}/index.tsx`]:
        "import './styles.css';\nexport default function P() { return <h1>Send invoices your customers actually pay on time.</h1>; }\n",
    },
    check: (dist) => assert.ok(holdingIn(dist, 'actually pay on time').length > 0),
  },
  {
    // A kit shared by several projects: its files resolve the project's dependencies from the project.
    name: 'kit/ a symlink to a folder outside the project, its file importing a project dependency',
    files: {
      'kit/Pulse.tsx':
        "import { motion } from 'motion/react';\nexport const Pulse = () => <motion.b>KIT-PULSE-SENTINEL</motion.b>;\n",
      [`${A}/index.tsx`]:
        "import './styles.css';\nimport card from '@kit/card.css?url';\nimport { Pulse } from '@kit/Pulse';\nexport default function P() { console.log(card); return <Pulse />; }\n",
    },
    setup: (root) => {
      cpSync(join(root, 'kit'), `${root}-kit`, { recursive: true });
      rmSync(join(root, 'kit'), { recursive: true });
      symlinkSync(`${root}-kit`, join(root, 'kit'));
      mkdirSync(join(root, 'node_modules'));
      symlinkSync(join(PACKAGE, 'node_modules', 'motion'), join(root, 'node_modules', 'motion'));
    },
    teardown: (root) => rmSync(`${root}-kit`, { recursive: true, force: true }),
    check: (dist) => {
      assert.ok(holdingIn(dist, 'KIT-PULSE-SENTINEL').length > 0);
      // Resolved and bundled: an import Rolldown could not resolve stays a bare `motion/react`.
      assert.deepEqual(holdingIn(dist, '"motion/react"'), []);
      onlyUnder(dist, 'KIT-CARD-SENTINEL', 'assets/');
    },
  },
  // A preprocessor file read as text is never compiled: nothing it imports is resolved.
  {
    name: 'a .scss file imported ?raw',
    files: {
      [`${A}/demo.scss`]: '// SCSS-RAW-SENTINEL\n@use "sass:math";\n.x { width: math.div(1, 2); }\n',
      [`${A}/heavy.ts`]: "import src from './demo.scss?raw';\nexport const run = src;\n",
    },
    check: (dist) => onlyUnder(dist, 'SCSS-RAW-SENTINEL', '_p/alpha-proto/'),
  },
];

for (const row of BUILDS)
  test(`builds: ${row.name}`, async () => {
    const { dist, error } = await buildRow(row.files, {}, row.extra, row.setup, row.teardown);
    assert.ifError(error);
    assert.ok(dist);
    row.check(dist);
  });

/** The stylesheets index.html links, in order. */
const linked = (dist: Map<string, Buffer>) =>
  [...(dist.get('index.html')?.toString() ?? '').matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map(
    (m) => m[1],
  );

test('a prototype importing a kit sheet the hub loads changes nothing the hub links', async () => {
  const plain = await buildRow({});
  const importing = await buildRow({ [`${A}/index.tsx`]: withIndex("import '@kit/tokens.css';\n") });
  assert.ifError(plain.error);
  assert.ifError(importing.error);
  assert.ok(plain.dist && importing.dist);
  assert.ok(linked(plain.dist).length > 0);
  assert.deepEqual(linked(importing.dist), linked(plain.dist));
  const hubSheets = (dist: Map<string, Buffer>) =>
    [...dist.keys()].filter((n) => n.startsWith('assets/') && n.endsWith('.css')).sort();
  assert.deepEqual(hubSheets(importing.dist), hubSheets(plain.dist));
});

test('the build raises no warning about how it splits code', () => {
  assert.deepEqual(
    warnings.filter((w) => /debugName|groups\[\d+\]\.name/.test(w)),
    [],
  );
});

/** The stylesheets one prototype's entry preloads, in the order the page loads them. */
const sheetOrder = (dist: Map<string, Buffer>, slug: string) => {
  const code = dist.get(`_p/${slug}/entry.js`)?.toString() ?? '';
  const list = code.match(/m\.f=\[([^\]]*)\]/)?.[1] ?? '';
  return [...list.matchAll(/"([^"]+\.css)"/g)].map((m) => dist.get(m[1])?.toString() ?? m[1]);
};

test('a prototype’s own sheet loads after the kit sheet it imports, with one importer as with two', async () => {
  const kit = { 'kit/card.css': '.card { color: red; }\n' };
  const own = (slug: string, colour: string) => ({
    // The kit sheet first, then the prototype's own, as a prototype that overrides it writes it.
    [`prototypes/${slug}/index.tsx`]: `import '@kit/card.css';\n${INDEX}`,
    [`prototypes/${slug}/styles.css`]: `.card { color: ${colour}; }\n`,
  });
  const one = await buildRow({ ...kit, ...own('alpha-proto', 'blue') });
  const two = await buildRow({ ...kit, ...own('alpha-proto', 'blue'), ...own('beta-proto', 'green') });
  for (const [what, built] of [
    ['one importer', one],
    ['two importers', two],
  ] as const) {
    assert.ifError(built.error);
    const order = sheetOrder(built.dist!, 'alpha-proto');
    const kitAt = order.findIndex((t) => /color:\s*red/.test(t));
    const ownAt = order.findIndex((t) => /color:\s*#?(blue|00f)/.test(t));
    assert.ok(kitAt >= 0 && ownAt >= 0, `${what}: both sheets preloaded`);
    assert.ok(kitAt < ownAt, `${what}: the kit sheet loads first: ${JSON.stringify(order)}`);
  }
});

/** A built name without its hash: Rolldown's own output is not byte for byte the same from one build to the next. */
const unhashed = (name: string) => name.replace(/-[\w-]{8}(\.\w+)$/, '$1');

/**
 * What each hub and kit file preloads, by file and in order: every dynamic
 * import's list (`__vite__mapDeps([…])` over the file's `m.f`), and the
 * sheets `index.html` links, names without their hashes.
 */
function hubPreloads(dist: Map<string, Buffer>): Record<string, string[][]> {
  const out: Record<string, string[][]> = { 'index.html': [linked(dist).map(unhashed)] };
  for (const [name, bytes] of dist) {
    if (name.startsWith('_p/') || !name.endsWith('.js')) continue;
    const code = bytes.toString();
    const deps = [...(code.match(/m\.f=\[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const lists = [...code.matchAll(/__vite__mapDeps\(\[([\d,]*)\]/g)].map((m) =>
      m[1].split(',').map((i) => unhashed(deps[Number(i)])),
    );
    if (lists.length) out[unhashed(name)] = lists;
  }
  return out;
}

test('the sheet order step leaves every hub and kit preload as Vite orders it, on the sample project', async () => {
  const sample = { ...fromProject('kit'), ...fromProject('prototypes'), ...fromProject('docs') };
  const step = await buildRow(sample);
  const plain = await buildRow(sample, {}, () => ({ without: ['design-hub-sheet-order'] }));
  assert.ifError(step.error);
  assert.ifError(plain.error);
  const withStep = hubPreloads(step.dist!);
  assert.deepEqual(withStep, hubPreloads(plain.dist!));
  // The hub has a list with more than one sheet, so the step had something to reorder.
  assert.ok(
    Object.values(withStep).some((lists) =>
      lists.some((l) => l.filter((f) => f.endsWith('.css')).length > 1),
    ),
  );
});

/** The prototype's sheets its entry preloads, by which rule they hold, in load order. */
const ownOrder = (dist: Map<string, Buffer>) =>
  sheetOrder(dist, 'alpha-proto')
    .map((t) =>
      /color:\s*#?(blue|00f)/.test(t) ? 'styles' : /color:\s*green|#008000/.test(t) ? 'shared' : null,
    )
    .filter(Boolean);

for (const [first, second] of [
  ['styles', 'shared'],
  ['shared', 'styles'],
] as const)
  test(`a prototype’s own sheets load in import order: ${first}.css, then ${second}.css`, async () => {
    const built = await buildRow({
      [`${A}/styles.css`]: '.same { color: blue; }\n',
      [`${A}/shared.css`]: '.same { color: green; }\n',
      [`${A}/index.tsx`]: `import './${first}.css';\nimport './${second}.css';\nexport default function P() { void import('./heavy.ts').then((m) => console.log(m)); return null; }\n`,
      [`${A}/heavy.ts`]: "import './shared.css';\nexport const run = 1;\n",
    });
    assert.ifError(built.error);
    assert.deepEqual(ownOrder(built.dist!), [first, second]);
  });
