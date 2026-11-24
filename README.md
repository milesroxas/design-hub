# Design Hub

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](packages/design-hub/package.json)

Prototype every state of a product, website or brand piece in code, share it behind a password, and port it from the same list of states. A project is a thin folder of prototypes, materials and docs; everything else installs as `@milesroxas/design-hub`.

Not a developer? Start with the [guide](docs/guide/README.md).

## Start a project

**With Claude Code** (paste this; after the first time, only the last two lines):

```text
Install the Design Hub skill globally:

npx skills add milesroxas/design-hub --skill miles-design-hub -g -y

Then use the miles-design-hub skill to start a new Design Hub project for <project name>.
Ask me every setup question before you create anything.
```

**In a terminal:**

```sh
npm create @milesroxas/design-hub@latest -- --path ~/Design/acme-site --track website --platform webflow
cd ~/Design/acme-site && pnpm dev    # the first start claims a free port for this folder
```

**Without a terminal:** download this repo as a ZIP and double-click `Design Hub.command`.

### Tracks

Pick one or more when the project is made; they decide each prototype's shell, the starting samples, and how work is handed off.

| Track | For | Draws in | Hand-off |
| --- | --- | --- | --- |
| `product` | App screens | `AppShell` | A spec for the client's engineers |
| `website` | Pages on Webflow, Payload, WordPress or EmDash (Astro or Next) | `SiteShell` | A build on the site's platform |
| `brand` | Social posts, slides, print | Artboards at real size | PNG and PDF from `design-hub export` |

They live in `.design-hub/project.json`; `design-hub tracks set` changes them.

### Worktrees and harnesses

Nothing to set up. Each folder claims its own port on its first `pnpm dev`, in a plain `git worktree`, T3 Code, Conductor, Claude Code or Cursor. A harness that assigns ports sets `DESIGN_HUB_PORT` (`CONDUCTOR_PORT` also works).

## What a project holds

```
prototypes/<slug>/        README.md, index.tsx, styles.css, fixtures.json
kit/                      tokens.css, shell.ts, icons.ts, AppShell, SiteShell
docs/sprints/<feature>/   design-doc.md, guide.md, comments.md, port.md
DESIGN.md  PRODUCT.md  AGENTS.md
.design-hub/              project.json (tracks), checks.json (Jev thresholds)
.claude/                  hooks and the miles-* skills, copied from the package
api/review.ts  proxy.ts  vercel.json   one line each
```

`AGENTS.md` is everything an agent reads. The package in `node_modules` is never edited or read for prototype work, so the agent's surface stays small.

## What the package does

- **Hub.** Lists prototypes by feature and track; serves each at `/<slug>/` and its walkthrough at `/guide/<feature>/`.
- **States on dials.** DialKit through `@kit/dials`; `longest`, `empty`, `max` and `missing` fixture sets from `@kit/fixtures`.
- **Kit.** `@kit/ui`, `@kit/Space`, `@kit/Artboard` and more. A project's `kit/<name>` overrides the package's.
- **Real content.** `fixtures-pull` reads Webflow, Payload, WordPress, or a JSON file (EmDash, anything else).
- **Brand export.** `export` writes artboards to PNG and PDF through the installed Chrome.
- **Review.** A shared password to view, invite links to comment, comments pinned to the element and dial state.
- **Guardrails.** The fidelity guard on every write, axe in dev, `check` (TypeScript, Biome), `preflight` before sharing.
- **CLI and skills.** `design-hub <command>`: flags only, one JSON object out, `--help` for the schema. The `miles-*` skills ship with it.

A version bump brings all of this to a project without touching its files. Inspect tools for the port to production will arrive the same way.

## Deploy and review

`pnpm bootstrap --vercel <project>` links a project and sets its password gate; pushing `main` deploys it. Add `--review` to turn on comments. Opening a comment reopens the exact URL and dial values the reviewer saw. Details: [packages/design-hub/README.md](packages/design-hub/README.md).

## TypeSafe checks (optional)

With a key in the project's `.env` (`pnpm bootstrap --typesafe-key <key>`), Jev answers the judgments that must come out the same every run: the fidelity guard, the pre-flight's state and contact checks, comment triage, the skill hint. Thresholds are in `.design-hub/checks.json`; `pnpm calibrate` tunes them. Without a key, those checks are skipped.

## This repo

| Path | What it is |
| --- | --- |
| `packages/design-hub/` | The npm package |
| `packages/create-design-hub/` | The scaffolder, the template (also this repo's sample project), the setup app |
| `Design Hub.command` | The setup app launcher |

```sh
pnpm install     # builds the package
pnpm dev         # the hub on the sample project
pnpm check && pnpm test && pnpm quality
```

Contributor rules: [AGENTS.md](AGENTS.md) and [packages/design-hub/AGENTS.md](packages/design-hub/AGENTS.md). Pull requests pass all three commands, `quality` with zero findings. Before publishing a copy, `pnpm release-check --term <client name>` must be clean.

## License

[MIT](LICENSE) © Miles Roxas
