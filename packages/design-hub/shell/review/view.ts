// What the review layer shows. Pure, so node:test runs it: no React, no DOM
// beyond the Element type a draft points at.

/** A new comment being placed: the element it is about and where on it, as fractions of its box, or neither for the whole page. */
export type Draft = { target: Element | null; offset: { x: number; y: number } | null };

/** Which threads Studio lists: every one, or one audience. Matches core's Audience values. */
export type Filter = 'all' | 'internal' | 'client';

/** The one card on screen: a thread, a comment being written, or the people. */
export type Card = { type: 'thread'; id: string } | { type: 'draft'; draft: Draft } | { type: 'people' };

/**
 * One value, so a transition (start, open a pin, close, hide) changes every
 * field it touches at once and no two fields can disagree. `commenting` is
 * comment mode: pins on the page and a click anywhere starts a comment. Off,
 * the page carries only the button. `hidden` tucks even the button into the
 * screen's edge. `filter` narrows Studio's list by audience, in memory like
 * `resolved`. `clientView` is Studio looking as a Client does: the list is
 * fetched as a Client's and Studio's controls step aside. `hidden` and
 * `clientView` outlive the page (kit/prefs.ts).
 */
export type View = {
  hidden: boolean;
  commenting: boolean;
  card: Card | null;
  resolved: boolean;
  filter: Filter;
  clientView: boolean;
};

export type ViewAction =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'open'; id: string }
  | { type: 'draft'; draft: Draft }
  | { type: 'people' }
  | { type: 'close' }
  | { type: 'escape' }
  | { type: 'resolved' }
  | { type: 'hide' }
  | { type: 'show' }
  | { type: 'filter'; filter: Filter }
  | { type: 'clientView'; on: boolean };

export const initialView = (hidden: boolean, clientView = false): View => ({
  hidden,
  commenting: false,
  card: null,
  resolved: false,
  filter: 'all',
  clientView,
});

export function view(state: View, action: ViewAction): View {
  switch (action.type) {
    case 'start':
      return { ...state, hidden: false, commenting: true };
    case 'stop':
      return { ...state, commenting: false, card: null };
    // A link to a comment opens its thread even when comments are hidden: the link is the request to see it.
    case 'open':
      return { ...state, hidden: false, commenting: true, card: { type: 'thread', id: action.id } };
    case 'draft':
      return { ...state, card: { type: 'draft', draft: action.draft } };
    case 'people':
      return { ...state, commenting: true, card: state.card?.type === 'people' ? null : { type: 'people' } };
    case 'close':
      return { ...state, card: null };
    // Esc steps back one level: the card first, then comment mode.
    case 'escape':
      return state.card ? { ...state, card: null } : { ...state, commenting: false };
    case 'resolved':
      return { ...state, resolved: !state.resolved };
    case 'hide':
      return { ...state, hidden: true, commenting: false, card: null };
    case 'show':
      return { ...state, hidden: false };
    case 'filter':
      return { ...state, filter: action.filter };
    // The other view holds other threads: the card closes, and the filter goes back to all, as a Client has none.
    case 'clientView':
      return { ...state, clientView: action.on, filter: 'all', card: null };
  }
}

/**
 * How the layer looks to this person. `studio` is whether the policy gives
 * them Studio's view. As Studio: audience marks, the filter and the choice on
 * a new thread. In Client view, Studio sees none of that, as a Client does.
 */
export function lensOf(studio: boolean, v: Pick<View, 'clientView'>) {
  return { asStudio: studio && !v.clientView, clientView: studio && v.clientView };
}

const FILTER_NOTE = { internal: 'Internal only', client: 'Client-facing only' } as const;

/**
 * What the bar says while the filter narrows the list, so Studio never
 * forgets a thread is out of sight; null with All, and in Client view, which
 * has no filter.
 */
export function filterNote(v: Pick<View, 'filter' | 'clientView'>): string | null {
  return v.clientView || v.filter === 'all' ? null : FILTER_NOTE[v.filter];
}

/** The threads the filter lets through; in Client view, the list is already a Client's. */
export function filtered<T extends { audience: string }>(
  roots: T[],
  v: Pick<View, 'filter' | 'clientView'>,
): T[] {
  if (v.clientView || v.filter === 'all') return roots;
  return roots.filter((c) => c.audience === v.filter);
}

type Thread = { id: string; status: 'open' | 'resolved' };

/** The threads comment mode steps through: the open ones, the resolved too when shown, and always the open card's, so resolving it never pulls the card away. */
export const roundOf = <T extends Thread>(roots: T[], resolved: boolean, current: string | null): T[] =>
  roots.filter((c) => c.status === 'open' || resolved || c.id === current);

/** The thread `by` steps from `id` in the round, wrapping at both ends. */
export function stepFrom<T extends Thread>(round: T[], id: string, by: number): T | undefined {
  const at = round.findIndex((c) => c.id === id);
  return round[(at + by + round.length) % round.length];
}

/** The thread the card shows, when it shows one. */
export const threadOf = (card: Card | null): string | null => (card?.type === 'thread' ? card.id : null);

/** The comment being placed, when the card is one. */
export const draftOf = (card: Card | null): Draft | null => (card?.type === 'draft' ? card.draft : null);

/** Where the bar's arrows go: on from the open thread, or in from an end when none is open. */
export function stepTarget<T extends Thread>(round: T[], current: string | null, by: number): T | undefined {
  if (current && round.some((c) => c.id === current)) return stepFrom(round, current, by);
  return by > 0 ? round[0] : round.at(-1);
}

/** What a new comment is about: a spot on the page, or the page as a whole. */
export type Scope = 'pin' | 'page';

/** The bar's toggle reads the card: a draft with no element is a page comment, anything else is pinning. */
export const scopeOf = (card: Card | null): Scope => {
  const d = draftOf(card);
  return d && !d.target ? 'page' : 'pin';
};
