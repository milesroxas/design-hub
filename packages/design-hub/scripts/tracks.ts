#!/usr/bin/env node
/// <reference types="node" />
// `design-hub tracks`: what kind of engagement the project is. `set` writes
// .design-hub/project.json (the tracks, and for a website its platform and
// front end); with --remove-samples it also drops the sample prototype and
// walkthrough of every track the project does not have, which is what setup
// wants and nothing later should do unasked.
import { existsSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  FRONTENDS,
  makeProject,
  needsPlatform,
  PLATFORMS,
  type Project,
  samplesOutside,
  TRACKS,
  type Track,
} from '../core/project.ts';
import { DOCS, PROJECT_JSON, PROTOTYPES, ROOT } from '../server/paths.ts';
import { readProject, writeProject } from '../server/project.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';

export const spec = {
  name: 'tracks',
  summary: "Show or set the project's tracks (product, website, brand) and its website platform.",
  positionals: [{ name: 'action', description: 'show (default): what project.json says. set: write it.' }],
  flags: {
    track: {
      type: 'list',
      description: `For set: a track, repeated for several. One of: ${TRACKS.join(', ')}.`,
    },
    platform: {
      type: 'string',
      choices: PLATFORMS,
      description: 'For set, with the website track: where the site is built.',
    },
    frontend: {
      type: 'string',
      choices: FRONTENDS,
      description:
        'For set: the front end, for Payload or WordPress. Webflow takes none; EmDash is always Astro.',
    },
    'remove-samples': {
      type: 'boolean',
      description: 'For set: delete the sample prototype and walkthrough of every track not set. Setup only.',
    },
  },
  output: '{ ok, tracks, website?, file, removed?, warnings }',
} as const satisfies CommandSpec;

/** Deletes the samples of the tracks a project does not keep; returns what went, relative to the project. */
export function removeSamples(keep: readonly Track[], prototypes = PROTOTYPES, docs = DOCS, root = ROOT) {
  const removed: string[] = [];
  for (const { slug, feature } of samplesOutside(keep)) {
    for (const dir of [join(prototypes, slug), join(docs, 'sprints', feature)]) {
      if (!existsSync(dir)) continue;
      rmSync(dir, { recursive: true, force: true });
      removed.push(`${relative(root, dir)}/`);
    }
  }
  return removed;
}

const warningsFor = (project: Project) =>
  needsPlatform(project)
    ? ['The website track has no platform yet. Set it with --platform before porting: miles-port needs it.']
    : [];

function show() {
  const { project, problems } = readProject();
  if (problems.length)
    throw new CliError('project.json is invalid.', {
      problems,
      fix: 'Rewrite it with design-hub tracks set.',
    });
  if (!project)
    return {
      tracks: [],
      file: relative(ROOT, PROJECT_JSON),
      warnings: [
        'No tracks recorded: every track is allowed. Record them with design-hub tracks set --track <track>.',
      ],
    };
  return { ...project, file: relative(ROOT, PROJECT_JSON), warnings: warningsFor(project) };
}

function set({ flags }: Args<typeof spec>) {
  const made = makeProject(flags.track, { platform: flags.platform, frontend: flags.frontend });
  if ('problems' in made)
    throw new CliError(made.problems.join(' '), { fix: 'design-hub tracks --help lists the choices.' });
  writeProject(made.project);
  const removed = flags['remove-samples'] ? removeSamples(made.project.tracks) : undefined;
  return {
    ...made.project,
    file: relative(ROOT, PROJECT_JSON),
    ...(removed ? { removed } : {}),
    warnings: warningsFor(made.project),
  };
}

export function main(args: Args<typeof spec>) {
  const [action = 'show'] = args.positionals;
  if (action === 'show') return show();
  if (action === 'set') return set(args);
  throw new CliError(`Unknown action ${action}.`, { fix: 'Use show or set.' });
}
