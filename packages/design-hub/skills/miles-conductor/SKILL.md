---
name: miles-conductor
description: "Run this project in Conductor (conductor.build) workspaces: the settings file, a port per workspace, and the machine port registry that keeps projects off each other's ports. Load when the user mentions Conductor, workspaces, parallel agents, or a dev server that answers with the wrong project. Triggers on: Conductor, workspace, workspaces, CONDUCTOR_PORT, parallel agents, port taken, port collision, wrong site, ports.json, port registry."
---

# Conductor

Conductor gives each workspace its own `$CONDUCTOR_PORT`, but never checks that the port is free. A dev server orphaned in another project can still hold it, and the workspace's Open button then shows the other project with no error. Everything here exists to make that failure loud.

## Set up

1. From the project root: `pnpm bootstrap --conductor --branch <integration branch>`. It writes `.conductor/settings.toml`: setup runs `pnpm bootstrap` in each new workspace, run starts `pnpm dev`, and the preview URL is the workspace's port. A file the user has edited is kept, and the JSON warns that it differs.
2. Commit `.conductor/settings.toml`. `.conductor/settings.local.toml` is gitignored, for one person's overrides.
3. Tell the user to add the repository in Conductor and set its base branch to the same branch. Conductor keeps that setting in its app only, so nothing in the repo can set or check it.

## Ports

```
Where is the dev server running?
├── A Conductor workspace → $CONDUCTOR_PORT, always. The dev server reads it before .env.
│                           It never enters the machine registry: Conductor owns that range.
└── A main checkout       → the port pnpm bootstrap picked, written to .env and claimed in
                            ~/.config/design-hub/ports.json ($DESIGN_HUB_PORTS overrides the path).
                            Bootstrap skips every port another project claims, running or not.
```

On a taken port, `pnpm dev` refuses to start (`strictPort`) and `pnpm bootstrap` names the process and its folder. Then:

1. Never pass another port. Why: the Open button and `.claude/launch.json` keep pointing at the configured one, so a second port is a server nobody opens.
2. Find the holder: `lsof -nP -iTCP:<port> -sTCP:LISTEN`, then `lsof -a -p <pid> -d cwd` for its folder.
3. An orphaned server of this project: stop it. A server of another project: ask the user before stopping it.

When the user keeps their own record of which project owns which port, add this project's port to it too.

## Nothing shared

Workspaces share no database and no container. The review store's local copy is a file in each checkout's `.design-hub/`, and the deployed store is remote, so two workspaces never see each other's local comments.
