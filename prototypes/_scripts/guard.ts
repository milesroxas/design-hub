#!/usr/bin/env node
/// <reference types="node" />
// The fidelity guard. A Claude Code PostToolUse hook (--hook, the hook JSON
// on stdin) over each file written under prototypes/, and `pnpm guard
// <file>` by hand over a file's whole content.
//
// Code checks always run: a write outside a feature folder, a new
// dependency, an import that crosses prototypes. With TYPESAFE_API_KEY in
// .env, four Nouls follow on the change (rules.ts), in one request. A
// finding at or over checks.json `fidelity.warnAt` goes back to Claude as
// context; at or over `blockAt`, or a crossing import, it goes back as a
// block, which makes Claude answer it before going on. Anything countable
// stays in code; Jev answers only the semantic part.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { checks, reaches } from '../_core/checks.ts';
import { SET_NAMES } from '../_core/fixtures.ts';
import { noulOf } from '../_core/jev.ts';
import { parseStates } from '../_core/states.ts';
import { PROTOTYPES, REPO } from '../_server/paths.ts';
import { type Args, type CommandSpec, isMain, runCommand } from './lib/cli.ts';
import { judge } from './lib/judge.ts';
import { NOULS, RULE, type SemanticRule } from './lib/rules.ts';

export const spec = {
  name: 'guard',
  summary: 'Run the fidelity guard over whole files, as if each had just been written.',
  positionals: [{ name: 'file', description: 'A file under prototypes/', required: true, variadic: true }],
  flags: {},
  output: '{ ok, findings: [{ file, rule, level, note, p?, id? }] }',
} as const satisfies CommandSpec;

const MAX_CHANGE_CHARS = 12_000;
const INFRA = new Set(['_shell', '_templates', '_core', '_server', '_scripts']);

export type Change = { file: string; added: string; removed: string; whole: boolean };
export type Level = 'warn' | 'block';
export type Finding = { file: string; rule: string; level: Level; note: string; p?: number; id?: string };

const inside = (file: string, dir: string) => file === dir || file.startsWith(dir + sep);

/** The feature folder a file belongs to, or null for infrastructure and root files. */
export function featureOf(file: string): string | null {
  const rel = relative(PROTOTYPES, file);
  const top = rel.split(sep)[0];
  if (!top || top.startsWith('_') || top.startsWith('.') || !rel.includes(sep)) return null;
  return top;
}

const DEPENDENCY_LINE = /^\s*"[^"]+":\s*"[\^~>=<\d]/gm;

export function codeFindings(change: Change): Finding[] {
  const file = relative(REPO, change.file);

  if (basename(change.file) === 'package.json' && dirname(change.file) === PROTOTYPES) {
    const removed = new Set(change.removed.match(DEPENDENCY_LINE) ?? []);
    const fresh = (change.added.match(DEPENDENCY_LINE) ?? [])
      .filter((l) => !removed.has(l))
      .map((l) => l.trim().split('"')[1]);
    return fresh.length
      ? [
          {
            file,
            rule: RULE.dependency,
            level: 'warn',
            note: `adds ${fresh.join(', ')}; confirm the user agreed`,
          },
        ]
      : [];
  }

  const feature = featureOf(change.file);
  if (!feature) {
    const top = relative(PROTOTYPES, change.file).split(sep)[0];
    if (top === '_kit')
      return [
        {
          file,
          rule: RULE.fork,
          level: 'warn',
          note: 'a kit change serves every prototype; copy into the feature folder unless this is a second use',
        },
      ];
    if (INFRA.has(top))
      return [
        {
          file,
          rule: RULE.gravity,
          level: 'warn',
          note: 'infrastructure, not a prototype; no prototype needs it changed',
        },
      ];
    return [];
  }

  const out: Finding[] = [];
  const imports = [...change.added.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const crossing = imports.filter((s) => {
    if (!s.startsWith('.')) return false;
    const target = resolve(dirname(change.file), s);
    return inside(target, PROTOTYPES) && !inside(target, join(PROTOTYPES, feature));
  });
  if (crossing.length)
    out.push({
      file,
      rule: RULE.gravity,
      level: 'block',
      note: `imports ${crossing.join(', ')}; a prototype imports only @kit/* and its own folder`,
    });
  return out;
}

const clip = (text: string) =>
  text.length > MAX_CHANGE_CHARS ? `${text.slice(0, MAX_CHANGE_CHARS)}\n…[clipped]` : text;

export function readmeStates(feature: string): string[] {
  const file = join(PROTOTYPES, feature, 'README.md');
  return existsSync(file) ? (parseStates(readFileSync(file, 'utf8')) ?? []).map((s) => s.name) : [];
}

export async function jevFindings(
  change: Change,
  feature: string,
  ask: typeof judge = judge,
): Promise<Finding[]> {
  if (!checks || !/\.(tsx?|jsx?)$/.test(change.file) || /\.test\.tsx?$/.test(change.file)) return [];
  const file = relative(REPO, change.file);
  const state = {
    file,
    readmeStates: readmeStates(feature),
    fixtureSets: SET_NAMES,
    change: change.whole
      ? { content: clip(change.added) }
      : { removed: clip(change.removed), added: clip(change.added) },
  };
  const rules = Object.keys(NOULS) as SemanticRule[];
  const judged = await ask({
    check: 'fidelity',
    subject: file,
    state,
    questions: Object.fromEntries(rules.map((r) => [r, { type: 'noul', instructions: NOULS[r] }])),
    excerpt: clip(change.added).slice(0, 1500),
  });
  if (!judged) return [];
  const { warnAt, blockAt } = checks.fidelity;
  return rules.flatMap((r): Finding[] => {
    const p = noulOf(judged.answers, r);
    if (p === null || (!reaches(p, warnAt) && !reaches(p, blockAt))) return [];
    return [
      {
        file,
        rule: RULE[r],
        level: reaches(p, blockAt) ? 'block' : 'warn',
        note: NOULS[r],
        p,
        id: judged.ids[r],
      },
    ];
  });
}

export async function findings(change: Change): Promise<Finding[]> {
  if (!inside(change.file, PROTOTYPES) || /\/(node_modules|dist)\//.test(change.file)) return [];
  const feature = featureOf(change.file);
  return [...codeFindings(change), ...(feature ? await jevFindings(change, feature) : [])];
}

type HookInput = {
  tool_input?: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
    edits?: { old_string: string; new_string: string }[];
  };
};

export function changeFromHook(input: HookInput): Change | null {
  const t = input.tool_input;
  if (!t?.file_path) return null;
  const file = resolve(t.file_path);
  if (t.edits)
    return {
      file,
      added: t.edits.map((e) => e.new_string).join('\n'),
      removed: t.edits.map((e) => e.old_string).join('\n'),
      whole: false,
    };
  if (t.old_string !== undefined || t.new_string !== undefined)
    return { file, added: t.new_string ?? '', removed: t.old_string ?? '', whole: false };
  return { file, added: t.content ?? '', removed: '', whole: true };
}

const line = (f: Finding) =>
  `${f.file}: ${f.rule}${f.p !== undefined ? ` (p=${f.p.toFixed(2)}, log ${f.id})` : ''}. ${f.note}`;

/** The hook's stdout: nothing, a warning as context, or a block Claude must answer. */
export function hookOutput(found: Finding[]): Record<string, unknown> | null {
  if (!found.length) return null;
  const blocking = found.some((f) => f.level === 'block');
  const text = `Fidelity guard: ${found.map(line).join(' | ')}. Hold the fidelity ceiling in miles-prototype, or say why this one earns it.`;
  const context = { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } };
  return blocking ? { decision: 'block', reason: text, ...context } : context;
}

async function hook(): Promise<void> {
  let input: HookInput;
  try {
    input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
  } catch {
    return;
  }
  const change = changeFromHook(input);
  const output = change ? hookOutput(await findings(change)) : null;
  if (output) console.log(JSON.stringify(output));
}

export async function main({ positionals }: Args<typeof spec>) {
  const all: Finding[] = [];
  for (const path of positionals) {
    const file = resolve(path);
    all.push(...(await findings({ file, added: readFileSync(file, 'utf8'), removed: '', whole: true })));
  }
  return { findings: all };
}

if (isMain(import.meta.url)) {
  // The hook fails open: any error is swallowed, so a broken guard never stops the user.
  if (process.argv.includes('--hook')) await hook().catch(() => {});
  else await runCommand(spec, main);
}
