// The review UI's one store: who is signed in, this prototype's comments and,
// for editors, the people. Components read it with useSyncExternalStore and
// call its actions; every call goes to /api/review (server/api.ts), and each
// answer is merged in place, so a write never refetches the list.
import { useSyncExternalStore } from 'react';
import type { Anchor, Comment, Person, Role } from '../../core/review/model';

export type Me = Omit<Person, 'epoch'>;
/** off: this site has no review store, so the UI stays out of the way. */
type Status = 'loading' | 'ready' | 'guest' | 'off';

type State = {
  status: Status;
  me: Me | null;
  comments: Comment[];
  people: Me[] | null;
  error: string | null;
};

class ApiError extends Error {
  status: number;
  problems: string[];
  constructor(status: number, message: string, problems: string[] = []) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

const API = '/api/review';

async function call<T>(
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
  if (!json)
    throw new ApiError(response.status, `The review API did not answer with JSON (${response.status}).`);
  if (!response.ok)
    throw new ApiError(response.status, json.error ?? `Request failed (${response.status}).`, json.problems);
  return json;
}

export function createReviewStore(prototype: string) {
  let state: State = { status: 'loading', me: null, comments: [], people: null, error: null };
  const listeners = new Set<() => void>();
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

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => state,

    async load() {
      try {
        const { person } = await call<{ person: Me | null }>('me');
        if (!person) return set({ status: 'guest', me: null });
        const { comments } = await call<{ comments: Comment[] }>('comments', undefined, { prototype });
        set({ status: 'ready', me: person, comments, error: null });
      } catch (error) {
        // 503 is a site without a review store; 404 is a static preview with no API at all.
        if (error instanceof ApiError && (error.status === 503 || error.status === 404))
          set({ status: 'off' });
        else set({ status: 'ready', error: String((error as Error).message) });
      }
    },

    add: (body: string, anchor: Anchor, states: string[]) =>
      attempt(async () =>
        merge((await call<{ comment: Comment }>('comment.add', { body, anchor, states })).comment),
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

    loadPeople: () => attempt(async () => set({ people: (await call<{ people: Me[] }>('people')).people })),
    invite: (name: string, team: string, role: Role) =>
      attempt(async () => {
        const r = await call<{ person: Me; link: string }>('people.invite', { name, team, role });
        mergePerson(r.person);
        return new URL(r.link, location.origin).href;
      }),
    reissue: (id: string) =>
      attempt(async () => {
        const r = await call<{ person: Me; link: string }>('people.reissue', { id });
        mergePerson(r.person);
        return new URL(r.link, location.origin).href;
      }),
    revoke: (id: string) =>
      attempt(async () => mergePerson((await call<{ person: Me }>('people.revoke', { id })).person)),
    clearError: () => set({ error: null }),
  };
}

export type ReviewStore = ReturnType<typeof createReviewStore>;

export const useReviewState = (store: ReviewStore) =>
  useSyncExternalStore(store.subscribe, store.get, store.get);
