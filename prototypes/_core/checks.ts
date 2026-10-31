// The model and thresholds every Jev check reads, from one file:
// prototypes/checks.json. `pnpm calibrate --write` rewrites it from labelled
// judgments, so thresholds come from data, never from a constant in a script.
// The model is pinned, not an alias: an alias moves on a release, and the
// thresholds were set against one model. A file that does not validate turns
// every Jev check off (and `pnpm preflight` reports it), because a check must
// never block on a config typo.
import raw from '../checks.json' with { type: 'json' };

/** A probability threshold, or null for "never". */
type At = number | null;

export type Checks = {
  jev: { model: string; timeoutMs: number };
  fidelity: { warnAt: At; blockAt: At };
  states: { blockAt: At };
  contacts: { privateAt: At; allow: string[] };
  skillHint: { gateAt: At; fitsAt: At };
  triage: { at: At };
  visual: { warnAt: At };
};

const isAt = (v: unknown): v is At => v === null || (typeof v === 'number' && v >= 0 && v <= 1);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Every problem with a checks object, by path; empty when it is valid. */
export function validateChecks(value: unknown): string[] {
  const c = obj(value);
  const problems: string[] = [];
  const jev = obj(c.jev);
  if (typeof jev.model !== 'string' || !jev.model) problems.push('jev.model: a model name');
  if (typeof jev.timeoutMs !== 'number' || jev.timeoutMs <= 0)
    problems.push('jev.timeoutMs: milliseconds > 0');
  const thresholds: [string, string][] = [
    ['fidelity', 'warnAt'],
    ['fidelity', 'blockAt'],
    ['states', 'blockAt'],
    ['contacts', 'privateAt'],
    ['skillHint', 'gateAt'],
    ['skillHint', 'fitsAt'],
    ['triage', 'at'],
    ['visual', 'warnAt'],
  ];
  for (const [group, key] of thresholds)
    if (!isAt(obj(c[group])[key])) problems.push(`${group}.${key}: a probability from 0 to 1, or null`);
  const allow = obj(c.contacts).allow;
  if (!Array.isArray(allow) || !allow.every((a) => typeof a === 'string'))
    problems.push('contacts.allow: a list of strings');
  return problems;
}

export const checkProblems = validateChecks(raw);
/** The validated thresholds, or null when checks.json is invalid (every Jev check is then off). */
export const checks: Checks | null = checkProblems.length ? null : (raw as Checks);

/** True when p reaches the threshold; a null threshold never does. */
export const reaches = (p: number, at: At) => at !== null && p >= at;
