#!/usr/bin/env bash
# PostToolUse on Write, Edit or MultiEdit: when the file is Markdown, remind the agent to
# run the emil-writing-skills pass before reporting the change done.
set -u
f=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)
case "$f" in
  *.md|*.MD) ;;
  *) exit 0 ;;
esac
case "$f" in
  */node_modules/*) exit 0 ;;
esac
jq -cn --arg f "$f" '{
  systemMessage: ("Markdown changed: " + ($f | split("/") | last) + ". Run /emil-writing-skills on it before reporting done."),
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: ("You changed the Markdown file " + $f + ". Before you report this work done, invoke the emil-writing-skills skill (Skill tool, skill: emil-writing-skills) and apply its checklist to that file: every line changes what a reader or agent does, no hedge words, rules carry their why, nothing stale against the current code and decisions, dates and paths it cites still exist. Fix what fails, then say in your reply that the pass ran.")
  }
}'
