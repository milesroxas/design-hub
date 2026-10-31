/// <reference types="node" />
// Jev from the Node scripts: the key from .env, the model and timeout from
// checks.json, and every judgment appended to .design-hub/jev.jsonl with an
// id, so `pnpm calibrate` can label it right or wrong and thresholds come
// from data. Off without TYPESAFE_API_KEY, silently: the user chose that.
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checks } from '../../_core/checks.ts';
import { type Answer, askJev, type ImageAsset, type Question } from '../../_core/jev.ts';
import { readEnv } from '../../_server/env.ts';
import { PROTOTYPES, STATE_DIR } from '../../_server/paths.ts';

export const JEV_LOG = join(STATE_DIR, 'jev.jsonl');
export const LABELS = join(STATE_DIR, 'labels.jsonl');

/** The checks that ask Jev; calibration groups judgments by these. */
type CheckName = 'fidelity' | 'states' | 'contacts' | 'skillHint' | 'triage' | 'visual';

export type Judged = { answers: Record<string, Answer>; ids: Record<string, string> };

// The project's .env only, never the shell: a key in someone's profile must not turn
// TypeSafe on in a project whose owner did not opt in (pnpm bootstrap --typesafe-key).
export const typesafeKey = () => readEnv(PROTOTYPES).TYPESAFE_API_KEY ?? '';

export function appendJsonl(file: string, entry: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // A log that cannot be written never stops the check it records.
  }
}

type Ask = {
  check: CheckName;
  /** What was judged, for the reader of the log: a file, a feature, a prompt. */
  subject: string;
  state: unknown;
  questions: Record<string, Question>;
  assets?: Record<string, ImageAsset>;
  /** Kept in the log so a person labelling the judgment can see what was judged. */
  excerpt?: string;
};

/** The answers and one log id per question, or null when Jev is off or failed. */
export async function judge({
  check,
  subject,
  state,
  questions,
  assets,
  excerpt,
}: Ask): Promise<Judged | null> {
  const key = typesafeKey();
  if (!key || !checks) return null;
  const result = await askJev(
    key,
    { model: checks.jev.model, state, questions, assets },
    {
      timeoutMs: checks.jev.timeoutMs,
    },
  );
  const at = new Date().toISOString();
  if (!result.ok) {
    appendJsonl(JEV_LOG, { at, check, subject, error: result.error, ms: result.ms });
    return null;
  }
  const ids: Record<string, string> = {};
  for (const [question, answer] of Object.entries(result.answers)) {
    const id = randomBytes(4).toString('hex');
    ids[question] = id;
    const value =
      answer.type === 'noul'
        ? { p: answer.noul }
        : { choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities };
    appendJsonl(JEV_LOG, {
      id,
      at,
      check,
      question,
      subject,
      model: result.model,
      ms: result.ms,
      ...value,
      excerpt,
    });
  }
  return { answers: result.answers, ids };
}
