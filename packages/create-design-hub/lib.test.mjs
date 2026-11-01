import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectManifest, validate } from './lib.mjs';

test('a request needs an absolute path with a repo-safe name', () => {
  assert.deepEqual(validate({ path: '/tmp/my-site' }), {});
  assert.ok(validate({ path: 'my-site' }).path);
  assert.ok(validate({ path: '/tmp/my site' }).path);
  assert.ok(validate({ path: '/tmp/x', visibility: 'secret' }).visibility);
  assert.ok(validate({ path: '/tmp/x', link: 'packages/design-hub' }).link);
});

test('the manifest is named after the folder and pinned to the hub that made it', () => {
  const template = {
    name: 'design-hub-project',
    dependencies: { '@milesroxas/design-hub': 'workspace:*', react: '^19' },
  };
  assert.equal(
    projectManifest(template, { name: 'acme', version: '0.1.0' }).dependencies['@milesroxas/design-hub'],
    '^0.1.0',
  );
  assert.equal(projectManifest(template, { name: 'acme', version: '0.1.0' }).name, 'acme');
  assert.equal(
    projectManifest(template, { name: 'acme', version: '0.1.0', link: '/hub/packages/design-hub' })
      .dependencies['@milesroxas/design-hub'],
    'link:/hub/packages/design-hub',
  );
  assert.equal(template.dependencies['@milesroxas/design-hub'], 'workspace:*');
});
