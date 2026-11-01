import { guideDocs, modules, readmes } from 'virtual:design-hub/registry';
import type { ComponentType } from 'react';
import { byIndexOrder, type Meta, readMeta } from '../core/catalog';
import type { Doc } from './doc';

export type Entry = Meta & { load?: () => Promise<{ default: ComponentType }> };

// The registry module is written by the Vite plugin (vite/registry.ts) from
// the project's prototypes/ and docs/sprints/ folders.
export const entries: Entry[] = Object.entries(readmes)
  .map(([slug, md]): Entry => ({ ...readMeta(slug, md), load: modules[slug] }))
  .sort(byIndexOrder);

export const findEntry = (slug: string) => entries.find((e) => e.slug === slug);

export const guides = new Map<string, () => Promise<Doc>>(Object.entries(guideDocs));

// The prototype a feature's walkthrough opens: the sprint itself, else the first one listed.
export const featureEntry = (feature: string) =>
  entries.find((e) => e.feature === feature && e.kind === 'sprint') ??
  entries.find((e) => e.feature === feature);
