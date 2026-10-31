import assert from 'node:assert/strict';
import { test } from 'node:test';
import { block, classify, toHex } from './css-tokens.ts';

test('reads one block, ignoring comments', () => {
  const css = ':root {\n  /* --nope: 1px; */\n  --a: #fff; --b:\n 4px;\n}\n.dark-mode { --a: #000; }';
  assert.deepEqual(
    [...block(css, ':root')],
    [
      ['a', '#fff'],
      ['b', '4px'],
    ],
  );
  assert.deepEqual([...block(css, '.dark-mode')], [['a', '#000']]);
  assert.throws(() => block(css, '.x'), /no \.x block/);
});

test('colors become hex, alpha as a fourth byte', () => {
  assert.equal(toHex('#FFF'), '#ffffff');
  assert.equal(toHex('#3d6ee8ff'), '#3d6ee8');
  assert.equal(toHex('rgb(0 0 0 / .08)'), '#00000014');
  assert.equal(toHex('rgba(255, 255, 255, 0.5)'), '#ffffff80');
  assert.equal(toHex('rgb(0 0 0 / 50%)'), '#00000080');
  assert.equal(toHex('0 1px 2px rgb(0 0 0 / .1)'), null);
  assert.equal(toHex('#12345'), null);
});

test('sorts names into what Elyx can hold', () => {
  assert.deepEqual(classify('radius-md', '8px'), { kind: 'radius', value: '8' });
  assert.deepEqual(classify('font', '"Inter", system-ui, sans-serif'), { kind: 'font', value: '"Inter"' });
  assert.equal(classify('harness-bg', '#2a2a2a').kind, 'skip');
  assert.equal(classify('ease-out', 'cubic-bezier(0.23, 1, 0.32, 1)').kind, 'skip');
  assert.equal(classify('shadow-xs', '0 1px 2px rgb(16 24 40 / .05)').kind, 'skip');
});
