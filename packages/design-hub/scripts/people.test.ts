import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// ROOT is fixed when paths.ts loads, so each run is a child process on a throwaway project with no store credentials.
function people(dir: string, positionals: string[], flags: Record<string, unknown>) {
  const script = `import { main } from ${JSON.stringify(join(import.meta.dirname, 'people.ts'))};
try { process.stdout.write(JSON.stringify(await main({ positionals: ${JSON.stringify(positionals)}, flags: ${JSON.stringify(flags)} }))); }
catch (error) { process.stdout.write(JSON.stringify({ error: error.message, fix: error.detail?.fix })); }`;
  const env: Record<string, string | undefined> = { ...process.env, DESIGN_HUB_ROOT: dir };
  for (const name of [
    'KV_REST_API_URL',
    'KV_REST_API_TOKEN',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
  ])
    delete env[name];
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout) as Record<string, unknown>;
}

const project = () => realpathSync(mkdtempSync(join(tmpdir(), 'people-')));
const base = { kind: 'client', name: 'Rae', team: 'Acme', local: false };

test('--site with only the local store refuses to print a link the site would not know', () => {
  const dir = project();
  const refused = people(dir, ['add'], { ...base, site: 'https://hub.example' });
  assert.match(String(refused.error), /store is not configured here/);
  assert.match(String(refused.fix), /KV_REST_API_URL.*--review/);
  const both = people(dir, ['add'], { ...base, local: true, site: 'https://hub.example' });
  assert.match(String(both.error), /--local and --site do not go together/);
  const local = people(dir, ['add'], { ...base, local: true });
  assert.equal(local.store, 'local');
  assert.match(String(local.link), /^\/invite\/[\w-]{43}$/);
});
