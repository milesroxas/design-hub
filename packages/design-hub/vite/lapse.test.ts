import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hasLapse, lapseSource } from './lapse.ts';

test('Lapse is the project’s choice: present only when the project installed it', () => {
  const root = mkdtempSync(join(tmpdir(), 'lapse-'));
  assert.equal(hasLapse(root), false);
  mkdirSync(join(root, 'node_modules', '@aiforui', 'lapse'), { recursive: true });
  writeFileSync(join(root, 'node_modules', '@aiforui', 'lapse', 'package.json'), '{}');
  assert.equal(hasLapse(root), true);
});

test('the module re-exports the resolved panel, or mounts nothing', () => {
  assert.equal(lapseSource(null), 'export const mountLapse = null;\n');
  assert.equal(lapseSource('/p/panel.js'), 'export { mountLapse } from "/p/panel.js";\n');
});
