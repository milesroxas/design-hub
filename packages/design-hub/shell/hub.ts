// The index's one read and its one write, over the review API. The index is
// built from the server's answer (shell/audience.ts): Studio's view loads
// every slug, then each entry; a Client's view loads only the client-facing
// entries. An entry that is not there is skipped; one that fails otherwise is counted. Nothing here filters as
// the boundary: the server and the gate decide what reaches whom.
import type { Audience, PersonKind } from '../core/review/model';
import { type HubAnswer, slugsFor } from './audience';
import { type Entry, everySlug, getEntries } from './registry';
import { call, type Me, noApi } from './review/client';

/** `failed` counts entries that did not load for a reason other than not being there. */
export type Hub = HubAnswer & { me: Me | null; entries: Entry[]; failed: number };

/** Who is signed in and the index read. With no review API at all (a local preview of the build), Studio's view. */
export async function readHub(viewAs?: PersonKind): Promise<HubAnswer & { me: Me | null }> {
  try {
    const { person } = await call<{ person: Me | null }>('me');
    const answer = await call<HubAnswer>('prototypes', undefined, viewAs ? { viewAs } : {});
    return { me: person, ...answer };
  } catch (error) {
    if (noApi(error)) return { me: null, view: 'studio', clientFacing: [] };
    throw error;
  }
}

/** The index, as the server says this person sees it: Client view when `clientView` is on. */
export async function loadHub(clientView: boolean): Promise<Hub> {
  const answer = await readHub(clientView ? 'client' : undefined);
  // Studio's list failing to load is an error, never an empty index.
  const all = answer.view === 'studio' ? await everySlug() : [];
  return { ...answer, ...(await getEntries(slugsFor(answer, all))) };
}

/** Studio's switch: marks one prototype client-facing or internal. */
export const saveAudience = (prototype: string, audience: Audience) =>
  call<{ prototype: string; audience: Audience }>('prototype.audience', { prototype, audience });
