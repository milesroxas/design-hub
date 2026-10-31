---
name: miles-design-hub
description: "Start a new design project from the Design Hub template (milesroxas/design-hub): ask every question up front, create the repo with the skill's own script, run the setup, hand off to the Paper skill. Global install only; never load inside a project. Triggers on: design hub, new design project, start a project, new prototype repo, set up prototypes, from the template."
---

# Design Hub

The entry point. The user never starts in a terminal: they ask for a new project, this skill asks every question before it touches disk, then runs two scripts and hands off. A question asked up front is one Claude never guesses later.

## 1. Ask, all at once, before anything runs

Ask these in one message and wait for every answer. Defaults in brackets.

1. **Where should the project live?** An absolute path; its folder name becomes the repo name. [`~/SITES/<name>`]
2. **Which GitHub account or org owns the repo, private or public, or no GitHub repo?** [the account `gh` is signed in as, private]
3. **Start from a Paper comp or from the sample prototype?** [sample]
4. **If Paper: the link to the Paper frame or page.**
5. **Does the design include a shell? Which frames hold it?** A product shell is sidebar, top bar and content; a website shell is header and footer, plus a pre-footer when the design treats it as a global. [no shell: prototypes stand in the Space]
6. **Install the `miles-*` skills globally or for this project only?** [project only; the clone already has them]
7. **Turn on TypeSafe checks? If yes, the TypeSafe API key.** [off] Why opt-in: a template anyone can use cannot require a paid account.
8. **Will the project run in Conductor workspaces? If yes, the branch they land on.** [no]

The template is `milesroxas/design-hub` unless the user names a fork. Comments and the share link come later, with `miles-deploy`, because they need a Vercel project.

## 2. Check the machine

```bash
node --version     # 22.18 or newer; else install the current LTS
pnpm --version     # else: corepack enable
gh auth status     # only with a GitHub repo; else ask the user to run gh auth login
```

The skills these lean on, installed globally: `emil-prototype`, `emil-writing-skills`, `impeccable`. Check `~/.claude/skills/` and install any that is missing with `npx skills add <source> -g -y`; say which were added.

## 3. Create the project

```bash
node <this skill's folder>/scripts/create.mjs --path <path> [--owner <owner>] --visibility private|public|none [--template <owner/repo>]
```

It creates the GitHub repo from the template and clones it to the path, or with `none` a local repo with fresh history. It prints one JSON object; `ok: false` names the fix. A second run finds the project and changes nothing, so rerun it after a fix instead of finishing by hand.

## 4. Run the setup

```bash
pnpm --dir <path>/prototypes bootstrap [--typesafe-key <key>] [--conductor --branch <branch>]
```

It picks a port nothing holds and no other project claims, writes it to `.env` and `.claude/launch.json`, installs, and applies the flags. Read the JSON's `warnings`. With question 6 answered globally: `npx skills add milesroxas/design-hub -g -y`.

## 5. Record what was answered

Write the shell answer under `DESIGN.md`, Shell (kind, the Paper frames, or "none"), so it is built once and every later session reads it instead of asking. Fill `PRODUCT.md` from what the user said about the product; leave a section empty only when they said nothing about it, and say so.

## 6. Hand off

- **Paper start:** open the Paper link and load `miles-paper-to-prototype`. It reads the fonts and tokens first, then the shell frames, then the feature frame, and leaves `sample-list/` in place as the reference until the first feature exists.
- **Sample start:** `pnpm dev` and open `http://localhost:<port>/sample-list/`; point the user at `/guide/sample/` for the walkthrough. The next step is `miles-new-feature`.

Close with the path, the port, the repo URL when there is one, whether TypeSafe is on, and the one command that starts the server. Nothing is committed unless the user asks.
