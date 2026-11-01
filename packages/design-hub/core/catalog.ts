// What a prototype's README says about it: the frontmatter the index lists
// and the States table the checks read. One reader for the browser index
// (shell/registry.ts) and the Node scripts (scripts/lib/catalog.ts), so
// they never disagree about what a prototype is.
import { frontmatter } from './frontmatter.ts';
import { parseStates, type State } from './states.ts';

export type Kind = 'sprint' | 'alternate' | 'exploration';

export type Meta = {
  slug: string;
  title: string;
  summary: string;
  context: string;
  status: string;
  kind: Kind;
  feature: string;
  created: string;
  /** null when the README has no States section. */
  states: State[] | null;
};

export function readMeta(slug: string, readme: string): Meta {
  const { data } = frontmatter(readme);
  return {
    slug,
    title: data.title || slug,
    summary: data.summary || '',
    context: data.context || 'space',
    status: data.status || 'exploring',
    kind: data.kind === 'sprint' || data.kind === 'alternate' ? data.kind : 'exploration',
    feature: data.feature || '',
    created: data.created || '',
    states: parseStates(readme),
  };
}

export const isLive = (m: Pick<Meta, 'status'>) => m.status !== 'archived';

// Open questions sit above answered ones; within a status, newest first.
const rank = (status: string) => (status === 'exploring' ? 0 : 1);
export const byIndexOrder = (a: Meta, b: Meta) =>
  rank(a.status) - rank(b.status) || b.created.localeCompare(a.created) || a.title.localeCompare(b.title);
