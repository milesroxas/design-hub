import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { biomeBin, packageDir, tscBin } from './bin.ts';

test('the bundled tsc and biome are found through their packages', () => {
  assert.ok(existsSync(tscBin()));
  assert.ok(existsSync(biomeBin()));
  assert.match(packageDir('vite'), /\/vite$/);
});
