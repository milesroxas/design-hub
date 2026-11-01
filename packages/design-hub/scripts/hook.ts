#!/usr/bin/env node
/// <reference types="node" />
// `design-hub hook <name>`: the Claude Code hooks a project's
// .claude/settings.json runs. Each reads the hook's JSON on stdin and fails
// open: any error exits 0 with nothing said, so a broken hook can never be
// the reason the user is stuck.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { guardHook } from './guard.ts';
import { skillHintHook } from './skill-hint.ts';

const MD = /\.md$/i;

/** PostToolUse on a Markdown file: ask for the writing pass before the change is reported done. */
export function mdWriting(input: {
  tool_input?: { file_path?: string };
  tool_response?: { filePath?: string };
}) {
  const file = input.tool_input?.file_path ?? input.tool_response?.filePath ?? '';
  if (!MD.test(file) || file.includes('/node_modules/')) return null;
  return {
    systemMessage: `Markdown changed: ${basename(file)}. Run /emil-writing-skills on it before reporting done.`,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `You changed the Markdown file ${file}. Before you report this work done, invoke the emil-writing-skills skill (Skill tool, skill: emil-writing-skills) and apply its checklist to that file: every line changes what a reader or agent does, no hedge words, rules carry their why, nothing stale against the current code and decisions, dates and paths it cites still exist. Fix what fails, then say in your reply that the pass ran.`,
    },
  };
}

export const HOOKS = ['fidelity-guard', 'md-writing', 'skill-hint'] as const;

export async function runHook(name: string): Promise<void> {
  try {
    switch (name) {
      case 'fidelity-guard':
        return await guardHook();
      case 'skill-hint':
        return await skillHintHook();
      case 'md-writing': {
        const output = mdWriting(JSON.parse(readFileSync(0, 'utf8')));
        if (output) console.log(JSON.stringify(output));
        return;
      }
      default:
        return;
    }
  } catch {
    // Fail open.
  }
}
