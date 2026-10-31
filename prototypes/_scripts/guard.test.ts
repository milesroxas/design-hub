import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { PROTOTYPES } from '../_server/paths.ts';
import { changeFromHook, codeFindings, featureOf, hookOutput } from './guard.ts';

const at = (...p: string[]) => join(PROTOTYPES, ...p);
const write = (file: string, added: string, removed = '') => ({ file, added, removed, whole: !removed });

test('a feature is the first folder without a leading underscore', () => {
  assert.equal(featureOf(at('sample-list', 'index.tsx')), 'sample-list');
  assert.equal(featureOf(at('_kit', 'dials.tsx')), null);
  assert.equal(featureOf(at('package.json')), null);
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

test('warns on a kit change and on infrastructure', () => {
  assert.equal(codeFindings(write(at('_kit', 'x.ts'), 'x'))[0].rule, "Fork, don't flex");
  assert.equal(codeFindings(write(at('_server', 'x.ts'), 'x'))[0].level, 'warn');
});

test('names only the dependencies a package.json edit adds', () => {
  const [f] = codeFindings(
    write(at('package.json'), '    "react": "^19.3.1",\n    "zod": "^4.0.0",', '    "react": "^19.3.1",'),
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
