#!/usr/bin/env node
/// <reference types="node" />
// Scaffolds a prototype from _templates/ (a Space, or --app inside the
// shell), or a feature's walkthrough at docs/sprints/<feature>/guide.md.
// A feature has one primary prototype (--sprint); --alternate is refused
// until it exists, so the index always has a primary to show first.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { featureTitle, guideHref, SLUG } from '../_core/feature.ts';
import { devPort, readEnv } from '../_server/env.ts';
import { DOCS, PROTOTYPES, REPO } from '../_server/paths.ts';
import { primaryOf } from './lib/catalog.ts';
import { type Args, CliError, type CommandSpec, isMain, runCommand } from './lib/cli.ts';

export const spec = {
  name: 'new',
  summary: 'Scaffold a prototype folder, or with --guide a feature walkthrough.',
  positionals: [
    { name: 'slug', description: 'kebab-case folder name (with --guide: the feature)', required: true },
  ],
  flags: {
    app: { type: 'boolean', description: 'Inside the product or site shell instead of the Space.' },
    sprint: { type: 'boolean', description: "The feature's one primary prototype. Needs --feature." },
    alternate: {
      type: 'boolean',
      description: 'Another take on the primary. Needs --feature and a primary.',
    },
    feature: { type: 'string', description: 'The feature slug: the folder under docs/sprints/.' },
    title: { type: 'string', description: 'Display title. Default: the slug in sentence case.' },
    guide: { type: 'boolean', description: 'Scaffold docs/sprints/<feature>/guide.md instead.' },
  },
  output: '{ ok, created, url, next }',
} as const satisfies CommandSpec;

const created = () => new Date().toISOString().slice(0, 10);
const localUrl = (path: string) => `http://localhost:${devPort(readEnv(PROTOTYPES)) ?? '<port>'}${path}`;

/** Copies a template file or folder and fills its {{placeholders}}. */
function scaffold(src: string, dest: string, vars: Record<string, string>): void {
  if (existsSync(dest)) throw new CliError(`${relative(REPO, dest)} already exists.`);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  const files = statSync(dest).isDirectory() ? readdirSync(dest).map((f) => join(dest, f)) : [dest];
  for (const path of files) {
    let text = readFileSync(path, 'utf8');
    for (const [key, value] of Object.entries(vars)) text = text.replaceAll(`{{${key}}}`, () => value);
    writeFileSync(path, text);
  }
}

function guide(feature: string) {
  if (!SLUG.test(feature)) throw new CliError('The feature is a kebab-case slug.', { got: feature });
  const dest = join(DOCS, 'sprints', feature, 'guide.md');
  scaffold(join(PROTOTYPES, '_templates', 'guide.md'), dest, {
    feature,
    title: featureTitle(feature),
    created: created(),
  });
  return {
    created: relative(REPO, dest),
    url: localUrl(guideHref(feature)),
    next: `Write it from the States table. Screenshots go in docs/sprints/${feature}/assets/guide/.`,
  };
}

type Kind = 'sprint' | 'alternate' | 'exploration';

/** The kind the flags ask for, refused when the feature's state does not allow it. */
export function kindFor(
  flags: Pick<Args<typeof spec>['flags'], 'sprint' | 'alternate'>,
  feature: string,
  primary = (f: string) => primaryOf(f)?.slug,
): Kind {
  if (flags.sprint && flags.alternate) throw new CliError('Pick one of --sprint and --alternate.');
  const kind: Kind = flags.sprint ? 'sprint' : flags.alternate ? 'alternate' : 'exploration';
  if (kind === 'exploration') return kind;
  if (!feature)
    throw new CliError(`A ${kind} prototype names its feature.`, { fix: 'Add --feature <feature>.' });
  const existing = primary(feature);
  if (kind === 'sprint' && existing)
    throw new CliError(`${feature} already has its primary prototype, ${existing}/.`, {
      fix: 'Use --alternate for another take on it.',
    });
  if (kind === 'alternate' && !existing)
    throw new CliError(`${feature} has no primary prototype yet.`, {
      fix: 'Start it with --sprint, then add alternates.',
    });
  return kind;
}

function prototype(slug: string, { flags }: Args<typeof spec>) {
  if (!SLUG.test(slug)) throw new CliError('The slug is kebab-case.', { got: slug });
  if (slug === 'guide') throw new CliError('guide/ is the walkthrough route; pick another slug.');
  const feature = flags.feature ?? '';
  if (feature && !SLUG.test(feature))
    throw new CliError('--feature takes a kebab-case slug.', { got: feature });
  const kind = kindFor(flags, feature);
  const context = flags.app ? 'app' : 'space';
  scaffold(join(PROTOTYPES, '_templates', context), join(PROTOTYPES, slug), {
    title: flags.title ?? featureTitle(slug),
    slug,
    created: created(),
    kind,
    feature,
  });
  return {
    created: `prototypes/${slug}/`,
    context,
    kind,
    feature,
    url: localUrl(`/${slug}/`),
    next: `Write the Problem, Question and States in prototypes/${slug}/README.md before any code.`,
  };
}

export function main(args: Args<typeof spec>) {
  const [slug] = args.positionals;
  return args.flags.guide ? guide(slug) : prototype(slug, args);
}

if (isMain(import.meta.url)) await runCommand(spec, main);
