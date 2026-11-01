#!/bin/bash
# Double-click to open this project's Design Hub in the browser. Keep the
# window open while you work; closing it stops the hub.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ ! -x node_modules/.bin/design-hub ]; then
  echo "Installing the project first (one time)."
  command -v pnpm >/dev/null 2>&1 && pnpm install || npx --yes pnpm@12 install
fi
[ -f .env ] && grep -q '^PORT=[0-9]' .env || node_modules/.bin/design-hub bootstrap --no-install >/dev/null
exec node_modules/.bin/design-hub open
