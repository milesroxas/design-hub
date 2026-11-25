import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PACKAGE } from '../../server/paths.ts';
import { cachedLatest, decide, newer, report, SESSION_HOOK, withSessionHook } from './update.ts';

test('only a higher release counts as newer', () => {
  assert.equal(newer('0.5.0', '0.4.3'), true);
  assert.equal(newer('0.10.0', '0.9.9'), true);
  assert.equal(newer('1.0.0', '0.99.99'), true);
  assert.equal(newer('0.4.3', '0.4.3'), false);
  assert.equal(newer('0.4.2', '0.4.3'), false);
  assert.equal(newer('0.5.0-beta.1', '0.4.3'), false);
  assert.equal(newer('0.5.0', 'x'), false);
});

const base = { spec: '^0.4.3', installed: '0.4.3', latest: '0.5.0', disabled: false };

test('an npm-installed project behind latest upgrades to latest', () => {
  assert.deepEqual(decide(base), { upgrade: '0.5.0' });
});

test('every other project is left alone, saying why', () => {
  assert.match((decide({ ...base, spec: null }) as { skip: string }).skip, /not a Design Hub/);
  assert.match((decide({ ...base, spec: 'workspace:*' }) as { skip: string }).skip, /linked/);
  assert.match((decide({ ...base, spec: 'link:../hub' }) as { skip: string }).skip, /linked/);
  assert.match((decide({ ...base, installed: null }) as { skip: string }).skip, /pnpm install/);
  assert.match((decide({ ...base, latest: null }) as { skip: string }).skip, /npm not reachable/);
  assert.deepEqual(decide({ ...base, latest: '0.4.3' }), { skip: 'up to date' });
  assert.deepEqual(decide({ ...base, disabled: true }), {
    skip: 'DESIGN_HUB_AUTO_UPDATE=0',
    available: '0.5.0',
  });
});

test('the session hook is added once, beside the hooks already there', () => {
  const own = { matcher: 'startup', hooks: [{ type: 'command', command: 'echo hi' }] };
  const settings = { hooks: { SessionStart: [own], PostToolUse: [] }, env: { A: '1' } };
  const next = withSessionHook(settings);
  assert.deepEqual(next?.hooks?.SessionStart, [own, SESSION_HOOK]);
  assert.deepEqual(next?.hooks?.PostToolUse, []);
  assert.deepEqual(next?.env, { A: '1' });
  assert.equal(withSessionHook(next ?? {}), null);
  assert.deepEqual(withSessionHook({})?.hooks?.SessionStart, [SESSION_HOOK]);
});

test("the template's settings carry the same session hook", () => {
  const file = join(PACKAGE, '..', 'create-design-hub', 'template', '.claude', 'settings.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).hooks.SessionStart, [SESSION_HOOK]);
});

test('each outcome tells the user one line and the agent what to do', () => {
  const up = report({
    kind: 'upgraded',
    from: '0.4.3',
    to: '0.5.0',
    changed: ['package.json', 'pnpm-lock.yaml'],
  });
  assert.equal(up.systemMessage, 'Design Hub upgraded 0.4.3 to 0.5.0.');
  assert.match(up.additionalContext, /package\.json, pnpm-lock\.yaml/);
  assert.match(up.additionalContext, /Upgrade Design Hub to 0\.5\.0/);
  assert.match(
    report({ kind: 'upgraded', from: 'a', to: 'b', changed: [] }).additionalContext,
    /changed: none/,
  );
  const failed = report({ kind: 'failed', from: '0.4.3', to: '0.5.0', error: 'pnpm add exited 1' });
  assert.match(failed.systemMessage, /failed/);
  assert.match(failed.additionalContext, /pnpm add exited 1/);
  assert.match(
    report({ kind: 'available', from: '0.4.3', to: '0.5.0' }).systemMessage,
    /automatic upgrades are off/,
  );
});

test('the cached latest is used for an hour, then npm is asked again', () => {
  const cached = { version: '0.5.0', at: 1_000_000 };
  assert.equal(cachedLatest(cached, 1_000_000 + 59 * 60_000), '0.5.0');
  assert.equal(cachedLatest(cached, 1_000_000 + 61 * 60_000), null);
  assert.equal(cachedLatest(null, 0), null);
});
