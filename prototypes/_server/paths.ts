/// <reference types="node" />
// Where things are, computed once. The scripts and the server resolve paths
// from here, never from the current directory, so `pnpm --dir prototypes <script>` and a
// hook run from the repo root behave the same.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTOTYPES = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
export const REPO = dirname(PROTOTYPES);
export const DOCS = join(REPO, 'docs');
export const SKILLS = join(REPO, '.claude', 'skills');
/** Local state, gitignored: the Jev log and its labels, the dev review store. */
export const STATE_DIR = join(REPO, '.design-hub');
