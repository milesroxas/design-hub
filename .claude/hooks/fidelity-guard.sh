#!/usr/bin/env bash
# PostToolUse on Write|Edit|MultiEdit: the fidelity guard (prototypes/_scripts/guard.ts)
# over the written file when it sits under prototypes/. Thresholds are in
# prototypes/checks.json. Any failure here exits 0 with nothing said, so a
# broken guard can never be the reason the user is stuck.
set -u
root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
guard="$root/prototypes/_scripts/guard.ts"
[ -f "$guard" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
node "$guard" --hook 2>/dev/null || exit 0
