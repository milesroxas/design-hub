#!/usr/bin/env node
/// <reference types="node" />
// The skill hint: a UserPromptSubmit hook (--hook) that, with TypeSafe on,
// names the miles-* skill the prompt most likely needs, in one line of
// context. Off without TYPESAFE_API_KEY, silent on any failure.
//
// It follows TypeSafe's skill-suggestion cookbook in one request: a Choice
// over the skills says which; three gate Nouls about whether the prompt asks
// for action at all say whether to speak; one `fits` Noul per skill confirms
// the winner. A Choice has no reliable "none" option, which is why the gates
// exist. Thresholds: checks.json `skillHint`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checks, reaches } from '../_core/checks.ts';
import { frontmatter } from '../_core/frontmatter.ts';
import { choiceOf, noulOf, type Question } from '../_core/jev.ts';
import { SKILLS } from '../_server/paths.ts';
import { type CommandSpec, isMain, runCommand } from './lib/cli.ts';
import { judge } from './lib/judge.ts';

export const spec = {
  name: 'skill-hint',
  summary: 'Suggest the miles-* skill for a prompt. Normally runs as a UserPromptSubmit hook (--hook).',
  positionals: [{ name: 'prompt', description: 'The prompt to judge', required: true }],
  flags: {},
  output: '{ ok, skill: string | null, gate, fits }',
} as const satisfies CommandSpec;

// miles-design-hub starts a project from outside one; inside a project it is never the answer.
const GLOBAL_ONLY = new Set(['miles-design-hub']);
const MAX_PROMPT_CHARS = 4000;

const GATES = {
  acts: "Is the assistant being asked to act on the user's files, project or online services, rather than only to explain or advise?",
  procedure:
    'Would a careful expert answering `request` consult a specific documented procedure or set of commands, rather than answer from general understanding?',
  prose:
    "Could a knowledgeable generalist fully satisfy `request` in prose, with no tools, no documentation and no access to the user's files?",
} as const;

export type Skill = { name: string; description: string };

export function roster(dir = SKILLS): Skill[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith('miles-') && !GLOBAL_ONLY.has(name))
    .map((name) => join(dir, name, 'SKILL.md'))
    .filter(existsSync)
    .map((file) => frontmatter(readFileSync(file, 'utf8')).data)
    .filter((d) => d.name && d.description)
    .map((d) => ({ name: d.name, description: d.description }));
}

export type Hint = { skill: string | null; gate: number | null; fits: number | null };

/** `ask` is Jev through the log (lib/judge.ts); tests pass their own. */
export async function suggest(prompt: string, skills = roster(), ask: typeof judge = judge): Promise<Hint> {
  const none: Hint = { skill: null, gate: null, fits: null };
  if (!checks || !skills.length || !prompt.trim() || prompt.trimStart().startsWith('/')) return none;
  // A prompt that already names a skill needs no hint.
  if (skills.some((s) => prompt.includes(s.name))) return none;
  const questions: Record<string, Question> = {
    which: {
      type: 'choice',
      instructions: 'Which of these skills is the right one to load to help with `request`?',
      criteria: Object.fromEntries(skills.map((s) => [s.name, s.description])),
    },
    ...Object.fromEntries(Object.entries(GATES).map(([k, q]) => [k, { type: 'noul', instructions: q }])),
    ...Object.fromEntries(
      skills.map((s) => [
        `fits:${s.name}`,
        {
          type: 'noul',
          instructions: `Does the skill '${s.name}' do the specific thing \`request\` asks for? It is described as: ${s.description}`,
        },
      ]),
    ),
  };
  const judged = await ask({
    check: 'skillHint',
    subject: 'prompt',
    state: { request: prompt.slice(0, MAX_PROMPT_CHARS) },
    questions,
    excerpt: prompt.slice(0, 500),
  });
  if (!judged) return none;
  const [acts, procedure, prose] = (['acts', 'procedure', 'prose'] as const).map((k) =>
    noulOf(judged.answers, k),
  );
  const which = choiceOf(judged.answers, 'which');
  if (acts === null || procedure === null || prose === null || !which) return none;
  const gate = (acts + procedure + (1 - prose)) / 3;
  const fits = noulOf(judged.answers, `fits:${which.choice}`);
  const speak =
    reaches(gate, checks.skillHint.gateAt) && fits !== null && reaches(fits, checks.skillHint.fitsAt);
  return { skill: speak ? which.choice : null, gate, fits };
}

async function hook(): Promise<void> {
  let prompt = '';
  try {
    prompt = (JSON.parse(readFileSync(0, 'utf8')) as { prompt?: string }).prompt ?? '';
  } catch {
    return;
  }
  const { skill, fits } = await suggest(prompt);
  if (!skill || fits === null) return;
  const text = `Skill hint: ${skill} looks like the skill for this request (fit ${fits.toFixed(2)}). Load it if its trigger matches; ignore this line if it does not.`;
  console.log(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } }),
  );
}

if (isMain(import.meta.url)) {
  if (process.argv.includes('--hook')) await hook().catch(() => {});
  else await runCommand(spec, async ({ positionals }) => ({ ...(await suggest(positionals.join(' '))) }));
}
