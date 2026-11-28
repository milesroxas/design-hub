import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { RESERVED } from '../core/prototype.ts';
import { allSource, entrySource, guideFeatures, prototypeSlugs, registrySource } from './registry.ts';

/** Every project a test makes, removed when the file is done. */
const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project() {
  const root = mkdtempSync(join(tmpdir(), 'reg-'));
  made.push(root);
  const proto = (slug: string, withCode = true) => {
    mkdirSync(join(root, 'prototypes', slug), { recursive: true });
    writeFileSync(join(root, 'prototypes', slug, 'README.md'), `---\ntitle: ${slug}\n---\n`);
    if (withCode) writeFileSync(join(root, 'prototypes', slug, 'index.tsx'), 'export default () => null;');
  };
  proto('sample-list');
  proto('no-code', false);
  for (const reserved of RESERVED) proto(reserved);
  mkdirSync(join(root, 'prototypes', '_private'), { recursive: true });
  mkdirSync(join(root, 'prototypes', 'no-readme'), { recursive: true });
  mkdirSync(join(root, 'docs', 'sprints', 'sample'), { recursive: true });
  writeFileSync(join(root, 'docs', 'sprints', 'sample', 'guide.md'), '# Guide\n');
  mkdirSync(join(root, 'docs', 'sprints', 'empty'), { recursive: true });
  return root;
}

test('only kebab-case folders with a README are prototypes, and a reserved name never is', () => {
  const root = project();
  assert.deepEqual(prototypeSlugs(join(root, 'prototypes')), ['no-code', 'sample-list']);
  assert.deepEqual(guideFeatures(join(root, 'docs', 'sprints')), ['sample']);
  assert.deepEqual(prototypeSlugs(join(root, 'nowhere')), []);
});

test('served, the module maps each prototype to its entry module, and each guide to its doc', () => {
  const root = project();
  const source = registrySource(root, 'serve');
  assert.match(source, /"sample-list": \(\) => import\("virtual:design-hub\/entry\/sample-list"\)/);
  assert.match(source, /"no-code": \(\) => import\("virtual:design-hub\/entry\/no-code"\)/);
  assert.doesNotMatch(source, /"(guide|api|assets)":.*entry/);
  assert.match(source, /export const allSlugs = /);
  assert.match(source, /export const entryOf = /);
  assert.match(source, /Object\.hasOwn\(entries, slug\)/);
  assert.match(
    source,
    new RegExp(`"sample": \\(\\) => import\\("${root}/docs/sprints/sample/guide.md\\?doc"\\)`),
  );
  assert.equal(registrySource(root), source);
});

test('built, the module names no prototype: it fetches _p/all.js and each _p/<slug>/entry.js by path', () => {
  const root = project();
  const source = registrySource(root, 'build', '/');
  for (const slug of ['sample-list', 'no-code']) assert.doesNotMatch(source, new RegExp(slug));
  assert.doesNotMatch(source, /README|index\.tsx/);
  assert.match(source, /export const allSlugs = \(\) => at\("\/_p\/all\.js"\)\.then\(\(m\) => m\.slugs\)/);
  assert.match(source, /const dir = "\/_p\/";/);
  assert.match(source, /const path = dir \+ slug \+ "\/entry\.js";/);
  // Asked first through the tested probe (core/prototype.ts), then imported.
  assert.match(source, /import \{ probeEntry \} from ".*\/core\/prototype\.ts";/);
  assert.match(source, /return \(await probeEntry\(path, fetch\)\) \? at\(path\) : null;/);
  assert.match(source, /import\(\/\* @vite-ignore \*\/ path\)/);
  // Walkthroughs are still in the main bundle (left in the backlog).
  assert.match(source, /"sample": \(\) => import/);
  assert.match(registrySource(root, 'build', '/hub/'), /at\("\/hub\/_p\/all\.js"\)/);
});

test('an entry is the README raw and the code lazily; no index.tsx, no loader', () => {
  const root = project();
  assert.equal(
    entrySource(root, 'sample-list'),
    [
      `export { default as readme } from "${root}/prototypes/sample-list/README.md?raw";`,
      `export const load = () => import("${root}/prototypes/sample-list/index.tsx");`,
      '',
    ].join('\n'),
  );
  assert.doesNotMatch(entrySource(root, 'no-code'), /load/);
  assert.match(entrySource(root, 'no-code'), /no-code\/README\.md\?raw/);
  assert.equal(allSource(['a', 'b']), 'export const slugs = ["a","b"];\n');
});
