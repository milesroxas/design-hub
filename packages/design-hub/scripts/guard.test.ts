import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { KIT, PROTOTYPES, ROOT } from '../server/paths.ts';
import { changeFromHook, codeFindings, featureOf, hookOutput, standsOnBoard, viewFindings } from './guard.ts';

const at = (...p: string[]) => join(PROTOTYPES, ...p);
const write = (file: string, added: string, removed = '') => ({ file, added, removed, whole: !removed });

test('a feature is a folder under prototypes/, and nothing else is one', () => {
  assert.equal(featureOf(at('sample-list', 'index.tsx')), 'sample-list');
  assert.equal(featureOf(join(KIT, 'dials.tsx')), null);
  assert.equal(featureOf(join(ROOT, 'package.json')), null);
  assert.equal(featureOf(at('README.md')), null);
});

test('blocks an import that leaves the feature folder', () => {
  const [f] = codeFindings(write(at('a', 'index.tsx'), "import { X } from '../b/index.tsx';"));
  assert.equal(f.level, 'block');
  assert.equal(f.rule, 'Low gravity');
});

test('allows @kit, packages and its own folder', () => {
  const code =
    "import a from '@kit/ui';\nimport b from 'react';\nimport c from './rows.tsx';\nimport d from './parts/x';";
  assert.deepEqual(codeFindings(write(at('a', 'index.tsx'), code)), []);
});

test('warns on a kit change and says nothing about the rest of the project', () => {
  assert.equal(codeFindings(write(join(KIT, 'x.ts'), 'x'))[0].rule, "Fork, don't flex");
  assert.deepEqual(codeFindings(write(join(ROOT, 'docs', 'x.md'), 'x')), []);
});

test('names only the dependencies a package.json edit adds', () => {
  const [f] = codeFindings(
    write(
      join(ROOT, 'package.json'),
      '    "react": "^19.3.1",\n    "zod": "^4.0.0",',
      '    "react": "^19.3.1",',
    ),
  );
  assert.match(f.note, /^adds zod;/);
});

test('reads Write, Edit and MultiEdit inputs', () => {
  assert.equal(changeFromHook({ tool_input: { file_path: '/x', content: 'a' } })?.whole, true);
  assert.equal(
    changeFromHook({ tool_input: { file_path: '/x', old_string: 'a', new_string: 'b' } })?.added,
    'b',
  );
  const multi = changeFromHook({
    tool_input: {
      file_path: '/x',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'd' },
      ],
    },
  });
  assert.equal(multi?.added, 'b\nd');
  assert.equal(changeFromHook({}), null);
});

test('a warning is context; a block also carries the decision', () => {
  const warn = { file: 'f', rule: 'r', level: 'warn', note: 'n' } as const;
  assert.equal(hookOutput([]), null);
  assert.equal(hookOutput([warn])?.decision, undefined);
  assert.equal(hookOutput([warn, { ...warn, level: 'block' }])?.decision, 'block');
});

test('Jev findings: warn at warnAt, block at blockAt, nothing below; only for code files', async () => {
  const { jevFindings } = await import('./guard.ts');
  const ask = (p: Record<string, number>) =>
    (async () => ({
      answers: Object.fromEntries(Object.entries(p).map(([k, noul]) => [k, { type: 'noul', noul }])),
      ids: Object.fromEntries(Object.keys(p).map((k) => [k, `id-${k}`])),
    })) as never;
  const change = write(at('sample-list', 'index.tsx'), 'fetch("/x")');
  const found = await jevFindings(
    change,
    'sample-list',
    ask({ fetching: 0.95, abstraction: 0.75, handling: 0.2, state: 0.1 }),
  );
  assert.deepEqual(
    found.map((f) => [f.rule, f.level, f.id]),
    [
      ['Fixtures, never a backend', 'block', 'id-fetching'],
      ['No abstraction for later', 'warn', 'id-abstraction'],
    ],
  );
  assert.deepEqual(
    await jevFindings(write(at('sample-list', 'styles.css'), 'a{}'), 'sample-list', ask({ fetching: 1 })),
    [],
  );
});

test('a prototype never mounts the View tools itself, whatever it stands on', () => {
  const code = "import { ViewTools } from '@kit/ViewTools';";
  for (const board of [false, true]) {
    const [f] = viewFindings(write(at('a', 'index.tsx'), code), board);
    assert.equal(f.level, 'block');
    assert.equal(f.rule, 'View tools fit what the prototype is');
  }
  assert.deepEqual(
    viewFindings(write(at('a', 'index.tsx'), "import { Space } from '@kit/Space';"), false),
    [],
  );
});

test('a board holds no motion and no theme styles; anywhere else both pass', () => {
  const moving = [
    '.piece { transition: transform 200ms ease; }',
    '.piece { animation: rise 1s both; }',
    '.piece { transition-duration: 200ms; }',
    '@keyframes rise { from { opacity: 0; } }',
    "import { motion } from 'motion/react';",
  ];
  const themed = [
    '.dark-mode .piece { color: white; }',
    '@media (prefers-color-scheme: dark) {}',
    'const dark = useDark();',
  ];
  for (const added of [...moving, ...themed]) {
    const css = write(at('a', 'styles.css'), added);
    assert.equal(viewFindings(css, true)[0]?.level, 'warn', added);
    assert.deepEqual(viewFindings(css, false), [], added);
  }
  assert.match(viewFindings(write(at('a', 'styles.css'), moving[0]), true)[0].note, /Space prototype/);
  assert.match(viewFindings(write(at('a', 'styles.css'), themed[0]), true)[0].note, /Tone dial/);
  // Turning motion off is not motion, and a word in prose is not a declaration.
  for (const still of [
    '.piece { transition: none; animation: none; }',
    '/* no transition here */',
    '.transitional { color: red; }',
  ])
    assert.deepEqual(viewFindings(write(at('a', 'styles.css'), still), true), [], still);
});

test('a prototype stands on a board when its change or its own index imports the Artboard', () => {
  assert.equal(
    standsOnBoard(write(at('a', 'index.tsx'), "import { Board } from '@kit/Artboard';"), 'a'),
    true,
  );
  // A stylesheet is judged by its feature's index.tsx; with none on disk, it is not a board.
  assert.equal(standsOnBoard(write(at('never-made', 'styles.css'), '.x {}'), 'never-made'), false);
});
