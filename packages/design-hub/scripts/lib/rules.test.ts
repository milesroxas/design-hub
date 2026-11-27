/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKAGE_SKILLS } from '../../server/paths.ts';
import { RULE } from './rules.ts';

test('every rule the guard names is a heading in the miles-prototype skill', () => {
  const skill = readFileSync(join(PACKAGE_SKILLS, 'miles-prototype', 'SKILL.md'), 'utf8');
  const headings = new Set([...skill.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim()));
  const missing = Object.values(RULE).filter((name) => !headings.has(name));
  assert.deepEqual(missing, []);
});
