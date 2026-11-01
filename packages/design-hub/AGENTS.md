# design-hub: the package

The product. A project installs this and never edits it, so a change here reaches every project on its next version bump, and a project's agent never reads this code. Keep it that way: anything a project needs to know goes in `create-design-hub/template/AGENTS.md` or a skill, never here.

## Layers

From the inside out, enforced by `pnpm quality` (`.fallowrc.jsonc`, boundaries):

| Layer | What | May import |
| --- | --- | --- |
| `core/` | The pure kernel: README states, the catalog, fixture sets, checks, the Jev client, contacts, bytes, images, the review domain. No React, no DOM, no file system, no network except what a caller passes in. | nothing outside itself |
| `kit/` | What prototypes import through `@kit/*`: dials, Variants, Space, ViewTools, Icon, fixtures, format, hooks, motion, prefs, ui/. Every export is public API: a project may shadow any file by name. | `core` |
| `shell/` | The browser hub: index, loader, walkthroughs, the review panel. Its `index.html` is the Vite root. | `core`, `kit` |
| `server/` | Node and HTTP: the review API, signed sessions, the stores, env, paths, the dev server adapter. | `core` |
| `vercel/` | The deployed entries a project's `api/review.ts` and `proxy.ts` import. | `core`, `server` |
| `vite/` | The plugin: the registry module, the `@kit` resolver, the Markdown compiler, the gate's font. | `core`, `server`, `vercel` |
| `scripts/` | The `design-hub` CLI, one file per command. | `core`, `server`, `vite` |

`templates/` is copied by `design-hub new`; `skills/` by `design-hub skills`; `configs/` holds what a project's tsconfig and Biome run extend.

## Rules

- Relative imports in `core`, `server`, `scripts`, `vite` and `vercel` carry the `.ts` extension: Node runs the sources directly under test, and `tsc` rewrites them for `dist/`. `kit/` and `shell/` ship as source for Vite.
- Every command keeps the contract in `scripts/lib/cli.ts`: `spec` and `main` exported, flags only, no prompts, one JSON object on stdout, `--help` prints the schema, `ok: false` carries `fix`. `scripts/cli.ts` is the only entry.
- Paths come from `server/paths.ts`: `ROOT` is the project (found from the working directory), `PACKAGE` is this package. Never resolve a project path from `import.meta.url`.
- Checks come from `server/checks.ts` in Node and from the project's bundled `checks.json` on Vercel; `core` never reads a file.
- Infrastructure is tested with `node:test` beside the file. UI is not unit-tested by policy; `pnpm quality` holds every UI function under cyclomatic 10.
- `pnpm check`, `pnpm test` and `pnpm quality` pass, with zero findings, before a change is done.
