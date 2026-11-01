#!/usr/bin/env node
/// <reference types="node" />
// Every Jev judgment lands in .design-hub/jev.jsonl with an id. A person
// labels some; this turns the labels into thresholds, so a check blocks only
// where the data says it is right. A threshold moves only with enough
// labels behind it; otherwise it stays as it is and the report says why.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_CHECKS, validateChecks } from '../core/checks.ts';
import { CHECKS_FILE } from '../server/paths.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';
import { appendJsonl, JEV_LOG, LABELS } from './lib/judge.ts';

export const spec = {
  name: 'calibrate',
  summary: 'Label logged Jev judgments and derive the checks.json thresholds from the labels.',
  flags: {
    yes: { type: 'list', description: 'A judgment id that was right to flag: the rule really was broken.' },
    no: { type: 'list', description: 'A judgment id that should not have flagged.' },
    unlabeled: { type: 'boolean', description: 'List judgments without a label, newest first.' },
    limit: { type: 'number', default: 20, description: 'How many --unlabeled to list.' },
    write: { type: 'boolean', description: 'Write the suggested thresholds into checks.json.' },
  },
  output:
    '{ ok, thresholds: [{ threshold, current, suggested, labelled, positives, reason }] } or { judgments }',
} as const satisfies CommandSpec;

export const MIN_LABELS = 20;
export const MIN_POSITIVES = 5;
const CANDIDATES = Array.from({ length: 19 }, (_, i) => Math.round((0.05 + i * 0.05) * 100) / 100);

export type Entry = {
  id: string;
  check: string;
  question: string;
  subject: string;
  p?: number;
  excerpt?: string;
  at: string;
};
export type Point = { p: number; truth: boolean };

/**
 * What each threshold is for decides how it is chosen. A block must be right
 * almost every time it fires (precision). A warning may be wrong more often.
 * The private-contact threshold must miss almost nothing (recall), because a
 * miss puts a person's details behind a forwarded link.
 */
export const TARGETS = {
  'fidelity.warnAt': { checks: ['fidelity'], questions: null, goal: 'precision', at: 0.6 },
  'fidelity.blockAt': { checks: ['fidelity'], questions: null, goal: 'precision', at: 0.95 },
  'states.blockAt': { checks: ['states'], questions: null, goal: 'precision', at: 0.95 },
  'contacts.privateAt': { checks: ['contacts'], questions: null, goal: 'recall', at: 0.95 },
  'skillHint.fitsAt': { checks: ['skillHint'], questions: /^fits:/, goal: 'precision', at: 0.8 },
  'visual.warnAt': { checks: ['visual'], questions: null, goal: 'precision', at: 0.6 },
} as const;

export function rates(points: Point[], t: number) {
  const flagged = points.filter((x) => x.p >= t);
  const positives = points.filter((x) => x.truth);
  const hits = flagged.filter((x) => x.truth).length;
  return {
    precision: flagged.length ? hits / flagged.length : 1,
    recall: positives.length ? hits / positives.length : 1,
  };
}

/** The threshold that meets the goal, or null when the labels cannot support one. */
export function suggestThreshold(points: Point[], goal: 'precision' | 'recall', at: number): number | null {
  if (points.length < MIN_LABELS || points.filter((x) => x.truth).length < MIN_POSITIVES) return null;
  // Precision: the lowest threshold that is precise enough, so the check fires as often as it can.
  // Recall: the highest threshold that still catches enough, so it stops as little as it can.
  const ok = CANDIDATES.filter((t) => rates(points, t)[goal] >= at);
  if (!ok.length) return null;
  return goal === 'precision' ? Math.min(...ok) : Math.max(...ok);
}

const readJsonl = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .flatMap((l) => {
          try {
            return [JSON.parse(l) as T];
          } catch {
            // A line cut short when a process died mid-append; the rest of the log still counts.
            return [];
          }
        })
    : [];

function labels(): Map<string, boolean> {
  // The last label for an id wins, so a mistake is fixed by labelling again.
  const out = new Map<string, boolean>();
  for (const l of readJsonl<{ id: string; truth: boolean }>(LABELS)) out.set(l.id, l.truth);
  return out;
}

type Current = Record<string, Record<string, unknown>>;
export type Row = {
  threshold: string;
  current: unknown;
  suggested: number | null;
  labelled: number;
  positives: number;
  reason: string;
};

function reason(
  target: (typeof TARGETS)[keyof typeof TARGETS],
  points: Point[],
  suggested: number | null,
): string {
  const positives = points.filter((x) => x.truth).length;
  if (suggested !== null)
    return `${target.goal === 'recall' ? 'highest' : 'lowest'} threshold with ${target.goal} ≥ ${target.at}`;
  if (points.length < MIN_LABELS || positives < MIN_POSITIVES)
    return `needs ${MIN_LABELS} labels with ${MIN_POSITIVES} yes; has ${points.length} with ${positives}`;
  return `no threshold reaches ${target.goal} ${target.at}`;
}

/** One row per threshold: what it is, what the labels suggest, and why. */
export function report(judged: Entry[], truth: Map<string, boolean>, current: Current): Row[] {
  return Object.entries(TARGETS).map(([path, target]) => {
    const points = judged
      .filter((e) => (target.checks as readonly string[]).includes(e.check))
      .filter((e) => !target.questions || target.questions.test(e.question))
      .flatMap((e) => (truth.has(e.id) ? [{ p: e.p as number, truth: truth.get(e.id) === true }] : []));
    const [group, key] = path.split('.');
    const suggested = suggestThreshold(points, target.goal, target.at);
    return {
      threshold: path,
      current: current[group]?.[key] ?? null,
      suggested,
      labelled: points.length,
      positives: points.filter((x) => x.truth).length,
      reason: reason(target, points, suggested),
    };
  });
}

function label(marks: (readonly [string, boolean])[], known: Set<string>) {
  const unknown = marks.filter(([id]) => !known.has(id)).map(([id]) => id);
  if (unknown.length)
    throw new CliError('No judgment has these ids.', { unknown, fix: 'design-hub calibrate --unlabeled' });
  for (const [id, truth] of marks) appendJsonl(LABELS, { id, truth, at: new Date().toISOString() });
  return { labelled: marks.length };
}

function write(current: Current, rows: Row[]): void {
  for (const { threshold, suggested } of rows) {
    if (suggested === null) continue;
    const [group, key] = threshold.split('.');
    current[group] = { ...current[group], [key]: suggested };
  }
  const problems = validateChecks(current);
  if (problems.length)
    throw new CliError('The result would not validate; checks.json is unchanged.', { problems });
  mkdirSync(dirname(CHECKS_FILE), { recursive: true });
  writeFileSync(CHECKS_FILE, `${JSON.stringify(current, null, 2)}\n`);
}

/** The project's checks.json as written, or the defaults when the project has none yet. */
const currentChecks = (): Current =>
  existsSync(CHECKS_FILE)
    ? (JSON.parse(readFileSync(CHECKS_FILE, 'utf8')) as Current)
    : (JSON.parse(JSON.stringify(DEFAULT_CHECKS)) as Current);

export function main({ flags }: Args<typeof spec>) {
  const judged = readJsonl<Entry>(JEV_LOG).filter((e) => e.id && typeof e.p === 'number');
  const marks = [
    ...flags.yes.map((id) => [id, true] as const),
    ...flags.no.map((id) => [id, false] as const),
  ];
  if (marks.length) return label(marks, new Set(judged.map((e) => e.id)));
  const truth = labels();
  if (flags.unlabeled)
    return {
      judgments: judged
        .filter((e) => !truth.has(e.id))
        .reverse()
        .slice(0, flags.limit)
        .map(({ id, check, question, subject, p, excerpt }) => ({
          id,
          check,
          question,
          subject,
          p,
          excerpt,
        })),
    };
  const current = currentChecks();
  const thresholds = report(judged, truth, current);
  if (flags.write) write(current, thresholds);
  return { judgments: judged.length, labelled: truth.size, thresholds, written: flags.write };
}
