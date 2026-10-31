#!/bin/bash
# Double-click to set up a Design Hub project, or to open one that is set up.
# It starts a small local page in the browser (setup/server.mjs); nothing else
# needs a terminal. Keep the window open while you work.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
clear

if ! command -v node >/dev/null 2>&1 ||
  ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  echo "Design Hub needs Node.js 22.18 or newer."
  if command -v osascript >/dev/null 2>&1; then
    osascript -e 'display dialog "Design Hub needs Node.js, a free download.\n\nInstall the LTS version from nodejs.org, then double-click Design Hub again." buttons {"Cancel", "Open nodejs.org"} default button 2 with title "Design Hub" with icon caution' >/dev/null 2>&1 &&
      open "https://nodejs.org/en/download"
  fi
  exit 1
fi

exec node setup/server.mjs
