import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DialStore } from 'dialkit';
import {
  client,
  clientVariants,
  controlField,
  defaultOf,
  dialAudience,
  isControlId,
  keepDials,
  type Marks,
  NO_MARKS,
  readConfig,
  readMarks,
  withDefaults,
  withMark,
} from './controls.ts';

const select = { type: 'select', options: ['comfortable', 'compact'], default: 'comfortable' };

test('a dial is internal until marked: in code with client(), or in the hub, which overrules the code', () => {
  const { dials } = readConfig('Review', {
    fixtures: select,
    density: client(select),
    avatars: client(true),
  });
  assert.deepEqual(dials, [
    { id: 'Review/fixtures', path: ['fixtures'], inCode: 'internal' },
    { id: 'Review/density', path: ['density'], inCode: 'client' },
    { id: 'Review/avatars', path: ['avatars'], inCode: 'client' },
  ]);
  const marks: Marks = { dials: { 'Review/fixtures': 'client', 'Review/density': 'internal' }, variants: [] };
  const audience = Object.fromEntries(dials.map((d) => [d.id, dialAudience(marks, d.id, d.inCode)]));
  assert.deepEqual(audience, {
    'Review/fixtures': 'client',
    'Review/density': 'internal',
    'Review/avatars': 'client',
  });
  assert.equal(dialAudience(NO_MARKS, 'Review/fixtures', 'internal'), 'internal');
});

test('readConfig unwraps every client() and reads folders, a marked folder marking each dial in it', () => {
  const { config, dials } = readConfig('Card', {
    radius: [8, 0, 24, 1],
    shadow: client({ blur: [12, 0, 40, 1], _collapsed: true, tint: { hue: 200 } }),
    motion: { rise: client([220, 0, 600, 10]), ease: { type: 'easing', ease: [0, 0, 1, 1], duration: 0.2 } },
  });
  assert.deepEqual(config, {
    radius: [8, 0, 24, 1],
    shadow: { blur: [12, 0, 40, 1], _collapsed: true, tint: { hue: 200 } },
    motion: { rise: [220, 0, 600, 10], ease: { type: 'easing', ease: [0, 0, 1, 1], duration: 0.2 } },
  });
  assert.deepEqual(
    dials.map((d) => `${d.id} ${d.inCode}`),
    [
      'Card/radius internal',
      'Card/shadow.blur client',
      'Card/shadow.tint.hue client',
      'Card/motion.rise client',
      'Card/motion.ease internal',
    ],
  );
});

test('keepDials leaves out every dial not shown, and a folder with none left', () => {
  const { config } = readConfig('Card', {
    radius: [8, 0, 24, 1],
    shadow: { _collapsed: true, blur: [12, 0, 40, 1], spread: 2 },
    motion: { rise: [220, 0, 600, 10] },
  });
  const kept = keepDials('Card', config, (id) => id === 'Card/shadow.blur');
  assert.deepEqual(kept, { shadow: { blur: [12, 0, 40, 1], _collapsed: true } });
  assert.deepEqual(
    keepDials('Card', config, () => false),
    {},
  );
  assert.deepEqual(
    keepDials('Card', config, () => true),
    config,
  );
});

// Every kind of dial DialKit has, with and without a default of its own.
const EVERY = {
  bare: 0.4,
  slider: [220, 0, 600, 10],
  outside: [900, 0, 600, 10],
  swapped: [5, 10, 0],
  open: [7],
  toggle: true,
  word: 'hello',
  chosen: { type: 'select', options: ['a', 'b'], default: 'b' },
  first: { type: 'select', options: [{ value: 'x', label: 'X' }, 'y'] },
  none: { type: 'select', options: [] },
  color: { type: 'color', default: '#ff0000' },
  black: { type: 'color' },
  text: { type: 'text', default: 'Title' },
  blank: { type: 'text' },
  image: { type: 'image', options: ['/a.png', '/b.png'] },
  pad: { type: 'pad', x: [0.333, 0, 1, 0.01], y: [5, -10, 10] },
  centre: { type: 'pad' },
  spring: { type: 'spring', visualDuration: 0.3, bounce: 0.2 },
  ease: { type: 'easing', ease: [0.2, 0, 0, 1], duration: 0.3 },
  folder: { depth: [2, 0, 8, 1], inner: { on: false } },
};

test('defaultOf is DialKit’s own starting value, for every kind of dial', () => {
  DialStore.registerPanel('every', 'Every', EVERY as any);
  const flat = DialStore.getValues('every') as Record<string, unknown>;
  DialStore.unregisterPanel('every');
  const ours = withDefaults(EVERY, {});
  const flatten = (node: Record<string, unknown>, prefix = ''): Record<string, unknown> =>
    Object.fromEntries(
      Object.entries(node).flatMap(([k, v]) =>
        prefix === '' && k === 'folder'
          ? Object.entries(flatten(v as Record<string, unknown>, 'folder.'))
          : k === 'inner'
            ? Object.entries(flatten(v as Record<string, unknown>, `${prefix}inner.`))
            : [[prefix + k, v]],
      ),
    );
  assert.deepEqual(flatten(ours), flat);
});

test('withDefaults keeps the values DialKit gave and fills the dials it did not draw', () => {
  const config = { fixtures: select, density: select, shadow: { blur: [12, 0, 40, 1], spread: 2 } };
  assert.deepEqual(withDefaults(config, { density: 'compact', shadow: { blur: 30 } }), {
    fixtures: 'comfortable',
    density: 'compact',
    shadow: { blur: 30, spread: 2 },
  });
  assert.equal(defaultOf([3, 0, 10, 1]), 3);
});

test('a Client gets the variants Studio marked, in the prototype’s order, and the first when none is', () => {
  const names = ['Baseline', 'Lift', 'Sink'];
  assert.deepEqual(clientVariants(names, NO_MARKS), ['Baseline']);
  assert.deepEqual(clientVariants(names, { dials: {}, variants: ['Sink', 'Lift'] }), ['Lift', 'Sink']);
  // A mark for a variant the prototype no longer has counts for nothing.
  assert.deepEqual(clientVariants(names, { dials: {}, variants: ['Gone'] }), ['Baseline']);
  assert.deepEqual(clientVariants([], NO_MARKS), []);
});

test('marks read from the store ignore what is not theirs, and withMark switches one', () => {
  const marks = readMarks({
    [controlField('dial', 'Review/density')]: 'client',
    [controlField('dial', 'Review/fixtures')]: 'internal',
    [controlField('dial', 'Review/odd')]: 'yes',
    [controlField('variant', 'Lift')]: 'client',
    [controlField('variant', 'Sink')]: 'internal',
    'thing:x': 'client',
    'dial:': 'client',
    plain: 'client',
  });
  assert.deepEqual(marks, {
    dials: { 'Review/density': 'client', 'Review/fixtures': 'internal' },
    variants: ['Lift'],
  });
  const next = withMark(
    withMark(marks, 'variant', 'Baseline', 'client'),
    'dial',
    'Review/density',
    'internal',
  );
  assert.deepEqual(next.variants, ['Baseline', 'Lift']);
  assert.equal(next.dials['Review/density'], 'internal');
  assert.deepEqual(withMark(next, 'variant', 'Lift', 'internal').variants, ['Baseline']);
});

test('a control id is one trimmed line of at most 200 characters', () => {
  for (const ok of ['Review/density', 'Outline, as legal asked', 'a', 'x'.repeat(200)])
    assert.ok(isControlId(ok), ok);
  for (const bad of ['', ' a', 'a ', 'a\nb', 'a\u0000', 'x'.repeat(201), 3, null, undefined])
    assert.ok(!isControlId(bad), String(bad));
});
