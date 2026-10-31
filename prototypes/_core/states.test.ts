import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStates } from './states.ts';

const readme = (table: string) =>
  `# X\n\n## Question\n\nWhy?\n\n## States\n\nIntro line.\n\n${table}\n\n## Fixtures\n\n| real | x |\n`;

test('reads every row after the header and separator', () => {
  const md = readme(
    '| State | How to reach it |\n| --- | --- |\n| Real list | Controls → **real** |\n| Empty | Controls → **empty** |',
  );
  assert.deepEqual(parseStates(md), [
    { name: 'Real list', reach: 'Controls → **real**' },
    { name: 'Empty', reach: 'Controls → **empty**' },
  ]);
});

test('stops at the next section, so a later table is not read as states', () => {
  const md = readme('| State | How |\n|:---|---:|\n| Dark | ?theme=dark |');
  assert.deepEqual(
    parseStates(md)?.map((s) => s.name),
    ['Dark'],
  );
});

test('drops the template placeholder row', () => {
  assert.deepEqual(parseStates(readme('| State | How to reach it |\n| --- | --- |\n| | |')), []);
});

test('is null without a States section', () => {
  assert.equal(parseStates('# X\n\n## Question\n'), null);
});

test('reads a States section that ends the file', () => {
  assert.deepEqual(parseStates('## States\n\n| State | How |\n| --- | --- |\n| Open | click |\n')?.length, 1);
});
