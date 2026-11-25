import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKAGE, PACKAGE_SKILLS } from '../server/paths.ts';
import { addScripts, installSkills, SCRIPTS } from './skills.ts';

test('every project-facing skill is copied, with its references; the global one stays out', () => {
  const into = mkdtempSync(join(tmpdir(), 'skills-'));
  const names = installSkills(PACKAGE_SKILLS, into);
  assert.ok(names.includes('miles-prototype'));
  assert.ok(!names.includes('miles-design-hub'));
  assert.deepEqual(readdirSync(into).sort(), names);
  assert.ok(existsSync(join(into, 'miles-prototype', 'references', 'motion.md')));
  assert.deepEqual(installSkills(PACKAGE_SKILLS, into), names);
});

test('a retired skill is removed from the project; a skill of its own is kept', () => {
  const into = mkdtempSync(join(tmpdir(), 'skills-'));
  for (const name of ['miles-conductor', 'team-notes']) {
    mkdirSync(join(into, name));
    writeFileSync(join(into, name, 'SKILL.md'), '---\nname: x\n---\n');
  }
  const names = installSkills(PACKAGE_SKILLS, into);
  assert.ok(names.includes('miles-worktrees'));
  assert.ok(!existsSync(join(into, 'miles-conductor')));
  assert.ok(existsSync(join(into, 'team-notes', 'SKILL.md')));
});

test('an upgraded project gains the scripts it lacks; its own are kept', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'scripts-')), 'package.json');
  writeFileSync(
    file,
    `${JSON.stringify({ name: 'p', scripts: { dev: 'design-hub dev --open', lint: 'x' } }, null, 2)}\n`,
  );
  const added = addScripts(file);
  assert.ok(added.includes('share') && added.includes('signin'));
  assert.ok(!added.includes('dev'));
  const { scripts } = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(scripts.dev, 'design-hub dev --open');
  assert.equal(scripts.lint, 'x');
  assert.equal(scripts.share, 'design-hub share');
  assert.deepEqual(addScripts(file), []);
  assert.deepEqual(addScripts(join(tmpdir(), 'no-such-dir', 'package.json')), []);
});

test("the template's scripts are the ones an upgrade adds", () => {
  const template = join(PACKAGE, '..', 'create-design-hub', 'template', 'package.json');
  assert.deepEqual(JSON.parse(readFileSync(template, 'utf8')).scripts, SCRIPTS);
});
