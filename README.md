# Design Hub

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](prototypes/package.json)

A GitHub template for design work on one product or website. One repo holds the prototypes, the design rules, the walkthroughs reviewers read, their comments, and the skills that tell a coding agent how to behave in it.

A prototype here holds every state on a dial, behind a password, outside the live project. Reviewers comment on the state they are looking at, and the port to production builds from the same list of states.

## Features

- **Disposable prototypes** in one Vite, React and TypeScript app. Each folder is one prototype; the hub lists them, groups them by feature and serves each at `/<slug>/`.
- **Every state on a dial.** DialKit controls switch fixtures, variants and scenarios live, and the worst-case content (`longest`, `empty`, `max`, `missing`) is derived for you.
- **Walkthroughs** written in Markdown under `docs/sprints/<feature>/guide.md`, served at `/guide/<feature>/` beside the prototype.
- **Review on the deployed site.** A shared password to view, invite links to comment, and comments pinned to the element and the exact dial state.
- **Agent skills** (`miles-*`) for Claude Code that own the judgment, with scripts that own the mechanics, so a step runs the same way every time.
- **Guardrails**: a fidelity guard on every write, axe in dev, Biome, layer boundaries checked by fallow, and `node:test` suites for the infrastructure.

## Requirements

- Node.js 22.18 or later and pnpm.
- [GitHub CLI](https://cli.github.com/) (`gh`), to create a project from the template.
- [Claude Code](https://claude.com/claude-code), to use the skills. The app runs without it.
- Optional: a Vercel account to deploy and share, [Paper](https://paper.design/) for comps, a TypeSafe key for the Jev checks.

## Quick start

### Without a terminal

1. Install [Node.js](https://nodejs.org) (the LTS version).
2. On this repo's GitHub page, choose **Code**, then **Download ZIP**, and open the ZIP.
3. Double-click `Design Hub.command`. The first time, macOS asks whether to open a file from the internet: Control-click the file and choose **Open**, or allow it under System Settings, Privacy & Security.

A page opens in the browser. It asks for a project name, saves the project to `~/Design/<name>` (or a folder you pick), and can create a private GitHub repo when the GitHub CLI is installed. When it is done, **Open Design Hub** starts the hub. The project gets its own `Design Hub.command`: double-click it to open the hub again later. Keep the Terminal window it opens; closing it stops the hub.

### With Claude Code

With Claude Code, install the one global skill, then ask Claude to start a project. It asks every question up front (where on disk, which GitHub owner, Paper comp or the sample, shell or not, TypeSafe or not, Conductor or not), creates the repo from this template and runs the setup.

```sh
npx skills add milesroxas/design-hub@miles-design-hub -g -y
```

By hand, from a clone or a repo made with **Use this template**:

```sh
cd prototypes
pnpm bootstrap          # picks a free port into .env and .claude/launch.json, runs pnpm install
pnpm dev                # http://localhost:<PORT>
```

## Usage

Run every command from `prototypes/`. Each script prints one JSON object and `--help` prints its schema; `pnpm commands` lists them all.

| Command | What it does |
| --- | --- |
| `pnpm dev` | The hub, every prototype and the review panel, on the port in `.env`. |
| `pnpm new <slug> --feature <feature>` | A prototype on the quiet canvas, with the variant picker and dials. |
| `pnpm new <slug> --app --sprint --feature <feature>` | The feature's primary prototype, inside the product shell. |
| `pnpm new:guide <feature>` | The feature's walkthrough. |
| `pnpm check` | TypeScript and Biome. Must pass before a change is done. |
| `pnpm test` | The infrastructure's `node:test` suites. |
| `pnpm quality` | fallow over real test coverage: dead code, duplication, layers, complexity, for `prototypes/` and `setup/`. |
| `pnpm preflight` | Every check a share link needs. |
| `pnpm comments pull` | Review comments into `docs/sprints/<feature>/comments.md`. |

The full contract for people and agents is [`prototypes/AGENTS.md`](prototypes/AGENTS.md).

## Project structure

| Path | What goes there |
| --- | --- |
| `Design Hub.command`, `setup/` | The setup app: a page in the browser that creates a project from the template, sets it up and starts the hub, for people who never open a terminal. No dependencies; it runs `create.mjs` and `pnpm bootstrap` underneath. |
| `prototypes/` | The app and the infrastructure around it: the review API, the password gate, the scripts. `sample-list/` is the reference prototype. |
| `DESIGN.md`, `PRODUCT.md`, `.impeccable/` | Impeccable context: the recorded design system with its named rules and the `Shell` section, who the product is for, detector config. Run `/impeccable doctor` to check them. |
| `docs/` | Written documentation, an Obsidian vault. `sprints/<feature>/` holds a feature's design doc, walkthrough, pulled comments and port report. |
| `sketches/paper/` | Exports from Paper Desktop that a document cites. The comps stay in Paper. |
| `plans/` | Plans written by the `improve-animations` skill. |
| `design-system/` | Only with the Elyx add-on: a token project generated from `prototypes/_kit/tokens.css` by `pnpm elyx`. Never edited by hand. |
| `.claude/` | The `miles-*` skills, the launch config, and the hooks: the writing pass on every `.md` edit, the fidelity guard on every write under `prototypes/`, and the skill hint on every prompt. |

The hub's own interface (index, walkthroughs, review panel, password page) is neutral by design: Geist, Geist Mono and pure greys from `prototypes/_shell/system.css`. A project's design lives in `prototypes/_kit/tokens.css` and `DESIGN.md` and never restyles the hub.

## Skills

Judgment lives in skills; mechanics live in the scripts they call (`prototypes/_scripts/`). A prose step gets skipped on some runs and the failure is silent; a script runs the same way every time.

| Skill | Owns |
| --- | --- |
| `miles-design-hub` | Entry: the questions, the repo, the setup, the handoff. Global install only. |
| `miles-prototype` | The low-gravity rules, the fidelity ceiling, DialKit patterns. |
| `miles-new-feature` | Feature scaffolding and the `docs/sprints/` convention. |
| `miles-get-hostile` | Hostile fixtures, the Webflow pull, and the design answers for edge cases. |
| `miles-paper-to-prototype` | Paper MCP output into prototype conventions. |
| `miles-deploy` | The pre-flight, the Vercel link, the password gate, the review store. |
| `miles-review` | Review comments: pulling, sorting, acting, resolving, and who may comment. |
| `miles-port` | An approved prototype into production, Webflow or another codebase. |
| `miles-conductor` | Conductor workspaces and the machine's port registry. |

A clone already has them in `.claude/skills/`. To install them globally: `npx skills add milesroxas/design-hub -g -y`.

## Review and deploy

Pushing `main` deploys `prototypes/` to the linked Vercel project; `pnpm bootstrap --vercel <project>` links it and sets the password gate's environment. The deployed site has two ways in. The shared password opens it to view. An invite link, made by an editor, signs one named person in to comment. A comment is pinned to the element and to the state: the URL and every dial value, so opening it later reopens what the reviewer saw. Add `--review` to the bootstrap to turn comments on; `pnpm dev` runs the same panel against a local store. The details are in [`prototypes/README.md`](prototypes/README.md).

## TypeSafe checks (optional)

With a TypeSafe key in `prototypes/.env` (`pnpm bootstrap --typesafe-key <key>`), Jev answers the judgments that must come out the same on every run:

- **The fidelity guard**, a hook on every write under `prototypes/`: data fetching, an abstraction used once, handling no fixture reaches, a state the README does not list. Code checks (an import that crosses prototypes, a new dependency) run without TypeSafe.
- **The pre-flight**: whether a prototype renders a state its README omits, and whether an email or phone number in the fixtures belongs to a private person.
- **Comment triage**: each comment's kind and state.
- **The skill hint**: one line naming the `miles-*` skill a prompt needs.

Every threshold is in `prototypes/checks.json`. Every judgment is logged to `.design-hub/jev.jsonl` with an id; label them with `pnpm calibrate --yes <id>` or `--no <id>`, and `pnpm calibrate --write` sets the thresholds from the labels. Without a key, every Jev question is skipped and nothing is printed.

## Contributing

Issues and pull requests are welcome.

- Scope each commit to one folder, for example `prototypes: the empty state on the items list`.
- `pnpm check`, `pnpm test` and `pnpm quality` pass before a pull request. `pnpm quality` passes with zero findings; keep it there.
- Plain git handles the image exports. Add Git LFS only if video or very large files show up.
- Before publishing a copy of this template, run `pnpm release-check --term <client name>` from `prototypes/` to confirm no tracked file names the client.

## License

[MIT](LICENSE) © Miles Roxas
