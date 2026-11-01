import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CHECKS } from '../checks.ts';
import type { askJev } from '../jev.ts';
import { jevTriager } from './triage.ts';

const answering = (answers: Record<string, unknown>): typeof askJev =>
  (async () => ({ ok: true, model: 'm', answers, ms: 1 })) as unknown as typeof askJev;

const input = { body: 'Typo in the title', prototype: 'p', url: '/p/', states: ['Real', 'Empty'] };

test('keeps a confident kind and state', async () => {
  const triage = jevTriager(
    'key',
    DEFAULT_CHECKS,
    answering({
      kind: { type: 'choice', choice: 'copy', confidence: 0.8, probabilities: {} },
      state: { type: 'choice', choice: 'Real', confidence: 0.6, probabilities: {} },
    }),
  );
  assert.deepEqual(await triage?.(input), { kind: 'copy', state: 'Real', by: 'jev', confidence: 0.6 });
});

test('leaves an unsure field for a person', async () => {
  const triage = jevTriager(
    'key',
    DEFAULT_CHECKS,
    answering({
      kind: { type: 'choice', choice: 'bug', confidence: 0.2, probabilities: {} },
      state: { type: 'choice', choice: 'Empty', confidence: 0.9, probabilities: {} },
    }),
  );
  assert.deepEqual(await triage?.(input), { kind: null, state: 'Empty', by: 'jev', confidence: 0.9 });
});

test('is off without a key or checks, and null when Jev fails', async () => {
  assert.equal(jevTriager('', DEFAULT_CHECKS), null);
  assert.equal(jevTriager('key', null), null);
  const failing = (async () => ({ ok: false, error: 'x', ms: 1 })) as unknown as typeof askJev;
  assert.equal(await jevTriager('key', DEFAULT_CHECKS, failing)?.(input), null);
});
