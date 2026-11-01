import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findProject, PACKAGE, packageRoot, projectRoot } from './paths.ts';

test('the project is the nearest ancestor that installed design-hub', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'hub-')));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { '@milesroxas/design-hub': '^0.1.0' } }),
  );
  mkdirSync(join(root, 'prototypes', 'a'), { recursive: true });
  assert.equal(findProject(join(root, 'prototypes', 'a')), root);
  assert.equal(projectRoot({}, join(root, 'prototypes')), root);
  assert.equal(projectRoot({ DESIGN_HUB_ROOT: '/nowhere/elsewhere' }, root), '/nowhere/elsewhere');
});

test('a folder with no project above it is its own root', () => {
  const lone = realpathSync(mkdtempSync(join(tmpdir(), 'lone-')));
  assert.equal(findProject(lone), null);
  assert.equal(projectRoot({}, lone), lone);
});

test('the package root is found from source and from dist alike', () => {
  assert.equal(packageRoot(join(PACKAGE, 'server', 'paths.ts')), PACKAGE);
  assert.equal(packageRoot(join(PACKAGE, 'dist', 'server', 'paths.js')), PACKAGE);
});
