import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { devPort, harnessPort, readEnv, writeEnv } from './env.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'env-'));

test('reads keys, skipping comments and blanks, and unquotes values', () => {
  const d = dir();
  writeFileSync(join(d, '.env'), '# note\nPORT=3100\n\nNAME="A B"\nEMPTY=\nbad line\n');
  assert.deepEqual(readEnv(d), { PORT: '3100', NAME: 'A B', EMPTY: '' });
  assert.deepEqual(readEnv(dir()), {});
});

test('rewrites a key in place, keeps comments, appends new keys, and a second run changes nothing', () => {
  const d = dir();
  writeFileSync(join(d, '.env'), '# port\nPORT=3000\n# key\nKEY=\n');
  writeEnv(d, { PORT: '3100', NEW: 'x' });
  const once = readFileSync(join(d, '.env'), 'utf8');
  assert.equal(once, '# port\nPORT=3100\n# key\nKEY=\nNEW=x\n');
  writeEnv(d, { PORT: '3100', NEW: 'x' });
  assert.equal(readFileSync(join(d, '.env'), 'utf8'), once);
});

test("a harness's port wins over .env, and nonsense is no port", () => {
  assert.equal(devPort({ PORT: '3100' }, { CONDUCTOR_PORT: '55030' }), 55030);
  assert.equal(devPort({ PORT: '3100' }, {}), 3100);
  assert.equal(devPort({ PORT: 'x' }, {}), undefined);
  assert.equal(devPort({ PORT: '3100' }, { DESIGN_HUB_PORT: '4100', CONDUCTOR_PORT: '55030' }), 4100);
  assert.equal(devPort({ PORT: '3100' }, { PORT: '8080' }), 3100);
  assert.equal(devPort({}, { DESIGN_HUB_PORT: 'x' }), undefined);
});

test('a harness port names its variable; a bare PORT is not one', () => {
  assert.deepEqual(harnessPort({ CONDUCTOR_PORT: '55030' }), { port: 55030, from: 'CONDUCTOR_PORT' });
  assert.deepEqual(harnessPort({ DESIGN_HUB_PORT: '4100', CONDUCTOR_PORT: '55030' }), {
    port: 4100,
    from: 'DESIGN_HUB_PORT',
  });
  assert.equal(harnessPort({ PORT: '8080' }), null);
});
