// Who may do what. Editors run the review: they invite and revoke people,
// resolve any thread and correct triage. Reviewers comment, reply, and edit
// or delete what they wrote, and resolve threads they started. A revoked
// person, or a visitor with only the shared password, may do nothing here.
import type { Comment, Person } from './model.ts';

export type Action = 'read' | 'comment' | 'edit' | 'delete' | 'resolve' | 'triage' | 'people';

export function can(actor: Person | null, action: Action, subject?: Comment): boolean {
  if (!actor || actor.revokedAt) return false;
  const editor = actor.role === 'editor';
  const own = subject?.author.id === actor.id;
  switch (action) {
    case 'read':
    case 'comment':
      return true;
    case 'edit':
      return own;
    case 'delete':
    case 'resolve':
      return own || editor;
    case 'triage':
    case 'people':
      return editor;
  }
}
