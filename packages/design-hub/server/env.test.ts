import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { devPort, readEnv, writeEnv } from './env.ts';

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

test("Conductor's port wins over .env, and nonsense is no port", () => {
  assert.equal(devPort({ PORT: '3100' }, { CONDUCTOR_PORT: '55030' }), 55030);
  assert.equal(devPort({ PORT: '3100' }, {}), 3100);
  assert.equal(devPort({ PORT: 'x' }, {}), undefined);
});
