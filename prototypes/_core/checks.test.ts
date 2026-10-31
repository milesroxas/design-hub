import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkProblems, reaches, validateChecks } from './checks.ts';

test('the shipped checks.json is valid', () => {
  assert.deepEqual(checkProblems, []);
});

test('names each invalid field by path', () => {
  const problems = validateChecks({ jev: { model: '', timeoutMs: 0 }, fidelity: { warnAt: 2 } });
  assert.ok(problems.includes('jev.model: a model name'));
  assert.ok(problems.some((p) => p.startsWith('fidelity.warnAt')));
  assert.ok(problems.some((p) => p.startsWith('contacts.allow')));
});

test('a null threshold never fires', () => {
  assert.equal(reaches(1, null), false);
  assert.equal(reaches(0.7, 0.7), true);
  assert.equal(reaches(0.69, 0.7), false);
});
