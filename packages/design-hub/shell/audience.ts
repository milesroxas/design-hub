// What the index decides from the server's answer, kept pure so it is
// tested (shell/audience.test.ts). The answer is the view the person gets
// and the client-facing slugs; the server and the gate decide what reaches
// whom, and nothing here is the boundary.
import type { Audience, Person, PersonKind } from '../core/review/model';

/** The index read (`prototypes`): the view the caller gets, and every client-facing slug. */
export type HubAnswer = { view: PersonKind; clientFacing: string[] };

export const AUDIENCE_LABEL: Record<Audience, string> = { internal: 'Internal', client: 'Client-facing' };

export const audienceIn = (clientFacing: readonly string[], slug: string): Audience =>
  clientFacing.includes(slug) ? 'client' : 'internal';

/** The client-facing list after one prototype is switched, sorted, each slug once. */
export function withAudience(clientFacing: readonly string[], slug: string, audience: Audience): string[] {
  const rest = clientFacing.filter((s) => s !== slug);
  return audience === 'client' ? [...rest, slug].sort() : rest;
}

/** Which slugs the index loads: every one in Studio's view, only the client-facing in a Client's. */
export const slugsFor = (answer: HubAnswer, all: readonly string[]): string[] =>
  answer.view === 'studio' ? [...all] : [...answer.clientFacing];

/**
 * How the index treats the person: Studio outside Client view sees each
 * prototype's audience and its switch; Studio in Client view sees what a
 * Client sees, with the note to leave it; anyone else sees neither.
 */
export function lensOf(me: Pick<Person, 'kind'> | null, view: PersonKind) {
  const studio = me?.kind === 'studio';
  return { controls: studio && view === 'studio', clientView: studio && view === 'client' };
}

/** The empty index, by view: Studio's says how to start one; a Client's says nothing is shared yet. Null when not empty. */
export function emptyState(view: PersonKind, total: number): 'studio' | 'client' | null {
  if (total > 0) return null;
  return view === 'studio' ? 'studio' : 'client';
}

/**
 * Whether a prototype's page shows as missing: in Client view (or for a
 * Client), when the prototype is not client-facing. No answer hides nothing,
 * since the gate already refused it to a Client.
 */
export const hiddenFor = (answer: HubAnswer | null, slug: string): boolean =>
  !!answer && answer.view === 'client' && !answer.clientFacing.includes(slug);
