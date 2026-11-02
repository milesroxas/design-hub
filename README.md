# Design Hub

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](packages/design-hub/package.json)

Design work on one product or website, as a product you install. A project is a thin folder: its prototypes, the materials they are drawn with (tokens, the shell's chrome, icons), the design rules, the walkthroughs reviewers read, and their comments. Everything else is the `@milesroxas/design-hub` package: the hub that lists and serves the prototypes, the review panel and its API, the password gate, the kit, the `design-hub` command, and the skills that tell a coding agent how to behave.

A prototype holds every state on a dial, behind a password, outside the live product. Reviewers comment on the state they are looking at, and the port to production builds from the same list of states.

New here and not a developer? Read the [guide](docs/guide/README.md): setup, working with Claude, sharing a link, comments.

## Start a project

```sh
npm create @milesroxas/design-hub@latest -- --path ~/Design/acme-site
cd ~/Design/acme-site
pnpm bootstrap        # a free port into .env
pnpm dev              # http://localhost:<PORT>
```

With Claude Code, install the one global skill and ask it to start a project. It asks every question up front, then runs the same two commands:

```sh
npx skills add milesroxas/design-hub --skill miles-design-hub -g -y
```

Or paste this into Claude Code and let it do both:

```text
Install the Design Hub skill globally:

npx skills add milesroxas/design-hub --skill miles-design-hub -g -y

Then use the miles-design-hub skill to start a new Design Hub project for <project name>.
Ask me every setup question in one message before you create anything.
```

Once the skill is installed, a new session needs only the last two lines.

Without a terminal: download this repo as a ZIP and double-click `Design Hub.command`. A page asks for a name and a place, creates the project, installs it and opens the hub. The project gets its own `Design Hub.command` to open it again later.

## What a project holds

```
prototypes/<slug>/    README.md, index.tsx, styles.css, fixtures.json
kit/                  tokens.css, shell.ts, icons.ts, AppShell, SiteShell
docs/sprints/<feature>/   design-doc.md, guide.md, comments.md, port.md
DESIGN.md  PRODUCT.md  AGENTS.md
api/review.ts  proxy.ts  vercel.json      one line each
.claude/              hooks and the miles-* skills, installed from the package
.design-hub/checks.json                   the Jev thresholds
```

The project's `AGENTS.md` is the whole contract an agent reads. Nothing in `node_modules/@milesroxas/design-hub` is ever edited or read for prototype work, so the surface an agent works on stays small however many prototypes a project has.

## What the package does

- **The hub.** Lists every prototype from its README, groups them by feature, serves each at `/<slug>/` and each walkthrough at `/guide/<feature>/`. A new folder shows up without a restart.
- **Every state on a dial.** DialKit controls through `@kit/dials`; `longest`, `empty`, `max` and `missing` fixture sets derived by `@kit/fixtures`.
- **The kit.** `@kit/ui`, `@kit/Space`, `@kit/Variants`, `@kit/Icon` and the rest. `@kit/<name>` resolves to the project's `kit/<name>` first and the package's second, so a project forks a piece by copying the file.
- **Review on the deployed site.** A shared password to view, invite links to comment, comments pinned to the element and the exact dial state. Upstash Redis when deployed, a file in dev.
- **The command.** `design-hub dev|build|new|guide|check|preflight|comments|people|bootstrap|skills|…`. Flags only, one JSON object on stdout, `--help` for the schema.
- **Guardrails.** The fidelity guard on every write, axe in dev, Biome and TypeScript on `check`, every check a share link needs on `preflight`.
- **Skills.** The `miles-*` skills ship in the package; `design-hub skills` copies them into a project, so a version bump updates them.

A version bump brings a project everything above, with no change to its own files. Inspect tools for the port to production will arrive the same way.

## This repo

| Path | What it is |
| --- | --- |
| `packages/design-hub/` | The npm package. |
| `packages/create-design-hub/` | `npm create @milesroxas/design-hub`: the scaffolder, the thin template, the setup app. The template is also the sample project this repo runs. |
| `Design Hub.command` | The setup app, for people who never open a terminal. |

```sh
pnpm install     # builds the package
pnpm dev         # the hub on the sample project
pnpm check && pnpm test && pnpm quality
```

The contributor guide is [AGENTS.md](AGENTS.md); the package's own is [packages/design-hub/AGENTS.md](packages/design-hub/AGENTS.md).

## Deploy and review

Pushing `main` of a project deploys it to its linked Vercel project; `pnpm bootstrap --vercel <project>` links it and sets the password gate's environment. The shared password opens the site to view. An invite link, made by an editor, signs one named person in to comment. A comment is pinned to the element and to the state: the URL and every dial value, so opening it later reopens what the reviewer saw. Add `--review` to the bootstrap to turn comments on; `pnpm dev` runs the same panel against a local store. The details are in [packages/design-hub/README.md](packages/design-hub/README.md).

## TypeSafe checks (optional)

With a TypeSafe key in a project's `.env` (`pnpm bootstrap --typesafe-key <key>`), Jev answers the judgments that must come out the same on every run: the fidelity guard's four semantic rules, the pre-flight's state and contact checks, comment triage, and the skill hint. Every threshold is in `.design-hub/checks.json`; `pnpm calibrate` sets them from labelled judgments. Without a key, every Jev question is skipped and nothing is printed.

## Contributing

Issues and pull requests are welcome. `pnpm check`, `pnpm test` and `pnpm quality` pass before a pull request, and `pnpm quality` passes with zero findings. Before publishing a copy of this repo, `pnpm release-check --term <client name>` confirms no tracked file names the client.

## License

[MIT](LICENSE) © Miles Roxas
