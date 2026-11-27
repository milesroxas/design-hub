/// <reference types="node" />
// A real cold export: the brand template's artboard to a PNG, in a throwaway
// project with an empty Vite cache, through the CLI as a project runs it.
// Skipped, saying why, on a machine without Chrome; `release-check` runs the
// same export and fails there instead, so a release never ships untried.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKAGE } from '../server/paths.ts';
import { exportSmoke, findChrome } from './lib/export-smoke.ts';

const chrome = findChrome();

// What is left in the OS temp folder is asserted only for the smoke's own project, the one entry this
// run can be shown to own: Chrome's own entries carry no mark of the run that made them, and the
// user's Chrome or a second checkout's tests make the same names meanwhile.
test('a cold design-hub export of one brand prototype writes its PNG and removes its project', {
  skip: chrome ? false : 'No Chrome, Chromium or Edge on this machine (set CHROME_PATH)',
  timeout: 200_000,
}, async () => {
  const result = await exportSmoke(join(PACKAGE, 'scripts', 'cli.ts'));
  assert.equal(result.ran, true);
  assert.ok(result.ran && !existsSync(result.root), 'the smoke’s project is removed');
  assert.ok(result.ran && result.files.some((f) => f.endsWith('.png')), JSON.stringify(result));
});
