import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { findKitFile, kitResolver } from './kit.ts';

/** Every temp folder a test makes, removed when the file is done. */
const made: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

test("the project's kit shadows the package's, file by file", () => {
  const project = temp('kit-p-');
  const pkg = temp('kit-k-');
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

test('a query rides along on the kit file it resolves to', () => {
  // Real paths, as the resolver returns them (a temp folder may sit behind a symlink).
  const project = realpathSync(temp('kit-q-'));
  const pkg = realpathSync(temp('kit-qk-'));
  writeFileSync(join(project, 'wk.ts'), '');
  writeFileSync(join(pkg, 'ui.css'), '');
  const resolve = kitResolver(project, pkg).resolveId as (id: string) => string | null;
  assert.equal(resolve('@kit/wk.ts?worker'), `${join(project, 'wk.ts')}?worker`);
  assert.equal(resolve('@kit/wk.ts'), join(project, 'wk.ts'));
  assert.equal(resolve('@milesroxas/design-hub/kit/ui.css?inline'), `${join(pkg, 'ui.css')}?inline`);
  assert.equal(resolve('@kit/missing?url'), null);
  assert.equal(resolve('react'), null);
});
