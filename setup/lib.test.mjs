import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bootstrapArgs,
  createArgs,
  explain,
  folderMode,
  hostAllowed,
  parseDeviceCode,
  readPort,
  tildify,
  validateCreate,
} from './lib.mjs';
import { slugify } from './slug.mjs';

const HOME = '/Users/sam';

test('slugify makes a folder name create.mjs accepts', () => {
  assert.equal(slugify('Acme Checkout'), 'acme-checkout');
  assert.equal(slugify('  Café / Menü 2.0!  '), 'cafe-menu-2.0');
  assert.equal(slugify('---'), '');
  assert.match(slugify('x'.repeat(200)), /^x{80}$/);
});

test('tildify shortens only paths under home', () => {
  assert.equal(tildify('/Users/sam/Design/a', HOME), '~/Design/a');
  assert.equal(tildify('/Users/samuel/a', HOME), '/Users/samuel/a');
});

test('readPort reads the PORT line', () => {
  assert.equal(readPort('A=1\nPORT=3104\n'), 3104);
  assert.equal(readPort('PORT="3105"'), 3105);
  assert.equal(readPort('EXPORT=1'), null);
});

test('folderMode: set up opens, a clone sets up in place, a ZIP makes a new project', () => {
  assert.equal(folderMode({ hasPort: true, hasModules: true, hasGit: false }), 'project');
  assert.equal(folderMode({ hasPort: true, hasModules: false, hasGit: true }), 'clone');
  assert.equal(folderMode({ hasPort: false, hasModules: false, hasGit: false }), 'copy');
});

test('validateCreate builds the path and rejects bad fields', () => {
  const ok = validateCreate({ name: 'Acme', visibility: 'local' }, { mode: 'copy', home: HOME });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.path, '/Users/sam/Design/acme');
  const bad = validateCreate(
    {
      name: '!!',
      parent: 'relative',
      visibility: 'x',
      typesafeKey: 'short',
      owner: '-bad',
      template: 'nope',
    },
    { mode: 'copy', home: HOME },
  );
  assert.deepEqual(Object.keys(bad.errors).sort(), [
    'name',
    'owner',
    'parent',
    'template',
    'typesafeKey',
    'visibility',
  ]);
  assert.equal(validateCreate({}, { mode: 'clone', home: HOME }).ok, true);
});

test('createArgs maps local to none and drops the owner there', () => {
  const base = { path: '/p/a', template: 'o/r', owner: 'team' };
  assert.deepEqual(createArgs({ ...base, visibility: 'local' }), [
    '--path',
    '/p/a',
    '--visibility',
    'none',
    '--template',
    'o/r',
  ]);
  assert.deepEqual(createArgs({ ...base, visibility: 'private' }).slice(-2), ['--owner', 'team']);
});

test('bootstrapArgs never installs on the first run', () => {
  assert.deepEqual(bootstrapArgs({}), ['--no-install']);
  assert.deepEqual(bootstrapArgs({ typesafeKey: 'k'.repeat(20), conductorBranch: 'main' }), [
    '--no-install',
    '--typesafe-key',
    'k'.repeat(20),
    '--conductor',
    '--branch',
    'main',
  ]);
});

test('explain turns known failures into plain words and keeps the raw text', () => {
  const e = explain({ ok: false, error: '/x exists and is not empty.' });
  assert.equal(e.message, 'That folder already has files in it.');
  assert.match(e.detail, /not empty/);
  assert.equal(explain({ error: 'Odd.', fix: 'Do y.' }).fix, 'Do y.');
});

test('parseDeviceCode reads what gh prints without a terminal', () => {
  const text =
    '! One-time code (4B12-7915) copied to clipboard\nOpen this URL to continue in your web browser: https://github.com/login/device\n';
  assert.deepEqual(parseDeviceCode(text), { code: '4B12-7915', url: 'https://github.com/login/device' });
  assert.equal(parseDeviceCode('nothing yet'), null);
});

test('hostAllowed accepts only this machine on this port', () => {
  assert.equal(hostAllowed('127.0.0.1:4000', 4000), true);
  assert.equal(hostAllowed('localhost:4000', 4000), true);
  assert.equal(hostAllowed('evil.test:4000', 4000), false);
  assert.equal(hostAllowed('127.0.0.1:4001', 4000), false);
});
