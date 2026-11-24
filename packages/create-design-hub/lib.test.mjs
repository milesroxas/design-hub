import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectManifest, tracksArgs, tracksProblem, validate } from './lib.mjs';

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

test('tracks and platforms are checked before anything is copied', () => {
  assert.equal(tracksProblem({}), null);
  assert.equal(tracksProblem({ track: ['product', 'brand'] }), null);
  assert.equal(tracksProblem({ track: ['website'], platform: 'emdash' }), null);
  assert.equal(tracksProblem({ track: ['website'], platform: 'payload', frontend: 'next' }), null);
  assert.match(tracksProblem({ track: ['app'] }), /--track takes/);
  assert.match(tracksProblem({ track: ['product'], platform: 'webflow' }), /need --track website/);
  assert.match(tracksProblem({ track: ['website'], platform: 'wordpress' }), /needs --frontend/);
  assert.match(
    tracksProblem({ track: ['website'], platform: 'emdash', frontend: 'next' }),
    /always uses astro/,
  );
  assert.match(
    tracksProblem({ track: ['website'], platform: 'webflow', frontend: 'astro' }),
    /drop --frontend/,
  );
  assert.match(tracksProblem({ track: ['website'], frontend: 'astro' }), /needs --platform/);
  assert.ok(validate({ path: '/tmp/x', track: ['app'] }).track);
});

test('the tracks command line drops the other samples', () => {
  assert.deepEqual(tracksArgs({ track: ['website'], platform: 'payload', frontend: 'astro' }), [
    'tracks',
    'set',
    '--track',
    'website',
    '--remove-samples',
    '--platform',
    'payload',
    '--frontend',
    'astro',
  ]);
});
