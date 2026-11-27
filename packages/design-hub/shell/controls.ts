// A prototype page's one read of its controls, handed to the kit before the
// prototype renders (kit/audience.ts): the view the server gives this person
// and what Studio marked on the dials and variants. The page is the person's
// own view; Client view narrows it in the kit, with no second read.
import { setControls } from '@kit/audience';
import { type ControlAudience, type ControlKind, type Marks, NO_MARKS } from '../core/controls';
import type { PersonKind } from '../core/review/model';
import { call, noApi } from './review/client';

/** `design-hub export` captures the prototype as Studio tuned it: every dial, nothing to mark. */
export const exportControls = () => setControls({ studio: true, marks: NO_MARKS, save: null });

export async function loadControls(prototype: string) {
  const save = (kind: ControlKind, id: string, audience: ControlAudience) =>
    call('control.audience', { prototype, kind, id, audience });
  try {
    const { view, dials, variants } = await call<{ view: PersonKind } & Marks>('controls', undefined, {
      prototype,
    });
    setControls({ studio: view === 'studio', marks: { dials, variants }, save });
  } catch (error) {
    // No review API at all (a local preview of the build) is Studio's view, as on the index, with nowhere to keep a mark.
    // Any other failure leaves the narrowest view: a Client's, with nothing marked.
    setControls({ studio: noApi(error), marks: NO_MARKS, save: null });
  }
}
