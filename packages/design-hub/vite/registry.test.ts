import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { guideFeatures, prototypeSlugs, registrySource } from './registry.ts';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'reg-'));
  const proto = (slug: string, withCode = true) => {
    mkdirSync(join(root, 'prototypes', slug), { recursive: true });
    writeFileSync(join(root, 'prototypes', slug, 'README.md'), `---\ntitle: ${slug}\n---\n`);
    if (withCode) writeFileSync(join(root, 'prototypes', slug, 'index.tsx'), 'export default () => null;');
  };
  proto('sample-list');
  proto('no-code', false);
  proto('guide');
  mkdirSync(join(root, 'prototypes', '_private'), { recursive: true });
  mkdirSync(join(root, 'prototypes', 'no-readme'), { recursive: true });
  mkdirSync(join(root, 'docs', 'sprints', 'sample'), { recursive: true });
  writeFileSync(join(root, 'docs', 'sprints', 'sample', 'guide.md'), '# Guide\n');
  mkdirSync(join(root, 'docs', 'sprints', 'empty'), { recursive: true });
  return root;
}

test('only kebab-case folders with a README are prototypes, and guide is never one', () => {
  const root = project();
  assert.deepEqual(prototypeSlugs(join(root, 'prototypes')), ['no-code', 'sample-list']);
  assert.deepEqual(guideFeatures(join(root, 'docs', 'sprints')), ['sample']);
  assert.deepEqual(prototypeSlugs(join(root, 'nowhere')), []);
});

test('the module imports each README raw, each index lazily, and each guide as a doc', () => {
  const root = project();
  const source = registrySource(root);
  assert.match(source, new RegExp(`import readme\\d+ from "${root}/prototypes/sample-list/README.md\\?raw"`));
  assert.match(
    source,
    new RegExp(`"sample-list": \\(\\) => import\\("${root}/prototypes/sample-list/index.tsx"\\)`),
  );
  assert.doesNotMatch(source, /"no-code": \(\) => import/);
  assert.match(source, /"no-code": readme\d+/);
  assert.match(
    source,
    new RegExp(`"sample": \\(\\) => import\\("${root}/docs/sprints/sample/guide.md\\?doc"\\)`),
  );
});
