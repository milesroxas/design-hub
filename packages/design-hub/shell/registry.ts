import { allSlugs, entryOf, guideDocs } from 'virtual:design-hub/registry';
import type { ComponentType } from 'react';
import { byIndexOrder, type Meta, readMeta } from '../core/catalog';
import { isPrototypeSlug } from '../core/prototype';
import type { Doc } from './doc';

export type Entry = Meta & { load?: () => Promise<{ default: ComponentType }> };

// The registry module is written by the Vite plugin (vite/registry.ts) from
// the project's prototypes/ and docs/sprints/ folders. In a build every
// prototype is a file of its own, fetched by path, so what reaches this page
// is what the gate let through.

/** One prototype's entry; undefined when the name is no slug or there is none (the gate refused it). Any other failure throws. */
async function readEntry(slug: string): Promise<Entry | undefined> {
  if (!isPrototypeSlug(slug)) return undefined;
  const found = await entryOf(slug);
  return found ? { ...readMeta(slug, found.readme), load: found.load } : undefined;
}

/** One prototype's entry for its page; undefined when it is not there or did not load. */
export const getEntry = (slug: string): Promise<Entry | undefined> => readEntry(slug).catch(() => undefined);

/** The entries for these slugs, in index order: one that is not there is skipped, one that fails otherwise is counted. */
export async function getEntries(slugs: readonly string[]): Promise<{ entries: Entry[]; failed: number }> {
  const loaded = await Promise.allSettled(slugs.map(readEntry));
  const entries = loaded
    .map((r) => (r.status === 'fulfilled' ? r.value : undefined))
    .filter((e): e is Entry => e !== undefined)
    .sort(byIndexOrder);
  return { entries, failed: loaded.filter((r) => r.status === 'rejected').length };
}

/** Every slug, for Studio's view. Built, `_p/all.js` is Studio's alone; a failure to load it throws. */
export const everySlug = (): Promise<string[]> => allSlugs();

export const guides = new Map<string, () => Promise<Doc>>(Object.entries(guideDocs));

// The prototype a feature's walkthrough opens: the sprint itself, else the first one listed.
export const featureEntry = (entries: readonly Entry[], feature: string) =>
  entries.find((e) => e.feature === feature && e.kind === 'sprint') ??
  entries.find((e) => e.feature === feature);
