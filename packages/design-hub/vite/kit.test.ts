import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { findKitFile } from './kit.ts';

test("the project's kit shadows the package's, file by file", () => {
  const project = mkdtempSync(join(tmpdir(), 'kit-p-'));
  const pkg = mkdtempSync(join(tmpdir(), 'kit-k-'));
  mkdirSync(join(pkg, 'ui'));
  writeFileSync(join(pkg, 'Icon.tsx'), '');
  writeFileSync(join(pkg, 'tokens.css'), '');
  writeFileSync(join(pkg, 'ui', 'index.ts'), '');
  writeFileSync(join(project, 'tokens.css'), '');
  assert.equal(findKitFile([project, pkg], 'tokens.css'), join(project, 'tokens.css'));
  assert.equal(findKitFile([project, pkg], 'Icon'), join(pkg, 'Icon.tsx'));
  assert.equal(findKitFile([project, pkg], 'ui'), join(pkg, 'ui', 'index.ts'));
  assert.equal(findKitFile([project, pkg], 'missing'), null);
  assert.equal(findKitFile([project], 'ui'), null);
});
