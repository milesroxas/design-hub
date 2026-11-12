# Design work

Prototypes for one product or website, built on [Design Hub](https://github.com/milesroxas/design-hub). One repo holds the prototypes, the design rules, the walkthroughs reviewers read, and their comments.

```bash
pnpm install
pnpm dev           # http://localhost:<PORT>; the first start claims a free port for this folder
```

Or double-click `Design Hub.command`.

Not a developer? The [guide](https://github.com/milesroxas/design-hub/tree/main/docs/guide) covers setup, working with Claude, sharing a link and comments.

| Path | What goes there |
| --- | --- |
| `prototypes/<slug>/` | One prototype: its README, code, styles and fixtures. `sample-list/` is the reference; delete it once the project has a feature. |
| `kit/` | The project's materials: `tokens.css`, `shell.ts` (brand and navigation), `icons.ts`, the disposable `AppShell` and `SiteShell`. |
| `docs/sprints/<feature>/` | A feature's design doc, walkthrough, pulled comments and port report. |
| `DESIGN.md`, `PRODUCT.md` | The recorded design system and who the product is for. |
| `.claude/` | Claude Code hooks and the `miles-*` skills (`pnpm skills` refreshes them from the package). |

The rules for people and agents are in [AGENTS.md](AGENTS.md). Deploying, the password gate and review comments: the `miles-deploy` and `miles-review` skills, or `pnpm commands` for every command.
