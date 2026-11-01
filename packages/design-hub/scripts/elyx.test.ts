import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plan } from './elyx.ts';

const css = `:root {
  --brand: #3d6ee8;
  --bg: rgb(0 0 0 / .08);
  --radius-md: 8px;
  --font: "Inter", system-ui, sans-serif;
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --harness-bg: #2a2a2a;
}
.dark-mode {
  --brand: #5f8bf3;
  --radius-md: 10px;
}`;

test('sorts tokens by what Elyx can hold and keeps dark overrides for colours only', () => {
  const p = plan(css);
  assert.deepEqual(p.counts, { colors: 2, dark: 1, radius: 1, lengths: 0, fonts: 1 });
  assert.match(p.files['tokens/colors.elyx'], /brand: #3d6ee8,\n {2}bg: #00000014/);
  assert.match(p.files['tokens/colors.dark.elyx'], /brand: #5f8bf3\n/);
  assert.deepEqual(JSON.parse(p.files['elyx.json']).defaults.text.font.family, 'Inter');
  assert.ok(p.skipped.some((s) => s.startsWith('--ease-out:')));
  assert.ok(p.skipped.some((s) => s.startsWith('--harness-bg:')));
  assert.ok(p.skipped.includes('--radius-md (.dark-mode): not a colour token'));
  assert.equal('tokens/lengths.elyx' in p.files, false);
});

test('refuses a dark override with no light value', () => {
  assert.throws(
    () => plan(':root { --a: #fff; }\n.dark-mode { --b: #000; }'),
    /--b is set in .dark-mode but not on :root/,
  );
});

test('compares a token byte for byte, alpha rounded to 8 bits', async () => {
  const { mismatch } = await import('./elyx.ts');
  const token = (value: string, theme?: string) => ({ name: 'bg', value, context: theme ? { theme } : {} });
  assert.equal(mismatch(token('rgb(0 0 0 / 0.0784)'), 'rgb(0 0 0 / .08)'), null);
  assert.equal(mismatch(token('rgb(61 110 232)'), '#3d6ee8'), null);
  assert.equal(
    mismatch(token('rgb(61 110 233)', 'dark'), '#3d6ee8'),
    'dark bg: #3d6ee8 became rgb(61 110 233)',
  );
  assert.equal(mismatch(token('rgb(1 1 1)'), undefined), null);
});
