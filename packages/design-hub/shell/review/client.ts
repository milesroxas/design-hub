// The review UI's one store, and the one way to the API (`call`), which the
// index uses too: who is signed in, this prototype's comments and,
// for Studio, the people. Components read it with useSyncExternalStore and
// call its actions; every call goes to /api/review (server/api.ts), and each
// answer is merged in place, so a write never refetches the list. The list is
// what the server sent for this person: nothing here filters it.
import { useSyncExternalStore } from 'react';
import type { Access, Anchor, Audience, Comment, Person, PersonKind, Scope } from '../../core/review/model';

export type Me = Omit<Person, 'epoch'>;

/**
 * The scope the page judges its own controls in: the person's own. The
 * server answers nothing outside the real one, so this only decides which
 * buttons show.
 */
export const ownScope = (me: Me | null): Scope => ({ client: me?.client ?? '' });
/** off: this site has no review store, so the UI stays out of the way. guest: the session ended since the page loaded. */
type Status = 'loading' | 'ready' | 'guest' | 'off';

type State = {
  status: Status;
  me: Me | null;
  comments: Comment[];
  people: Me[] | null;
  /** The project default access length, loaded with the people. */
  access: Access | null;
  error: string | null;
};

class ApiError extends Error {
  status: number;
  problems: string[];
  /** A 503 with Retry-After: the store did not answer, and review is on. */
  retry: boolean;
  /** The answer was not JSON: no review API answered (`vite preview` serves its page instead). */
  notJson = false;
  constructor(status: number, message: string, problems: string[] = [], retry = false) {
    super(message);
    this.status = status;
    this.problems = problems;
    this.retry = retry;
  }
}

const API = '/api/review';

/** For a click handler: the store shows every failure in the panel, so the handler has nothing left to do with one. */
export const act = (pending: Promise<unknown>) => void pending.catch(() => {});

export async function call<T>(
  op: string,
  body?: Record<string, unknown>,
  params: Record<string, string> = {},
): Promise<T> {
  const response = body
    ? await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, ...body }),
        credentials: 'same-origin',
      })
    : await fetch(`${API}?${new URLSearchParams({ op, ...params })}`, { credentials: 'same-origin' });
  const json = (await response.json().catch(() => null)) as
    | ({ error?: string; problems?: string[] } & T)
    | null;
  if (response.status === 503 && response.headers.has('retry-after'))
    throw new ApiError(503, 'The review store did not answer. Reload in a minute.', [], true);
  if (!json) {
    const error = new ApiError(
      response.status,
      `The review API did not answer with JSON (${response.status}).`,
    );
    error.notJson = true;
    throw error;
  }
  if (!response.ok)
    throw new ApiError(response.status, json.error ?? `Request failed (${response.status}).`, json.problems);
  return json;
}

/**
 * 503 is a site without a review store; 404 is a static preview with no API at all. A 503 with
 * Retry-After is a store that did not answer: review stays on and shows the error.
 */
const isOff = (error: unknown) =>
  error instanceof ApiError && !error.retry && (error.status === 503 || error.status === 404);

/** No review API at all: none set up (`isOff`), or an answer that is not the API's (a static preview's page). */
export const noApi = (error: unknown) => isOff(error) || (error instanceof ApiError && error.notJson);

export function createReviewStore(prototype: string) {
  let state: State = { status: 'loading', me: null, comments: [], people: null, access: null, error: null };
  const listeners = new Set<() => void>();
  /** Counts loads, so an answer to an older one (Client view turned on and off fast) is dropped. */
  let loads = 0;
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };
  const merge = (c: Comment) => {
    const at = state.comments.findIndex((x) => x.id === c.id);
    set({
      comments: at < 0 ? [...state.comments, c] : state.comments.map((x) => (x.id === c.id ? c : x)),
      error: null,
    });
    return c;
  };
  const mergePerson = (p: Me) => {
    if (state.people)
      set({
        people: state.people.some((x) => x.id === p.id)
          ? state.people.map((x) => (x.id === p.id ? p : x))
          : [...state.people, p],
      });
    return p;
  };
  // Every action reports its failure in the store, and rethrows so the caller keeps the user's input.
  const attempt = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      set({
        error:
          error instanceof ApiError && error.problems.length
            ? error.problems.join('. ')
            : String((error as Error).message),
      });
      throw error;
    }
  };
  /** A command that answers with a person and their link: merges the person, resolves to the whole URL. */
  const linkOf = (pending: Promise<{ person: Me; link: string }>) =>
    attempt(async () => {
      const r = await pending;
      mergePerson(r.person);
      return new URL(r.link, location.origin).href;
    });

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => state,

    /** Who is signed in and the comments; `viewAs: 'client'` is Studio's Client view, which the server applies. */
    async load(viewAs?: PersonKind) {
      const n = ++loads;
      try {
        const { person } = await call<{ person: Me | null }>('me');
        if (n !== loads) return;
        if (!person) return set({ status: 'guest', me: null });
        const params = { prototype, ...(viewAs ? { viewAs } : {}) };
        const { comments } = await call<{ comments: Comment[] }>('comments', undefined, params);
        if (n !== loads) return;
        set({ status: 'ready', me: person, comments, error: null });
      } catch (error) {
        if (isOff(error)) set({ status: 'off' });
        else set({ status: 'ready', error: String((error as Error).message) });
      }
    },

    /** A new thread; `audience` is Studio's choice, and the server sets a Client's whatever is sent. */
    add: (body: string, anchor: Anchor, states: string[], audience: Audience | null) =>
      attempt(async () =>
        merge(
          (
            await call<{ comment: Comment }>('comment.add', {
              body,
              anchor,
              states,
              ...(audience ? { audience } : {}),
            })
          ).comment,
        ),
      ),
    reply: (thread: string, body: string) =>
      attempt(async () =>
        merge((await call<{ comment: Comment }>('comment.reply', { prototype, thread, body })).comment),
      ),
    edit: (id: string, body: string) =>
      attempt(async () =>
        merge((await call<{ comment: Comment }>('comment.edit', { prototype, id, body })).comment),
      ),
    resolve: (id: string, resolved: boolean) =>
      attempt(async () =>
        merge((await call<{ comment: Comment }>('comment.resolve', { prototype, id, resolved })).comment),
      ),
    triage: (id: string, triage: { kind: string | null; state: string | null }, states: string[]) =>
      attempt(async () =>
        merge(
          (await call<{ comment: Comment }>('comment.triage', { prototype, id, triage, states })).comment,
        ),
      ),
    remove: (id: string) =>
      attempt(async () => {
        const { removed } = await call<{ removed: string[] }>('comment.remove', { prototype, id });
        set({ comments: state.comments.filter((c) => !removed.includes(c.id)) });
      }),

    loadPeople: () =>
      attempt(async () => {
        const [{ people }, { access }] = await Promise.all([
          call<{ people: Me[] }>('people'),
          call<{ access: Access }>('access'),
        ]);
        set({ people, access });
      }),
    /** A new person; `access` null takes the default for their kind. Resolves to their link. */
    addPerson: (name: string, team: string, kind: PersonKind, access: Access | null) =>
      linkOf(call('people.add', { name, team, kind, ...(access ? { access } : {}) })),
    /** Another one-time link, for another device. */
    newLink: (id: string) => linkOf(call('people.link', { id })),
    /** Ends every session and unused link; resolves to the one new link. */
    signOut: (id: string) => linkOf(call('people.signOut', { id })),
    setAccess: (id: string, access: Access) =>
      attempt(async () => mergePerson((await call<{ person: Me }>('people.access', { id, access })).person)),
    revoke: (id: string) =>
      attempt(async () => mergePerson((await call<{ person: Me }>('people.revoke', { id })).person)),
    clearError: () => set({ error: null }),
  };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;

export const useReviewState = (store: ReviewStore) =>
  useSyncExternalStore(store.subscribe, store.get, store.get);
