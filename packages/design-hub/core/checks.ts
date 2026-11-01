// The model and thresholds every Jev check reads, from one file in the
// project: .design-hub/checks.json. `design-hub calibrate --write` rewrites it
// from labelled judgments, so thresholds come from data, never from a
// constant in a script. The model is pinned, not an alias: an alias moves on
// a release, and the thresholds were set against one model. A file that does
// not validate turns every Jev check off (and `design-hub preflight` reports
// it), because a check must never block on a config typo. A project without
// the file runs on DEFAULT_CHECKS.

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

export const DEFAULT_CHECKS: Checks = {
  jev: { model: 'jev-1.14.0', timeoutMs: 2000 },
  fidelity: { warnAt: 0.7, blockAt: 0.9 },
  states: { blockAt: 0.8 },
  contacts: { privateAt: 0.5, allow: [] },
  skillHint: { gateAt: 0.3, fitsAt: 0.3 },
  triage: { at: 0.5 },
  visual: { warnAt: 0.7 },
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

export type Loaded = { checks: Checks | null; problems: string[] };

/** The checks a raw value yields: the value when it validates, else null with the problems. */
export function loadChecks(raw: unknown): Loaded {
  const problems = validateChecks(raw);
  return { checks: problems.length ? null : (raw as Checks), problems };
}

/** True when p reaches the threshold; a null threshold never does. */
export const reaches = (p: number, at: At) => at !== null && p >= at;
