import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageSize } from './image.ts';

test('reads a PNG header', () => {
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  png.set([0, 0, 3, 0x20, 0, 0, 2, 0x58], 16);
  assert.deepEqual(imageSize(png), { width: 800, height: 600, format: 'png' });
});

test('reads a JPEG frame header past a segment, a restart marker and a fill byte', () => {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const restart = [0xff, 0xd3];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const jpg = new Uint8Array([0xff, 0xd8, ...app0, ...restart, 0xff, ...sof0]);
  assert.deepEqual(imageSize(jpg), { width: 800, height: 600, format: 'jpg' });
});

test('is null for anything else', () => {
  assert.equal(imageSize(new TextEncoder().encode('GIF89a........................')), null);
});
