import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_LABELS, type Point, rates, suggestThreshold } from './calibrate.ts';

// Twenty labelled judgments: true flags sit high, false ones low, with one false at 0.85.
const points: Point[] = [
  ...[0.95, 0.93, 0.91, 0.9, 0.88, 0.8, 0.75].map((p) => ({ p, truth: true })),
  { p: 0.85, truth: false },
  ...Array.from({ length: 12 }, (_, i) => ({ p: 0.1 + i * 0.04, truth: false })),
];

test('precision and recall at a threshold', () => {
  assert.deepEqual(rates(points, 0.9), { precision: 1, recall: 4 / 7 });
});

test('a precision goal takes the lowest threshold that is precise enough', () => {
  assert.equal(suggestThreshold(points, 'precision', 0.95), 0.9);
});

test('a recall goal takes the highest threshold that still catches enough', () => {
  assert.equal(suggestThreshold(points, 'recall', 1), 0.75);
});

test('too few labels move nothing', () => {
  assert.equal(suggestThreshold(points.slice(0, MIN_LABELS - 1), 'precision', 0.6), null);
});

test('a report row says what the labels support, and why not when they do not', async () => {
  const { report } = await import('./calibrate.ts');
  const judged = points.map((x, i) => ({
    id: `f${i}`,
    check: 'fidelity',
    question: 'fetching',
    subject: 's',
    at: '',
    p: x.p,
  }));
  const truth = new Map(points.map((x, i) => [`f${i}`, x.truth]));
  const rows = report(judged, truth, { fidelity: { warnAt: 0.7, blockAt: 0.9 } });
  const block = rows.find((r) => r.threshold === 'fidelity.blockAt');
  assert.deepEqual(
    {
      current: block?.current,
      suggested: block?.suggested,
      labelled: block?.labelled,
      positives: block?.positives,
    },
    { current: 0.9, suggested: 0.9, labelled: 20, positives: 7 },
  );
  assert.match(block?.reason ?? '', /^lowest threshold with precision/);
  const contacts = rows.find((r) => r.threshold === 'contacts.privateAt');
  assert.equal(contacts?.suggested, null);
  assert.match(contacts?.reason ?? '', /needs 20 labels with 5 yes; has 0 with 0/);
});
