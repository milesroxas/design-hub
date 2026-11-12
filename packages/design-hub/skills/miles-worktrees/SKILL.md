---
name: miles-worktrees
description: "Run this project in more than one checkout at once: git worktrees, T3 Code, Conductor, Claude Code, Cursor, or any harness that gives each agent its own folder. A port per folder, the harness port variables, the machine port registry, Conductor's settings file, and what checkouts never share. Load when the user mentions worktrees, workspaces, parallel agents, a harness, or a dev server that answers with the wrong project. Triggers on: worktree, worktrees, workspace, workspaces, parallel agents, Conductor, T3 Code, CONDUCTOR_PORT, DESIGN_HUB_PORT, port taken, port collision, wrong site, ports.json, port registry."
---

# Worktrees and parallel agents

Every checkout of this project is its own folder with its own dev server and its own port: the main clone, each `git worktree`, each harness workspace. Two folders on one port is the failure everything here prevents. The second server refuses to start, or the browser shows the other folder's prototypes with no error.

## Start a new checkout

```bash
pnpm install
pnpm dev
```

Nothing else is needed, in any harness. On its first start `pnpm dev` claims a free port for the folder and writes it to `.env` and `.claude/launch.json`; later starts reuse it. Both files are gitignored because they belong to the folder, so worktrees never conflict on them. `pnpm bootstrap` remains the full setup (TypeSafe key, Vercel) but is not needed to run.

Some harnesses copy `.env` from the main checkout. That is fine: the copied `PORT` is claimed by the other folder, so this folder gets its own and the dev server says so on stderr. The copied `GATE_*` and `TYPESAFE_API_KEY` keep working.

## Ports

```
Which port does the dev server use?
├── $DESIGN_HUB_PORT set → that port. Any harness or script that hands out ports sets this.
├── $CONDUCTOR_PORT set  → that port. Conductor sets it per workspace.
└── neither              → this folder's PORT in .env, claimed in the machine registry
                           (~/.config/design-hub/ports.json; $DESIGN_HUB_PORTS moves it).
                           A port another folder claims is skipped, running or not.
```

A harness port never enters `.env` or the registry: the harness owns that range. A bare `$PORT` is ignored on purpose. Why: shells and other tools export it for their own servers, and the hub would start on it.

A claim lasts as long as its folder. A deleted worktree's claim is dropped the next time any folder claims a port.

On a taken port, `pnpm dev` refuses to start (`strictPort`) and `pnpm bootstrap` names the process and its folder. Then:

1. Never pass another port. Why: the harness's Open button, `.env` and `.claude/launch.json` keep pointing at the configured one, so a second port is a server nobody opens.
2. Find the holder: `lsof -nP -iTCP:<port> -sTCP:LISTEN`, then `lsof -a -p <pid> -d cwd` for its folder.
3. An orphaned server of this folder: stop it. A server of another folder or project: ask the user before stopping it.

## Harnesses

- **T3 Code, Claude Code worktrees, Cursor, plain `git worktree add`.** Nothing to configure. A harness setup step needs only `pnpm install`. A harness that starts the server itself and picks ports sets `DESIGN_HUB_PORT`.
- **Conductor.**
  1. From the project root: `pnpm bootstrap --conductor --branch <integration branch>`. It writes `.conductor/settings.toml`: setup installs and bootstraps each new workspace, run starts `pnpm dev`, and the preview URL is the workspace's `$CONDUCTOR_PORT`. A file the user has edited is kept, and the JSON warns that it differs.
  2. Commit `.conductor/settings.toml`. `.conductor/settings.local.toml` is gitignored, for one person's overrides.
  3. Tell the user to add the repository in Conductor and set its base branch to the same branch. Conductor keeps that setting in its app only, so nothing in the repo can set or check it.

  Conductor never checks that its port is free. Why it matters: a server orphaned in another project can hold it, and the Open button then shows that project. The bootstrap in the workspace's setup fails loudly when that happens.

## Nothing shared

Checkouts share no database and no container. The review store's local copy is a file in each checkout's `.design-hub/`, and the deployed store is remote, so two checkouts never see each other's local comments.

When the user keeps their own record of which project owns which port, add this folder's port to it too.
