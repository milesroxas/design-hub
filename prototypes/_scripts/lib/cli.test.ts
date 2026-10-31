import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { CliError, type CommandSpec, runCommand } from './cli.ts';

const spec = {
  name: 'demo',
  summary: 'A command for the tests.',
  positionals: [{ name: 'target', description: 'What to act on', required: true }],
  flags: {
    count: { type: 'number', default: 2, description: 'How many.' },
    mode: { type: 'string', choices: ['a', 'b'], description: 'Which mode.' },
    name: { type: 'string', required: true, description: 'Whose.' },
    dry: { type: 'boolean', description: 'Change nothing.' },
    tag: { type: 'list', description: 'Repeatable.' },
  },
  output: '{ ok, seen }',
} as const satisfies CommandSpec;

let printed: unknown[] = [];
const log = console.log;
beforeEach(() => {
  printed = [];
  process.exitCode = 0;
  console.log = (text: string) => printed.push(JSON.parse(text));
});
afterEach(() => {
  console.log = log;
  process.exitCode = 0;
});

const run = (argv: string[], main: (a: unknown) => Record<string, unknown> = (a) => ({ seen: a })) =>
  runCommand(spec, main as never, argv).then(() => printed[0] as Record<string, any>);

test('--help prints the schema as JSON and runs nothing', async () => {
  const out = await run(['--help'], () => {
    throw new Error('ran');
  });
  assert.equal(out.command, 'pnpm demo');
  assert.deepEqual(Object.keys(out.flags), ['--count', '--mode', '--name', '--dry', '--tag']);
});

test('types every flag, with defaults for the missing ones', async () => {
  const out = await run(['x', '--name', 'n', '--tag', 'a', '--tag', 'b', '--dry']);
  assert.deepEqual(out, {
    ok: true,
    seen: { flags: { count: 2, name: 'n', dry: true, tag: ['a', 'b'] }, positionals: ['x'] },
  });
});

test('refuses a bad flag with the fix, and exits 1', async () => {
  for (const [argv, error] of [
    [['x'], '--name is required.'],
    [['x', '--name', 'n', '--count', 'many'], '--count takes a number.'],
    [['x', '--name', 'n', '--mode', 'c'], '--mode takes one of: a, b.'],
    [['--name', 'n'], 'Missing target.'],
  ] as const) {
    printed = [];
    const out = await run([...argv]);
    assert.equal(out.ok, false);
    assert.equal(out.error, error);
    assert.equal(process.exitCode, 1);
  }
  const unknown = await run(['x', '--name', 'n', '--nope']);
  assert.match(unknown.fix, /pnpm demo --help/);
});

test('a result with ok false exits 1; errors carry their detail or problems', async () => {
  assert.equal((await run(['x', '--name', 'n'], () => ({ ok: false, why: 'no' }))).why, 'no');
  assert.equal(process.exitCode, 1);
  printed = [];
  const detailed = await run(['x', '--name', 'n'], () => {
    throw new CliError('Stop.', { fix: 'Do this.' });
  });
  assert.deepEqual(detailed, { ok: false, error: 'Stop.', fix: 'Do this.' });
  printed = [];
  const domain = await run(['x', '--name', 'n'], () => {
    throw Object.assign(new Error('Invalid.'), { problems: ['name: required'] });
  });
  assert.deepEqual(domain, { ok: false, error: 'Invalid.', problems: ['name: required'] });
});
