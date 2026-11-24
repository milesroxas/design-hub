import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readProject, writeProject } from './project.ts';

test('project.json round-trips, and a missing file means any track', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dh-project-'));
  try {
    const file = join(dir, '.design-hub', 'project.json');
    assert.deepEqual(readProject(file), { project: null, problems: [] });
    writeProject({ tracks: ['product', 'website'], website: { platform: 'webflow', host: 'webflow' } }, file);
    assert.deepEqual(readProject(file).project, {
      tracks: ['product', 'website'],
      website: { platform: 'webflow', host: 'webflow' },
    });
    writeFileSync(file, '{ "tracks": ["app"] }');
    assert.match(readProject(file).problems[0], /Unknown track/);
    writeFileSync(file, 'not json');
    assert.equal(readProject(file).project, null);
    assert.equal(readProject(file).problems.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
