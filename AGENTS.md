# Design Hub: contributor guide

This repo is the product. A project that uses it is a different thing: the thin folder `packages/create-design-hub/template/` scaffolds, which installs `design-hub` and keeps only prototypes, kit materials and docs. Work here changes what every project gets on its next version bump.

| Path | What it is |
| --- | --- |
| `packages/design-hub/` | The npm package: the hub (`shell/`), the kit (`kit/`), the pure kernel (`core/`), the Node side (`server/`), the Vite plugin (`vite/`), the Vercel entries (`vercel/`), the `design-hub` CLI (`scripts/`), the `miles-*` skills (`skills/`), the scaffolds `design-hub new` copies (`templates/`). `AGENTS.md` there holds its layers and rules. |
| `packages/create-design-hub/` | `npm create design-hub`: the scaffolder (`index.mjs`), the thin project it copies (`template/`), and the setup app for people without a terminal (`setup/`). |
| `packages/create-design-hub/template/` | Also the sample project: a workspace member on `design-hub: workspace:*`, so `pnpm dev` at the root runs the hub on it. |
| `Design Hub.command` | Double-click: the setup app, linking this checkout's package into the project it makes. |

## Commands

From the root:

```bash
pnpm install        # builds packages/design-hub/dist on the way (prepare)
pnpm dev            # the hub on the sample project
pnpm check          # tsc and Biome over every package
pnpm test           # node:test suites of both packages
pnpm quality        # fallow over real test coverage, zero findings
pnpm build          # packages/design-hub/dist from the TypeScript sources
pnpm template -- --path /abs/new-project --visibility none --link "$PWD/packages/design-hub"   # a project on this checkout
```

`pnpm check`, `pnpm test` and `pnpm quality` pass before a change is done. Scope each commit to one package.

## Rules that cross the packages

- A project never edits the package and never reads it to do prototype work. Anything an agent in a project needs is in the project's `AGENTS.md` and skills; if a rule is missing there, add it there, not in prose a project cannot see.
- `@kit/<name>` resolves to the project's `kit/<name>` first and the package's `kit/<name>` second (`vite/kit.ts`). A file added to the package's kit is public API: a project may shadow it. Never rename one without a version note.
- Commands keep the contract in `scripts/lib/cli.ts`: flags only, no prompts, one JSON object on stdout, `--help` for the schema.
- The skills ship in the package and are copied into projects by `design-hub skills`. Edit them here only.
- `design-hub` and `create-design-hub` publish in lockstep at the same version: the scaffolder pins the hub to its own version.
- Before publishing a copy of this repo, `pnpm release-check --term <client name>` must be clean.
