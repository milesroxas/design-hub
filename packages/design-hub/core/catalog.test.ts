import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byIndexOrder, isLive, readMeta } from './catalog.ts';
import { frontmatter } from './frontmatter.ts';

const readme = (fm: string, body = '') => `---\n${fm}\n---\n\n# X\n${body}`;

test('frontmatter reads flat pairs, strips quotes, and keeps colons in values', () => {
  const { data, body } = frontmatter(readme('title: "A: B"\nsummary: \'One line\'\nempty:'));
  assert.deepEqual(data, { title: 'A: B', summary: 'One line', empty: '' });
  assert.equal(body.trim(), '# X');
  assert.deepEqual(frontmatter('# no frontmatter').data, {});
});

test('readMeta fills defaults and keeps only the known kinds', () => {
  const m = readMeta('my-slug', readme('kind: sprint'));
  assert.deepEqual(
    { title: m.title, context: m.context, status: m.status, kind: m.kind, states: m.states },
    { title: 'my-slug', context: 'space', status: 'exploring', kind: 'sprint', states: null },
  );
  assert.equal(readMeta('x', readme('kind: final')).kind, 'exploration');
  assert.equal(
    readMeta(
      'x',
      readme('kind: alternate', '\n## States\n\n| State | How |\n| --- | --- |\n| Open | click |\n'),
    ).states?.length,
    1,
  );
});

test('open questions sort above answered ones, newest first, then by title', () => {
  const m = (slug: string, status: string, created: string) =>
    readMeta(slug, readme(`title: ${slug}\nstatus: ${status}\ncreated: ${created}`));
  const sorted = [
    m('b', 'decided', '2026-01-02'),
    m('c', 'exploring', '2026-01-01'),
    m('a', 'exploring', '2026-01-03'),
  ].sort(byIndexOrder);
  assert.deepEqual(
    sorted.map((x) => x.slug),
    ['a', 'c', 'b'],
  );
  assert.equal(isLive({ status: 'archived' }), false);
});
