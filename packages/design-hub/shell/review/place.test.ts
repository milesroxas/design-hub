import assert from 'node:assert/strict';
import { test } from 'node:test';
import { besideButton, besidePoint, distanceToRect, dragOffset, nearest, shouldDismiss } from './place.ts';

const vp = { width: 1280, height: 800 };
const button = (left: number, top: number) => ({ left, top, right: left + 40, bottom: top + 40 });

test('beside a pin: to its right when there is room, level with it', () => {
  assert.deepEqual(besidePoint({ x: 400, y: 300 }, 200, vp), { left: 420, top: 272, origin: 'left top' });
});

test('beside a pin near the right edge: flipped to its left', () => {
  const p = besidePoint({ x: 1100, y: 300 }, 200, vp);
  assert.equal(p.left, 1100 - 20 - 320);
  assert.equal(p.origin, 'right top');
});

test('beside a pin near the bottom: lifted to stay on screen', () => {
  assert.equal(besidePoint({ x: 400, y: 780 }, 300, vp).top, 800 - 300 - 16);
  assert.equal(besidePoint({ x: 400, y: 0 }, 300, vp).top, 16);
});

test('beside the button at the bottom right: above it, right edges lined up', () => {
  assert.deepEqual(besideButton(button(1224, 744), 200, vp), {
    left: 1264 - 320,
    top: 744 - 12 - 200,
    origin: 'bottom right',
  });
});

test('beside the button at the top left: below it, left edges lined up', () => {
  assert.deepEqual(besideButton(button(16, 16), 200, vp), { left: 16, top: 68, origin: 'top left' });
});

test('beside the button mid-edge: to its inner side, centred on it', () => {
  assert.deepEqual(besideButton(button(1224, 380), 200, vp), {
    left: 1224 - 12 - 320,
    top: 300,
    origin: 'right center',
  });
  assert.equal(besideButton(button(16, 380), 200, vp).left, 56 + 12);
});

test('a dragged sheet follows the finger down and resists going up', () => {
  assert.equal(dragOffset(120), 120);
  assert.equal(dragOffset(0), 0);
  assert.equal(dragOffset(-100), -20);
});

test('a sheet leaves when pulled far enough or flicked, and settles back otherwise', () => {
  assert.equal(shouldDismiss(140, 0.1), true);
  assert.equal(shouldDismiss(40, 0.9), true);
  assert.equal(shouldDismiss(40, 0.2), false);
  assert.equal(shouldDismiss(8, 2), false);
  assert.equal(shouldDismiss(-60, 1), false);
});

test('a point inside a box is no distance from it; outside, the gap to its nearest edge', () => {
  const r = { left: 100, top: 100, right: 124, bottom: 124 };
  assert.equal(distanceToRect(110, 110, r), 0);
  assert.equal(distanceToRect(134, 110, r), 10);
  assert.equal(distanceToRect(127, 128, r), 5);
});

test('a click near a pin lands on the closest pin within reach, or none', () => {
  const a = { id: 'a', left: 100, top: 100, right: 124, bottom: 124 };
  const b = { id: 'b', left: 150, top: 100, right: 174, bottom: 124 };
  assert.equal(nearest(135, 110, [a, b], 16)?.id, 'a');
  assert.equal(nearest(142, 110, [a, b], 16)?.id, 'b');
  assert.equal(nearest(110, 160, [a, b], 16), null);
  assert.equal(nearest(110, 110, [], 16), null);
});
