// Who may do what. Studio runs the review: it invites and revokes people,
// deletes any comment and corrects triage. A Client comments, replies, edits
// and deletes what they wrote, and resolves or reopens any thread, because
// clients work alongside others in their own organisation. A revoked person,
// or a visitor with only the shared password, may do nothing here.
import type { Comment, Person } from './model.ts';

export type Action = 'read' | 'comment' | 'edit' | 'delete' | 'resolve' | 'triage' | 'people';

/** Only what the rules read, so the browser's signed-in person (no epoch) is checked by the same rules. */
type Actor = Pick<Person, 'id' | 'kind' | 'revokedAt'>;

export function can(actor: Actor | null, action: Action, subject?: Comment): boolean {
  if (!actor || actor.revokedAt) return false;
  const studio = actor.kind === 'studio';
  const own = subject?.author.id === actor.id;
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
      return studio;
  }
}
