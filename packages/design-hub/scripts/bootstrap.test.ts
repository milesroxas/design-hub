import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gateValues } from './bootstrap.ts';

// ROOT is fixed when paths.ts loads, so each run is a child process on a
// throwaway project and a throwaway registry; the machine's is never touched.
function ensurePortIn(dir: string, registry: string, harness: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DESIGN_HUB_ROOT: dir,
    DESIGN_HUB_PORTS: registry,
    DESIGN_HUB_PORT: undefined,
    CONDUCTOR_PORT: undefined,
    ...harness,
  };
  const script = `import { ensurePort } from ${JSON.stringify(join(import.meta.dirname, 'bootstrap.ts'))};
process.stdout.write(JSON.stringify(ensurePort()));`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout) as { port: number; claimed: boolean; warnings: string[] };
}

const project = () => realpathSync(mkdtempSync(join(tmpdir(), 'ensure-port-')));
const claimsIn = (registry: string) => JSON.parse(readFileSync(registry, 'utf8')).claims;
const envIn = (dir: string) => readFileSync(join(dir, '.env'), 'utf8');

test('a fresh worktree claims a port on its first start, then keeps it', () => {
  const dir = project();
  const registry = join(project(), 'ports.json');
  const first = ensurePortIn(dir, registry);
  assert.equal(first.claimed, true);
  assert.equal(claimsIn(registry)[dir], first.port);
  assert.match(envIn(dir), new RegExp(`^PORT=${first.port}$`, 'm'));
  assert.deepEqual(ensurePortIn(dir, registry), { port: first.port, claimed: false, warnings: [] });
});

test("a .env copied from another checkout gives up that checkout's port", () => {
  const main = project();
  const copy = project();
  const registry = join(project(), 'ports.json');
  const { port } = ensurePortIn(main, registry);
  writeFileSync(join(copy, '.env'), envIn(main));
  const own = ensurePortIn(copy, registry);
  assert.notEqual(own.port, port);
  assert.equal(own.claimed, true);
  assert.match(own.warnings[0], /claimed by/);
  assert.equal(claimsIn(registry)[main], port);
});

test("a harness's port is used as given and never claimed or written", () => {
  const dir = project();
  const registry = join(project(), 'ports.json');
  assert.deepEqual(ensurePortIn(dir, registry, { DESIGN_HUB_PORT: '4987' }), {
    port: 4987,
    claimed: false,
    warnings: [],
  });
  assert.throws(() => readFileSync(registry), /ENOENT/);
  assert.throws(() => envIn(dir), /ENOENT/);
});

test('keeps the password and secret already set, so a second run changes nothing', () => {
  const env = { GATE_PASSWORD: 'kept-password', GATE_SECRET: 's'.repeat(44) };
  assert.deepEqual(gateValues(undefined, env), {
    password: 'kept-password',
    secret: env.GATE_SECRET,
    rotated: false,
  });
  assert.equal(gateValues('kept-password', env).rotated, false);
});

test('a new password given rotates it and keeps the secret', () => {
  const env = { GATE_PASSWORD: 'old-password', GATE_SECRET: 'secret' };
  assert.deepEqual(gateValues('new-password', env), {
    password: 'new-password',
    secret: 'secret',
    rotated: true,
  });
});

test('makes a readable 12-character password and a 32-byte secret when none exist', () => {
  const { password, secret } = gateValues(undefined, {});
  assert.match(password, /^[a-hjkmnp-z2-9]{12}$/);
  assert.equal(Buffer.from(secret, 'base64').length, 32);
  assert.throws(() => gateValues('short', {}), /8 characters or more/);
});
