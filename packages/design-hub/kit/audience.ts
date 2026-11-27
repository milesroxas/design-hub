import { useSyncExternalStore } from 'react';
import { type ControlAudience, type ControlKind, type Marks, NO_MARKS, withMark } from '../core/controls.ts';
import { useClientView } from './prefs';

// Who is looking at this prototype's controls, and what Studio marked on them.
// The hub sets it before the prototype renders (shell/controls.ts); the dials
// and the picker read it. Until it is set, the page is a Client's with nothing
// marked: the narrowest view, so a failed read never shows more.

type Save = (kind: ControlKind, id: string, audience: ControlAudience) => Promise<unknown>;

type Controls = {
  /** The signed-in person is Studio. Client view narrows it (kit/prefs.ts). */
  studio: boolean;
  marks: Marks;
  /** How a mark is stored. Null where nothing stores one: an export, or a preview with no review API. */
  save: Save | null;
  /** The last mark that did not save, said beside the panel until the next one does. */
  failed: string | null;
};

let state: Controls = { studio: false, marks: NO_MARKS, save: null, failed: null };
const listeners = new Set<() => void>();

const set = (patch: Partial<Controls>) => {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The hub's answer for this page. */
export const setControls = (next: Pick<Controls, 'studio' | 'marks' | 'save'>) =>
  set({ ...next, failed: null });

/**
 * What the controls read: `studio` is Studio outside Client view, who gets
 * every dial and variant; `canMark` is whether a mark can be stored here.
 */
export function useControls() {
  const s = useSyncExternalStore(subscribe, () => state);
  const clientView = useClientView();
  const studio = s.studio && !clientView;
  return { studio, canMark: studio && s.save !== null, marks: s.marks, failed: s.failed };
}

const WORD: Record<ControlAudience, string> = { client: 'client-facing', internal: 'internal' };

/**
 * Studio's switch on one dial or variant. The mark shows at once; a save that
 * fails puts back that one control and says so.
 */
export async function markControl(kind: ControlKind, id: string, audience: ControlAudience) {
  const { save, marks } = state;
  if (!save) return;
  const before = kind === 'dial' ? marks.dials[id] : marks.variants.includes(id) ? 'client' : 'internal';
  set({ marks: withMark(marks, kind, id, audience), failed: null });
  try {
    await save(kind, id, audience);
  } catch (error) {
    set({
      marks: undo(state.marks, kind, id, before),
      failed: `Could not mark it ${WORD[audience]}. ${(error as Error).message}`,
    });
  }
}

/** The marks with one control back as it was: a dial nobody had marked goes back to having no mark. */
function undo(marks: Marks, kind: ControlKind, id: string, before: ControlAudience | undefined): Marks {
  if (before) return withMark(marks, kind, id, before);
  const { [id]: _gone, ...dials } = marks.dials;
  return { ...marks, dials };
}
