/// <reference types="node" />
// The review store and identity on this machine, shared by the dev server
// and the CLI: .design-hub/review.json, and a local Studio person named from git.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Person } from '../core/review/model.ts';
import { STATE_DIR } from './paths.ts';

export const LOCAL_STORE = join(STATE_DIR, 'review.json');

function gitName(): string {
  try {
    return execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Whoever runs this machine's dev server or CLI: Studio, because they hold the store itself. */
export const localStudio = (id = 'local', team = 'Local'): Person => ({
  id,
  name: gitName() || 'You',
  team,
  kind: 'studio',
  client: null,
  email: null,
  accessEndsAt: null,
  createdAt: new Date(0).toISOString(),
  revokedAt: null,
  epoch: 0,
});
