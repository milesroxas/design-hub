/// <reference types="node" />
// The project's checks, read once: .design-hub/checks.json when the project
// has one, the package defaults when it does not. The scripts and the dev
// server import `checks` from here; the Vercel function gets its copy bundled
// by the project's api/review.ts.
import { existsSync, readFileSync } from 'node:fs';
import { type Checks, DEFAULT_CHECKS, type Loaded, loadChecks } from '../core/checks.ts';
import { CHECKS_FILE } from './paths.ts';

function readChecks(file = CHECKS_FILE): Loaded {
  if (!existsSync(file)) return { checks: DEFAULT_CHECKS, problems: [] };
  try {
    return loadChecks(JSON.parse(readFileSync(file, 'utf8')));
  } catch (error) {
    return { checks: null, problems: [`${file}: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

const loaded = readChecks();
export const checkProblems = loaded.problems;
/** The validated thresholds, or null when checks.json is invalid (every Jev check is then off). */
export const checks: Checks | null = loaded.checks;
