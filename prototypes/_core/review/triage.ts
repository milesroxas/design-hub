// Comment triage with Jev: each new comment gets a kind (bug, taste, copy)
// and the README state it is about, so feedback lands on the state it
// concerns. Two Choices in one request. Below checks.json `triage.at`
// confidence a field stays null for a person to set; Jev never guesses
// loudly. TypeSafe off, slow or failing: no triage, and the comment saves.
import { checks } from '../checks.ts';
import { askJev, choiceOf, type Question } from '../jev.ts';
import type { Kind, Triage } from './model.ts';
import type { Triager } from './service.ts';

const KIND_CRITERIA: Record<Kind, string> = {
  bug: 'Something is broken or wrong: it does not work, shows the wrong thing, or the layout breaks.',
  taste: 'A design opinion about look, feel, motion, spacing or hierarchy, where nothing is broken.',
  copy: 'About the words: a typo, a label, wording or content to change.',
};

type Ask = typeof askJev;

export function jevTriager(apiKey: string, ask: Ask = askJev): Triager | null {
  if (!apiKey || !checks) return null;
  const { model, timeoutMs } = checks.jev;
  const at = checks.triage.at;
  return async ({ body, prototype, url, states }) => {
    const questions: Record<string, Question> = {
      kind: {
        type: 'choice',
        instructions: 'What kind of review note is `comment`?',
        criteria: KIND_CRITERIA,
      },
    };
    if (states.length)
      questions.state = {
        type: 'choice',
        instructions: 'Which state of the prototype is `comment` about? `url` is where the reviewer was.',
        criteria: Object.fromEntries(states.map((s) => [s, null])),
      };
    const result = await ask(
      apiKey,
      { model, state: { comment: body, prototype, url }, questions },
      { timeoutMs },
    );
    if (!result.ok) return null;
    const pick = (key: string) => {
      const c = choiceOf(result.answers, key);
      return c && at !== null && c.confidence >= at ? c : null;
    };
    const kind = pick('kind');
    const state = pick('state');
    if (!kind && !state) return null;
    const triage: Triage = {
      kind: (kind?.choice as Kind | undefined) ?? null,
      state: state?.choice ?? null,
      by: 'jev',
      confidence: Math.min(kind?.confidence ?? 1, state?.confidence ?? 1),
    };
    return triage;
  };
}
