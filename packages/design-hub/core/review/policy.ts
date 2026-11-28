// Who may do what. Studio runs the review: it adds and revokes people,
// deletes any comment, corrects triage and sets which prototypes are
// client-facing. A Client comments, replies, edits
// and deletes what they wrote, and resolves or reopens any client-facing
// thread, because clients work alongside others in their own organisation.
// An internal thread does not exist for a Client: every action on one is
// refused. A revoked person, or a visitor who is not signed in, may do
// nothing here. Nor may anyone outside the op's scope: a Client works only in
// their own client, and the service answers anything outside it as not found.
import type { Audience, Comment, Person, PersonKind, Scope } from './model.ts';

export type Action = 'read' | 'comment' | 'edit' | 'delete' | 'resolve' | 'triage' | 'people' | 'audience';

/** Only what the rules read, so the browser's signed-in person (no epoch) is checked by the same rules. */
type Actor = Pick<Person, 'id' | 'kind' | 'revokedAt' | 'client'>;

/**
 * Whether an op in `scope` is the actor's at all: Studio works in every
 * client, a Client only in their own. A person whose kind and client
 * disagree (Studio with a client, a Client with none) is in no scope, and
 * so is every op on a scope that names no client: it fails closed here.
 */
export function inScope(actor: Pick<Person, 'kind' | 'client'>, scope: Scope): boolean {
  if (typeof scope.client !== 'string' || scope.client === '') return false;
  return actor.kind === 'studio' ? actor.client === null : actor.client === scope.client;
}

/** Whether a comment reaches a Client. Only the exact value counts, so a record without one stays inside. */
const clientFacing = (c: Pick<Comment, 'audience'>) => c.audience === 'client';

/**
 * `root` is the thread acted on, `subject` the comment in it when that is a
 * reply (edit or delete one); without `subject`, the root is the subject.
 * Without a root, the action is on no thread: listing, or a new thread.
 */
export function can(
  actor: Actor | null,
  scope: Scope,
  action: Action,
  root?: Comment,
  subject?: Comment,
): boolean {
  if (!actor || actor.revokedAt || !inScope(actor, scope)) return false;
  const studio = actor.kind === 'studio';
  if (!studio && [root, subject].some((c) => c && !clientFacing(c))) return false;
  const own = (subject ?? root)?.author.id === actor.id;
  switch (action) {
    case 'read':
    case 'comment':
    case 'resolve':
      return true;
    case 'edit':
      return own;
    case 'delete':
      return own || studio;
    case 'triage':
    case 'people':
    case 'audience':
      return studio;
  }
}

/**
 * The view a person gets: their own kind, or a narrower one they ask for.
 * Studio may look as a Client does (Client view); a Client asking for
 * Studio's still gets a Client's, so the view is never wider than the person.
 */
export function viewOf(actor: Pick<Person, 'kind'> | null, viewAs?: PersonKind | null): PersonKind {
  return actor?.kind === 'studio' && viewAs !== 'client' ? 'studio' : 'client';
}

/**
 * The comments a view may see. Studio sees all. A Client sees a client-facing
 * thread and its client-facing replies; a reply whose thread is not among
 * them is not seen either.
 */
export function visibleTo(viewAs: PersonKind, comments: Comment[]): Comment[] {
  if (viewAs === 'studio') return comments;
  const roots = new Set(comments.filter((c) => c.thread === c.id && clientFacing(c)).map((c) => c.id));
  return comments.filter((c) => clientFacing(c) && roots.has(c.thread));
}

/** A new thread's audience: a Client's is always client-facing; Studio's is internal unless Studio asks otherwise. */
export function audienceFor(actor: Pick<Person, 'kind'>, asked: Audience | null): Audience {
  return actor.kind === 'studio' ? (asked ?? 'internal') : 'client';
}
