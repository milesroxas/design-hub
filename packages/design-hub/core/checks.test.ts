import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CHECKS, loadChecks, reaches, validateChecks } from './checks.ts';

test('the default checks are valid, and loadChecks keeps a valid value', () => {
  assert.deepEqual(validateChecks(DEFAULT_CHECKS), []);
  assert.equal(loadChecks(DEFAULT_CHECKS).checks, DEFAULT_CHECKS);
  assert.equal(loadChecks({ jev: {} }).checks, null);
  assert.ok(loadChecks({ jev: {} }).problems.length > 0);
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
