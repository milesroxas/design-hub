import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readMeta } from '../core/catalog.ts';
import type { OnDisk } from './lib/catalog.ts';
import type { judge } from './lib/judge.ts';
import { contacts, states } from './preflight.ts';

const STATES = '\n## States\n\n| State | How |\n| --- | --- |\n| Real | Controls |\n';

function prototype(slug: string, frontmatter: string, body: string, fixtures?: unknown): OnDisk {
  const dir = mkdtempSync(join(tmpdir(), `${slug}-`));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.tsx'), 'export default function P() { return null; }\n');
  if (fixtures) writeFileSync(join(dir, 'fixtures.json'), JSON.stringify(fixtures));
  return { ...readMeta(slug, `---\n${frontmatter}\n---\n# ${slug}\n${body}`), dir };
}

const off = (async () => null) as unknown as typeof judge;
const noul = (key: string, p: number) =>
  (async () => ({
    answers: { [key]: { type: 'noul', noul: p } },
    ids: { [key]: 'id1' },
  })) as unknown as typeof judge;

test('states: a reviewed prototype needs rows; explorations and archived ones do not', async () => {
  const all = [
    prototype('a', 'kind: sprint\nfeature: f', ''),
    prototype('b', 'kind: exploration', ''),
    prototype('c', 'kind: alternate\nfeature: f\nstatus: archived', ''),
  ];
  const step = await states(all, off);
  assert.equal(step.ok, false);
  assert.deepEqual(step.detail, [{ prototype: 'a', problem: 'README has no States rows' }]);
});

test('states: Jev over the threshold names a state the table misses', async () => {
  const all = [prototype('a', 'kind: sprint\nfeature: f', STATES)];
  assert.equal((await states(all, noul('state', 0.2))).ok, true);
  const flagged = await states(all, noul('state', 0.95));
  assert.equal(flagged.ok, false);
  assert.match(JSON.stringify(flagged.detail), /renders a state the States table does not list/);
});

test('contacts: every match stops the share without Jev; the allow list and a business verdict pass', async () => {
  const fixtures = { real: [{ owner: 'Ada, ada@example.com' }], missing: [] };
  const all = [prototype('a', 'kind: sprint', STATES, fixtures)];
  const stopped = await contacts(all, new Set(), off);
  assert.equal(stopped.ok, false);
  assert.deepEqual(
    (stopped.detail as { value: string }[]).map((c) => c.value),
    ['ada@example.com'],
  );
  assert.equal((await contacts(all, new Set(['ada@example.com']), off)).ok, true);
  assert.equal((await contacts(all, new Set(), noul('private:0', 0.1))).ok, true);
  assert.equal((await contacts(all, new Set(), noul('private:0', 0.9))).ok, false);
});
