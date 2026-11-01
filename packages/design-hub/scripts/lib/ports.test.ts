import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Holder, pickPort, readClaims, writeClaim } from './ports.ts';

const dir = '/work/hub';
const none = () => null;
const range = [3000, 3005] as const;

test('keeps the current port when nobody else holds or claims it', () => {
  assert.deepEqual(pickPort({ dir, current: 3002, claims: {}, holder: none, range }), {
    ok: true,
    port: 3002,
    warnings: [],
  });
});

test('skips a port another project claims even when its server is stopped', () => {
  const r = pickPort({ dir, claims: { '/work/site': 3000 }, holder: none, range });
  assert.equal(r.ok && r.port, 3001);
});

test('leaves the current port, with a warning, when another project claims it', () => {
  const r = pickPort({ dir, current: 3000, claims: { '/work/site': 3000 }, holder: none, range });
  assert.ok(r.ok);
  assert.equal(r.port, 3001);
  assert.match(r.warnings[0], /claimed by \/work\/site/);
});

test('treats its own running server as no conflict', () => {
  const own: Holder = { pid: 1, command: 'node', cwd: dir };
  assert.equal(pickPort({ dir, current: 3000, claims: {}, holder: () => own, range }).ok, true);
});

test('refuses a wanted port another process holds, naming it', () => {
  const other: Holder = { pid: 9, command: 'node', cwd: '/elsewhere' };
  const r = pickPort({ dir, wanted: 3004, claims: {}, holder: (p) => (p === 3004 ? other : null), range });
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.detail.holder, other);
});

test('refuses a wanted port another project claims', () => {
  const r = pickPort({ dir, wanted: 3001, claims: { '/work/site': 3001 }, holder: none, range });
  assert.equal(r.ok, false);
});

test('fails when the whole range is taken', () => {
  const claims = Object.fromEntries([3000, 3001, 3002, 3003, 3004, 3005].map((p) => [`/p${p}`, p]));
  assert.equal(pickPort({ dir, claims, holder: none, range }).ok, false);
});

test('writes claims and drops folders that no longer exist', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ports-')), 'ports.json');
  const real = mkdtempSync(join(tmpdir(), 'proj-'));
  writeClaim(real, 3100, file);
  writeClaim('/does/not/exist', 3101, file);
  assert.deepEqual(readClaims(file), { [real]: 3100 });
  assert.ok(JSON.parse(readFileSync(file, 'utf8')).claims[real] === 3100);
});

test('refuses a registry that is not JSON, rather than overwriting every claim', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'ports-')), 'ports.json');
  writeFileSync(file, '{ not json');
  assert.throws(() => readClaims(file), /is not valid JSON/);
});
