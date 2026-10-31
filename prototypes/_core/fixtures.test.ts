import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureSets } from './fixtures.ts';

type Item = { id: string; name: string; status: string; updated: string };
const real: Item[] = [
  { id: '1', name: 'Short', status: 'active', updated: '2026-10-28' },
  { id: '2', name: 'A much longer name', status: 'done', updated: '2026-10-21' },
];
const sets = fixtureSets({ real, missing: [] }, { max: 5, text: ['name'] });

test('longest stretches only the named text fields, on the first row', () => {
  assert.deepEqual(sets.longest[0], {
    id: '1',
    name: 'A much longer name A much longer name',
    status: 'active',
    updated: '2026-10-28',
  });
  assert.deepEqual(sets.longest[1], real[1]);
});

test('max repeats to the count with unique ids; empty is empty', () => {
  assert.deepEqual(
    sets.max.map((i) => i.id),
    ['1', '2', '1-1', '2-1', '1-2'],
  );
  assert.deepEqual(sets.empty, []);
});

test('a set written by hand wins', () => {
  const hand = fixtureSets({ real, missing: [], longest: [real[1]] }, { max: 1, text: ['name'] });
  assert.deepEqual(hand.longest, [real[1]]);
});
