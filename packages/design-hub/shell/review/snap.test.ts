import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centreOf, isSpot, nearestSpot, SPOTS, stepSpot } from './snap.ts';

const viewport = { width: 1280, height: 800 };
const still = { x: 0, y: 0 };
const at = (x: number, y: number) => nearestSpot({ x, y }, still, viewport, 40, 16);

test('every spot rests the button gap pixels in from its edges', () => {
  assert.deepEqual(centreOf('bottom-right', viewport, 40, 16), { x: 1244, y: 764 });
  assert.deepEqual(centreOf('top-left', viewport, 40, 16), { x: 36, y: 36 });
  assert.deepEqual(centreOf('left', viewport, 40, 16), { x: 36, y: 400 });
});

test('a drop lands in the spot nearest it', () => {
  assert.equal(at(1200, 760), 'bottom-right');
  assert.equal(at(60, 700), 'bottom-left');
  assert.equal(at(100, 60), 'top-left');
  assert.equal(at(1250, 80), 'top-right');
  assert.equal(at(1250, 420), 'right');
  assert.equal(at(20, 380), 'left');
});

test('a flick carries the button toward where it was thrown', () => {
  const centre = { x: 640, y: 420 };
  assert.equal(nearestSpot(centre, { x: -6, y: 0 }, viewport, 40, 16), 'left');
  assert.equal(nearestSpot(centre, { x: 4, y: 3 }, viewport, 40, 16), 'bottom-right');
  assert.equal(nearestSpot(centre, { x: 0, y: -5 }, viewport, 40, 16) !== 'bottom-right', true);
});

test('Alt and an arrow step along the edge and across it, stopping at the ends', () => {
  assert.equal(stepSpot('bottom-right', 'ArrowLeft'), 'bottom-left');
  assert.equal(stepSpot('bottom-right', 'ArrowUp'), 'right');
  assert.equal(stepSpot('right', 'ArrowUp'), 'top-right');
  assert.equal(stepSpot('top-right', 'ArrowUp'), 'top-right');
  assert.equal(stepSpot('bottom-left', 'ArrowDown'), 'bottom-left');
  assert.equal(stepSpot('left', 'Enter'), 'left');
});

test('only the six spots are spots', () => {
  for (const s of SPOTS) assert.equal(isSpot(s), true);
  assert.equal(isSpot('middle'), false);
  assert.equal(isSpot(null), false);
});
