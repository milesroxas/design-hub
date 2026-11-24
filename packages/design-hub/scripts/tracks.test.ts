import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { removeSamples } from './tracks.ts';

test('only the samples of dropped tracks go, and only when they exist', () => {
  const root = mkdtempSync(join(tmpdir(), 'dh-tracks-'));
  try {
    const prototypes = join(root, 'prototypes');
    const docs = join(root, 'docs');
    for (const slug of ['sample-list', 'sample-page', 'mine']) {
      mkdirSync(join(prototypes, slug), { recursive: true });
      writeFileSync(join(prototypes, slug, 'README.md'), '');
    }
    mkdirSync(join(docs, 'sprints', 'sample'), { recursive: true });
    mkdirSync(join(docs, 'sprints', 'sample-site'), { recursive: true });

    assert.deepEqual(removeSamples(['website'], prototypes, docs, root), [
      'prototypes/sample-list/',
      'docs/sprints/sample/',
    ]);
    assert.equal(existsSync(join(prototypes, 'sample-page')), true);
    assert.equal(existsSync(join(prototypes, 'mine')), true);
    assert.equal(existsSync(join(docs, 'sprints', 'sample-site')), true);
    assert.deepEqual(removeSamples(['website'], prototypes, docs, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
