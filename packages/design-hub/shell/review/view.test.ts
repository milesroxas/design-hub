import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Draft,
  draftOf,
  initialView,
  roundOf,
  scopeOf,
  stepFrom,
  stepTarget,
  threadOf,
  type View,
  type ViewAction,
  view,
} from './view.ts';

const run = (start: View, ...actions: ViewAction[]) => actions.reduce(view, start);
const wholePage: Draft = { target: null, offset: null };

test('the layer starts with comment mode off, hidden or not as it was left', () => {
  assert.deepEqual(initialView(false), { hidden: false, commenting: false, card: null, resolved: false });
  assert.equal(initialView(true).hidden, true);
});

test('start turns comment mode on with no card; stop turns it off and drops the card', () => {
  const on = view(initialView(false), { type: 'start' });
  assert.deepEqual([on.commenting, on.card], [true, null]);
  const off = run(on, { type: 'open', id: 'c1' }, { type: 'stop' });
  assert.deepEqual([off.commenting, off.card], [false, null]);
});

test('opening a thread turns comment mode on and shows the layer even when it was hidden', () => {
  const opened = view(initialView(true), { type: 'open', id: 'c7' });
  assert.deepEqual(
    [opened.hidden, opened.commenting, opened.card],
    [false, true, { type: 'thread', id: 'c7' }],
  );
});

test('one card at a time: a draft replaces a thread, a thread replaces a draft', () => {
  const draft = run(
    initialView(false),
    { type: 'start' },
    { type: 'open', id: 'c1' },
    { type: 'draft', draft: wholePage },
  );
  assert.deepEqual(draft.card, { type: 'draft', draft: wholePage });
  const thread = view(draft, { type: 'open', id: 'c2' });
  assert.deepEqual(thread.card, { type: 'thread', id: 'c2' });
});

test('people toggles its card and turns comment mode on', () => {
  const shown = view(initialView(false), { type: 'people' });
  assert.deepEqual([shown.commenting, shown.card], [true, { type: 'people' }]);
  assert.equal(view(shown, { type: 'people' }).card, null);
});

test('escape steps back one level: the card, then comment mode', () => {
  const start = run(initialView(false), { type: 'start' }, { type: 'open', id: 'c1' });
  const once = view(start, { type: 'escape' });
  assert.deepEqual([once.commenting, once.card], [true, null]);
  const twice = view(once, { type: 'escape' });
  assert.equal(twice.commenting, false);
});

test('close drops the card and keeps comment mode', () => {
  const state = run(
    initialView(false),
    { type: 'start' },
    { type: 'draft', draft: wholePage },
    { type: 'close' },
  );
  assert.deepEqual([state.commenting, state.card], [true, null]);
});

test('hide turns everything off; show brings back the button only', () => {
  const hidden = run(initialView(false), { type: 'open', id: 'c1' }, { type: 'hide' });
  assert.deepEqual([hidden.hidden, hidden.commenting, hidden.card], [true, false, null]);
  const shown = view(hidden, { type: 'show' });
  assert.deepEqual([shown.hidden, shown.commenting], [false, false]);
});

test('resolved toggles and survives the mode turning off and on', () => {
  const state = run(
    initialView(false),
    { type: 'resolved' },
    { type: 'start' },
    { type: 'stop' },
    { type: 'start' },
  );
  assert.equal(state.resolved, true);
  assert.equal(view(state, { type: 'resolved' }).resolved, false);
});

test('every action returns a new value and leaves the old one alone', () => {
  const start = initialView(false);
  const frozen = Object.freeze({ ...start });
  const next = view(frozen, { type: 'hide' });
  assert.notEqual(next, frozen);
  assert.deepEqual(frozen, start);
});

const t = (id: string, status: 'open' | 'resolved') => ({ id, status });
const roots = [t('a', 'open'), t('b', 'resolved'), t('c', 'open')];

test('the round is the open threads, plus resolved when shown, plus the open card always', () => {
  assert.deepEqual(
    roundOf(roots, false, null).map((c) => c.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    roundOf(roots, true, null).map((c) => c.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    roundOf(roots, false, 'b').map((c) => c.id),
    ['a', 'b', 'c'],
  );
});

test('stepping wraps at both ends', () => {
  const round = roundOf(roots, false, null);
  assert.equal(stepFrom(round, 'c', 1)?.id, 'a');
  assert.equal(stepFrom(round, 'a', -1)?.id, 'c');
  assert.equal(stepFrom(round, 'a', 1)?.id, 'c');
  assert.equal(stepFrom([], 'a', 1), undefined);
});

test('the card names a thread only when it shows one', () => {
  assert.equal(threadOf({ type: 'thread', id: 'x' }), 'x');
  assert.equal(threadOf({ type: 'people' }), null);
  assert.equal(threadOf(null), null);
});

test('the card holds a draft only when it is one', () => {
  assert.deepEqual(draftOf({ type: 'draft', draft: wholePage }), wholePage);
  assert.equal(draftOf({ type: 'thread', id: 'x' }), null);
  assert.equal(draftOf(null), null);
});

test('the bar steps on from the open thread, or in from an end with none open', () => {
  const round = roundOf(roots, false, null);
  assert.equal(stepTarget(round, null, 1)?.id, 'a');
  assert.equal(stepTarget(round, null, -1)?.id, 'c');
  assert.equal(stepTarget(round, 'a', 1)?.id, 'c');
  assert.equal(stepTarget(round, 'gone', 1)?.id, 'a');
  assert.equal(stepTarget([], null, 1), undefined);
});

test('the toggle reads Page only while a page comment is being written', () => {
  assert.equal(scopeOf(null), 'pin');
  assert.equal(scopeOf({ type: 'draft', draft: wholePage }), 'page');
  assert.equal(scopeOf({ type: 'draft', draft: { target: {} as Element, offset: { x: 0, y: 0 } } }), 'pin');
  assert.equal(scopeOf({ type: 'thread', id: 'x' }), 'pin');
});
