import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gateValues, keepingGitignore } from './bootstrap.ts';

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

test('the gate env is the signing secret alone: made once, then kept', () => {
  const made = gateValues({});
  assert.deepEqual(Object.keys(made), ['GATE_SECRET']);
  assert.equal(Buffer.from(made.GATE_SECRET, 'base64').length, 32);
  assert.notEqual(gateValues({}).GATE_SECRET, made.GATE_SECRET);
  // A password left in .env by an older release is neither kept nor returned.
  const old = { [['GATE', 'PASSWORD'].join('_')]: 'old-password', GATE_SECRET: 's'.repeat(44) };
  assert.deepEqual(gateValues(old), { GATE_SECRET: old.GATE_SECRET });
});

const TEMPLATE_GITIGNORE = 'node_modules/\n.vercel/\n.env\n!.env.example\n';

test('.gitignore goes back as it was when a step after vercel link throws', async () => {
  const dir = project();
  const file = join(dir, '.gitignore');
  writeFileSync(file, TEMPLATE_GITIGNORE);
  await assert.rejects(
    keepingGitignore(dir, async () => {
      appendFileSync(file, '.vercel\n.env*\n');
      throw new Error('Could not add the Upstash for Redis store');
    }),
    /Upstash/,
  );
  assert.equal(readFileSync(file, 'utf8'), TEMPLATE_GITIGNORE);
  assert.equal(await keepingGitignore(dir, () => 'linked'), 'linked');
});

// A stand-in for the Vercel CLI: link appends to .gitignore as the real one
// does, and the Upstash integration fails as it does before the terms are
// accepted. FAIL=link makes link fail after it has written.
const FAKE_VERCEL = `#!/bin/sh
case "$1" in
  whoami) echo tester ;;
  link) printf '.vercel\\n.env*\\n' >> .gitignore; [ "$FAIL" = link ] && exit 1 ;;
  integration) [ "$FAIL" = none ] && exit 0; echo 'Error: accept the terms' >&2; exit 1 ;;
esac
exit 0
`;

/** Runs bootstrap's main in a child on `dir` with the fake Vercel CLI; stdout is its result or its error. */
function bootstrapIn(dir: string, fail: string, flags: Record<string, unknown>) {
  const bin = project();
  writeFileSync(join(bin, 'vercel'), FAKE_VERCEL, { mode: 0o755 });
  const script = `import { main } from ${JSON.stringify(join(import.meta.dirname, 'bootstrap.ts'))};
try { process.stdout.write(JSON.stringify(await main({ flags: ${JSON.stringify(flags)}, positionals: [] }))); }
catch (error) { process.stdout.write(error.message); }`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAIL: fail,
      DESIGN_HUB_ROOT: dir,
      DESIGN_HUB_PORTS: join(project(), 'ports.json'),
      DESIGN_HUB_PORT: undefined,
      CONDUCTOR_PORT: undefined,
    },
    encoding: 'utf8',
  });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout;
}

const REVIEW = { vercel: 'acme', review: true, 'no-install': true, branch: 'main' };

for (const [fail, error] of [
  ['link', /vercel link/],
  ['integration', /Upstash/],
] as const)
  test(`bootstrap --review puts .gitignore back when vercel ${fail} fails`, () => {
    const dir = project();
    writeFileSync(join(dir, '.gitignore'), TEMPLATE_GITIGNORE);
    assert.match(bootstrapIn(dir, fail, REVIEW), error);
    assert.equal(readFileSync(join(dir, '.gitignore'), 'utf8'), TEMPLATE_GITIGNORE);
  });

test('bootstrap --vercel makes no password, makes the secret once and keeps it', () => {
  const dir = project();
  writeFileSync(join(dir, '.gitignore'), TEMPLATE_GITIGNORE);
  const first = bootstrapIn(dir, 'none', { ...REVIEW, access: '6m' });
  assert.doesNotMatch(first, /password/i);
  const result = JSON.parse(first);
  assert.equal(result.vercel.env['GATE_SECRET:production'], 'set');
  assert.equal('share' in result, false);
  // The fake store hands back no credentials, so the default is left for `people access`, and said so.
  assert.equal(result.review.access, undefined);
  assert.ok(result.warnings.some((w: string) => /people access --access 6m/.test(w)));
  const secret = envIn(dir).match(/^GATE_SECRET=(.+)$/m)?.[1];
  assert.equal(Buffer.from(secret ?? '', 'base64').length, 32);
  // The secret goes to .env and Vercel's stdin, never into what bootstrap prints.
  assert.equal(first.includes(secret ?? ''), false);
  assert.doesNotMatch(envIn(dir), /PASSWORD/);
  const second = bootstrapIn(dir, 'none', REVIEW);
  assert.equal(second.includes(secret ?? ''), false);
  assert.equal(envIn(dir).match(/^GATE_SECRET=(.+)$/m)?.[1], secret);
});

test('--access needs --review', () => {
  assert.match(
    bootstrapIn(project(), 'none', { 'no-install': true, branch: 'main', access: '3m' }),
    /--access needs --review/,
  );
});
