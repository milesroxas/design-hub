import type { ComponentType } from 'react';
import { byIndexOrder, type Meta, readMeta } from '../_core/catalog';
import { SLUG } from '../_core/feature';
import type { Doc } from './doc';

export type Entry = Meta & { load?: () => Promise<{ default: ComponentType }> };

const readmes = import.meta.glob<string>(['../*/README.md', '!../_*/**', '!../node_modules/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const modules = import.meta.glob<{ default: ComponentType }>([
  '../*/index.tsx',
  '!../_*/**',
  '!../node_modules/**',
]);

// A feature's walkthrough lives with its design doc, at docs/sprints/<feature>/guide.md.
const guideDocs = import.meta.glob<Doc>('../../docs/sprints/*/guide.md', { query: '?doc' });

const slugOf = (path: string) => path.split('/')[1];
const featureOf = (path: string) => path.split('/').at(-2) ?? '';

const loaders = new Map(Object.entries(modules).map(([path, load]) => [slugOf(path), load]));

export const entries: Entry[] = Object.entries(readmes)
  .map(([path, md]): Entry => ({ ...readMeta(slugOf(path), md), load: loaders.get(slugOf(path)) }))
  .sort(byIndexOrder);

export const findEntry = (slug: string) => entries.find((e) => e.slug === slug);

// Only kebab-case folders count, the shape new.ts enforces, so a stray folder never becomes a route.
export const guides = new Map(
  Object.entries(guideDocs)
    .map(([path, load]) => [featureOf(path), load] as const)
    .filter(([feature]) => SLUG.test(feature)),
);

// The prototype a feature's walkthrough opens: the sprint itself, else the first one listed.
export const featureEntry = (feature: string) =>
  entries.find((e) => e.feature === feature && e.kind === 'sprint') ??
  entries.find((e) => e.feature === feature);
