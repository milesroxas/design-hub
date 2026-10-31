#!/usr/bin/env bash
# UserPromptSubmit: one line naming the likely miles-* skill, from Jev, when
# TypeSafe is on (prototypes/_scripts/skill-hint.ts). Silent when it is off,
# and on any failure, so a prompt is never held up by the hint.
set -u
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
hint="$root/prototypes/_scripts/skill-hint.ts"
[ -f "$hint" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
node "$hint" --hook 2>/dev/null || exit 0
