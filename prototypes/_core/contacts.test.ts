import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contactsIn, contactsInJson } from './contacts.ts';

test('finds emails and phone numbers', () => {
  const found = contactsIn('Call +1 (415) 555-0134 or write ana.ruiz@example.com');
  assert.deepEqual(
    found.map((c) => [c.kind, c.value]),
    [
      ['email', 'ana.ruiz@example.com'],
      ['phone', '+1 (415) 555-0134'],
    ],
  );
});

test('ignores dates, short numbers, prices and ids', () => {
  for (const text of [
    '2026-10-28',
    'updated 2026-10-28T10:00:00Z',
    '42 items',
    '$1,299.00',
    'v1.2.3',
    'id 64f1a2b3c4d5e6f7a8b9c0d1',
  ])
    assert.deepEqual(contactsIn(text), [], text);
});

test('reports the JSON path of each match', () => {
  const found = contactsInJson({ real: [{ name: 'A' }, { owner: { email: 'x@y.io' } }] });
  assert.deepEqual(found, [{ kind: 'email', value: 'x@y.io', path: 'real[1].owner.email' }]);
});
