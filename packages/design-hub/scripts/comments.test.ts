import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Comment } from '../core/review/model.ts';
import { renderComments } from './comments.ts';

const author = { id: 'a', name: 'Rae', team: 'Acme' };
const base = { author, createdAt: '', editedAt: null, status: 'open', resolvedBy: null } as const;
const anchor = {
  prototype: 'sample-list',
  feature: 'sample',
  url: '/sample-list/',
  dials: {},
  target: 'main',
  offset: null,
  viewport: { width: 1, height: 1 },
};
const root = (id: string, body: string, triage: Comment['triage']): Comment => ({
  ...base,
  id,
  thread: id,
  body,
  anchor,
  triage,
});

test('groups by README state in table order, then by kind, with replies under their thread', () => {
  const md = renderComments(
    'sample',
    [
      root('1', 'Typo\nin title', { kind: 'copy', state: 'Empty', by: 'jev', confidence: 0.9 }),
      root('2', 'Row jumps', { kind: 'bug', state: 'Real list', by: 'person', confidence: null }),
      root('3', 'Feels heavy', null),
      {
        ...base,
        id: '4',
        thread: '2',
        body: 'Fixed',
        anchor: null,
        triage: null,
        author: { ...author, name: 'Ed' },
      },
    ],
    ['Real list', 'Empty'],
  );
  const headings = md.split('\n').filter((l) => l.startsWith('#'));
  assert.deepEqual(headings, [
    '# Comments: Sample',
    '## Real list',
    '### Bugs',
    '## Empty',
    '### Copy',
    '## No state',
    '### Unsorted',
  ]);
  assert.match(md, /- Rae \(Acme\): Typo in title\. On `\/sample-list\/`, element `main`\. id `1`/);
  assert.match(md, /\n {2}- Ed \(Acme\): Fixed\.\n/);
});

test('summary counts open and resolved threads per prototype', async () => {
  const { summary } = await import('./comments.ts');
  const roots = [
    root('1', 'a', null),
    { ...root('2', 'b', null), status: 'resolved' as const },
    { ...root('3', 'c', null), anchor: { ...anchor, prototype: 'other' } },
  ];
  assert.deepEqual(summary({ store: 'local', roots }), {
    store: 'local',
    prototypes: { 'sample-list': { open: 1, resolved: 1 }, other: { open: 1, resolved: 0 } },
  });
});
