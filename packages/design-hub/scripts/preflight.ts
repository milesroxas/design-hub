#!/usr/bin/env node
/// <reference types="node" />
// Everything that must be true before a share link goes out, in one run, so
// no step depends on Claude remembering it. Every step runs, so one failure
// never hides the next; the JSON says which failed and the fix.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { isLive } from '../core/catalog.ts';
import { DEFAULT_CHECKS, reaches } from '../core/checks.ts';
import { type Contact, contactsInJson } from '../core/contacts.ts';
import { noulOf } from '../core/jev.ts';
import { checkProblems, checks } from '../server/checks.ts';
import { CHECKS_FILE, DOCS, ROOT } from '../server/paths.ts';
import { lint, typecheck } from './check.ts';
import { build } from './dev.ts';
import * as elyxCommand from './elyx.ts';
import { type OnDisk, prototypes } from './lib/catalog.ts';
import type { Args, CommandSpec } from './lib/cli.ts';
import { judge } from './lib/judge.ts';
import { NOULS } from './lib/rules.ts';
import { gateEnvMissing } from './lib/vercel.ts';

export const STEPS = [
  'checks',
  'types',
  'lint',
  'build',
  'elyx',
  'guides',
  'states',
  'contacts',
  'gate',
  'secrets',
] as const;
type StepName = (typeof STEPS)[number];

export const spec = {
  name: 'preflight',
  summary: 'Run every check a share link needs. Exit 1 when any step fails.',
  flags: {
    skip: { type: 'list', description: `A step to skip: ${STEPS.join(', ')}.` },
    'allow-contact': {
      type: 'list',
      description:
        'A contact the user confirmed is a business, added to .design-hub/checks.json contacts.allow.',
    },
  },
  output: '{ ok, steps: [{ step, ok, skipped?, detail?, fix? }] }',
} as const satisfies CommandSpec;

type Step = { step: StepName; ok: boolean; skipped?: string; detail?: unknown; fix?: string };
const MAX_CODE_CHARS = 12_000;

const outcome = (step: StepName, run: { ok: boolean; output?: string; error?: string }, fix: string): Step =>
  run.ok ? { step, ok: true } : { step, ok: false, detail: run.output ?? run.error, fix };

/** Prototypes a reviewer is sent to: live sprints and their alternates. */
const reviewed = (all: OnDisk[]) => all.filter((p) => isLive(p) && p.kind !== 'exploration');

function guides(all: OnDisk[]): Step {
  const features = [
    ...new Set(
      reviewed(all)
        .map((p) => p.feature)
        .filter(Boolean),
    ),
  ];
  const missing = features.filter((f) => !existsSync(join(DOCS, 'sprints', f, 'guide.md')));
  return missing.length
    ? {
        step: 'guides',
        ok: false,
        detail: { missing },
        fix: 'design-hub guide <feature>, written from the States table.',
      }
    : { step: 'guides', ok: true, detail: { features } };
}

function code(dir: string): string {
  return readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'))
    .map((f) => `// ${f}\n${readFileSync(join(dir, f), 'utf8')}`)
    .join('\n\n')
    .slice(0, MAX_CODE_CHARS);
}

export async function states(all: OnDisk[], ask: typeof judge = judge): Promise<Step> {
  const problems: { prototype: string; problem: string; p?: number; id?: string }[] = [];
  for (const p of reviewed(all)) {
    if (!p.states?.length) {
      problems.push({ prototype: p.slug, problem: 'README has no States rows' });
      continue;
    }
    if (!checks) continue;
    const judged = await ask({
      check: 'states',
      subject: p.slug,
      state: {
        prototype: p.slug,
        readmeStates: p.states.map((s) => s.name),
        change: { content: code(p.dir) },
      },
      questions: { state: { type: 'noul', instructions: NOULS.state } },
    });
    const prob = judged ? noulOf(judged.answers, 'state') : null;
    if (prob !== null && reaches(prob, checks.states.blockAt))
      problems.push({
        prototype: p.slug,
        problem: 'renders a state the States table does not list',
        p: prob,
        id: judged?.ids.state,
      });
  }
  return problems.length
    ? {
        step: 'states',
        ok: false,
        detail: problems,
        fix: 'Add a row per state, with how to reach it, to the README.',
      }
    : { step: 'states', ok: true };
}

export async function contacts(all: OnDisk[], allow: Set<string>, ask: typeof judge = judge): Promise<Step> {
  const flagged: (Contact & { file: string; private?: number; id?: string })[] = [];
  for (const p of all) {
    const file = join(p.dir, 'fixtures.json');
    if (!existsSync(file)) continue;
    const found = contactsInJson(JSON.parse(readFileSync(file, 'utf8'))).filter((c) => !allow.has(c.value));
    if (!found.length) continue;
    const rel = relative(ROOT, file);
    // With Jev, only a private person's details stop the share; without it, every match does.
    const judged =
      checks &&
      (await ask({
        check: 'contacts',
        subject: rel,
        state: { contacts: found.map(({ kind, value, path }) => ({ kind, value, path })) },
        questions: Object.fromEntries(
          found.map((_, i) => [
            `private:${i}`,
            {
              type: 'noul',
              instructions: `Is \`contacts[${i}].value\` the personal contact of a private individual, rather than a business, organisation or role address?`,
            },
          ]),
        ),
      }));
    found.forEach((c, i) => {
      const prob = judged ? noulOf(judged.answers, `private:${i}`) : null;
      if (prob === null || !checks || reaches(prob, checks.contacts.privateAt))
        flagged.push({
          ...c,
          file: rel,
          private: prob ?? undefined,
          id: judged ? judged.ids[`private:${i}`] : undefined,
        });
    });
  }
  return flagged.length
    ? {
        step: 'contacts',
        ok: false,
        detail: flagged,
        fix: 'Show each to the user. Replace it, or after they confirm it is a business contact: design-hub preflight --allow-contact <value>.',
      }
    : { step: 'contacts', ok: true };
}

// Only for a project that took the Elyx add-on; without the CLI on this machine the check cannot run.
function elyx(): Step {
  if (!existsSync(join(ROOT, 'design-system', 'elyx.json')))
    return { step: 'elyx', ok: true, skipped: 'no design-system/' };
  if (spawnSync('elyx', ['--version']).error)
    return { step: 'elyx', ok: true, skipped: 'Elyx CLI not installed' };
  try {
    const result = elyxCommand.main({ flags: { check: true }, positionals: [] });
    return result.ok
      ? { step: 'elyx', ok: true }
      : {
          step: 'elyx',
          ok: false,
          detail: result.drift,
          fix: 'design-hub elyx regenerates design-system/ from tokens.css.',
        };
  } catch (error) {
    return {
      step: 'elyx',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      fix: 'design-hub elyx',
    };
  }
}

function gate(): Step {
  if (!existsSync(join(ROOT, '.vercel', 'project.json')))
    return {
      step: 'gate',
      ok: true,
      skipped: 'not linked to Vercel yet',
      fix: 'design-hub bootstrap --vercel <project>',
    };
  const missing = gateEnvMissing(ROOT);
  if (missing === null) return { step: 'gate', ok: true, skipped: 'vercel CLI unavailable or signed out' };
  return missing.length
    ? {
        step: 'gate',
        ok: false,
        detail: { missing },
        fix: 'design-hub bootstrap --vercel <project> sets them.',
      }
    : { step: 'gate', ok: true };
}

function secrets(): Step {
  const ignored = spawnSync('git', ['-C', ROOT, 'check-ignore', '-q', '.env']).status === 0;
  const tracked = (spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).stdout ?? '')
    .split('\n')
    .filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
  if (ignored && !tracked.length) return { step: 'secrets', ok: true };
  return {
    step: 'secrets',
    ok: false,
    detail: { envIgnored: ignored, tracked },
    fix: 'Keep .env in .gitignore; git rm --cached any tracked env file.',
  };
}

function allowContacts(values: string[]): Set<string> {
  const current = (
    existsSync(CHECKS_FILE) ? JSON.parse(readFileSync(CHECKS_FILE, 'utf8')) : structuredClone(DEFAULT_CHECKS)
  ) as { contacts: { allow: string[] } };
  const allow = new Set([...(current.contacts.allow ?? []), ...values]);
  if (values.length) {
    current.contacts.allow = [...allow].sort();
    mkdirSync(dirname(CHECKS_FILE), { recursive: true });
    writeFileSync(CHECKS_FILE, `${JSON.stringify(current, null, 2)}\n`);
  }
  return allow;
}

export async function main({ flags }: Args<typeof spec>) {
  const skip = new Set(flags.skip);
  const all = prototypes();
  const allow = allowContacts(flags['allow-contact']);
  const run: Record<StepName, () => Step | Promise<Step>> = {
    checks: () =>
      checkProblems.length
        ? {
            step: 'checks',
            ok: false,
            detail: checkProblems,
            fix: 'Fix .design-hub/checks.json; every Jev check is off until then.',
          }
        : { step: 'checks', ok: true },
    types: () => outcome('types', typecheck(), 'Fix what tsc names.'),
    lint: () => outcome('lint', lint(false), 'design-hub check --fix for formatting; the rest by hand.'),
    build: async () => outcome('build', await build(), 'A missing walkthrough image fails here first.'),
    elyx,
    guides: () => guides(all),
    states: () => states(all),
    contacts: () => contacts(all, allow),
    gate,
    secrets,
  };
  const steps: Step[] = [];
  for (const name of STEPS)
    steps.push(skip.has(name) ? { step: name, ok: true, skipped: 'skipped by --skip' } : await run[name]());
  return { ok: steps.every((s) => s.ok), steps };
}
