import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKAGE_SKILLS } from '../server/paths.ts';
import { installSkills } from './skills.ts';

test('every project-facing skill is copied, with its references; the global one stays out', () => {
  const into = mkdtempSync(join(tmpdir(), 'skills-'));
  const names = installSkills(PACKAGE_SKILLS, into);
  assert.ok(names.includes('miles-prototype'));
  assert.ok(!names.includes('miles-design-hub'));
  assert.deepEqual(readdirSync(into).sort(), names);
  assert.ok(existsSync(join(into, 'miles-prototype', 'references', 'motion.md')));
  assert.deepEqual(installSkills(PACKAGE_SKILLS, into), names);
});
