/// <reference types="node" />
// .design-hub/project.json on disk: the project's tracks and website
// platform (core/project.ts has the rules). A project made before tracks
// existed has no file; every reader treats that as "any track", so nothing
// an older project does stops working.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Project, parseProject } from '../core/project.ts';
import { PROJECT_JSON } from './paths.ts';

export type LoadedProject = { project: Project | null; problems: string[] };

export function readProject(file = PROJECT_JSON): LoadedProject {
  if (!existsSync(file)) return { project: null, problems: [] };
  try {
    const parsed = parseProject(JSON.parse(readFileSync(file, 'utf8')));
    return 'project' in parsed
      ? { project: parsed.project, problems: [] }
      : { project: null, problems: parsed.problems };
  } catch (error) {
    return {
      project: null,
      problems: [`${file}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

export function writeProject(project: Project, file = PROJECT_JSON): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
}
