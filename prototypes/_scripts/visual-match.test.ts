import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { asset } from './visual-match.ts';

function png(width: number, height: number, name = 'shot.png'): string {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  const file = join(mkdtempSync(join(tmpdir(), 'vm-')), name);
  writeFileSync(file, bytes);
  return file;
}

test('takes an image inside TypeSafe limits as base64', () => {
  const a = asset(png(800, 600), '--shot');
  assert.equal(a.format, 'png');
  assert.equal(Buffer.from(a.data_base64, 'base64').length, 33);
});

test('refuses an image outside the limits with the resize command, and anything not PNG or JPEG', () => {
  assert.throws(() => asset(png(2400, 1600), '--comp'), /2400×1600/);
  assert.throws(() => asset(png(200, 200), '--comp'), /280 to 1568 px/);
  assert.throws(() => asset(png(800, 600, 'shot.gif'), '--comp'), /PNG or JPEG/);
  assert.throws(() => asset('/nope.png', '--comp'), /does not exist/);
});
