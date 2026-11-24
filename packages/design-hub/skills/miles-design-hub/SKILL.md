---
name: miles-design-hub
description: "Start a new Design Hub project: ask every question up front, create it with `npm create @milesroxas/design-hub`, run the setup, hand off to the Paper skill. Global install only; never load inside a project. Triggers on: design hub, new design project, start a project, new prototype repo, set up prototypes, from the template."
---

# Design Hub

The entry point. The user never starts in a terminal: they ask for a new project, this skill asks every question before it touches disk, then runs two commands and hands off. A question asked up front is one Claude never guesses later.

Someone who does not use Claude Code gets the same result from the setup app: `Design Hub.command` in the Design Hub repo opens a page that asks the name, the place and GitHub, then runs the same two commands. Point a non-technical user there instead of this skill when they ask how to start without Claude.

## 1. Check the machine first

These are read-only, and their answers become the choices in step 2, so run them before asking anything.

```bash
node --version                          # 22.18 or newer; else install the current LTS
pnpm --version                          # else: corepack enable
gh auth status                          # the signed-in account; none means "No GitHub repo" is the only working choice until gh auth login
gh api user/orgs --jq '.[].login'       # the orgs that can own the repo
```

The skills these lean on, installed globally: `emil-prototype`, `emil-writing-skills`, `impeccable`. Check `~/.claude/skills/` and install any that is missing with `npx skills add <source> -g -y`; say which were added.

A cloud container (no `~/SITES`, a home such as `/home/user`, a fresh VM per session) loses anything installed under `~` when the session ends. There, default the location to the working directory and skip the Conductor question: Conductor runs on the user's own machine.

## 2. Ask before anything is created

Ask with the host's question tool (`AskUserQuestion` in Claude Code), never as a numbered list in chat. Why: each answer is one click, the recommended choice is already marked, and nothing gets skipped in a wall of text. The tool takes at most 4 questions per call and 2 to 4 options per question, and it always adds "Other" for a typed answer. Put the recommended option first with "(Recommended)" at the end of its label. Take the project name from the request; ask for it in chat only when the request has none.

**Round 1: the project.**

| Header | Question | Options |
|---|---|---|
| Location | Where should `<name>` live? Its folder name becomes the repo name. | `~/SITES/<name>` (Recommended) · `~/Design/<name>`; in a cloud container, `<working dir>/<name>` (Recommended). "Other" takes any absolute path. |
| GitHub | Who owns the repo, and who can see it? | `<gh login>`, private (Recommended) · `<gh login>`, public · `<org>`, private for the first org from step 1 · No GitHub repo. "Other" takes another owner. |
| Start | Start from a Paper comp or from the sample prototype? | Sample prototype (Recommended) · Paper comp |
| Shell | Does the design have a shell? | No shell: prototypes stand in the Space (Recommended) · Product: sidebar, top bar, content · Website: header and footer, plus a pre-footer when the design treats it as a global |

**Round 2: the extras.** Leave Conductor out in a cloud container.

| Header | Question | Options |
|---|---|---|
| Skills | Install the `miles-*` skills for this project only, or globally? | Project only: the project already has them (Recommended) · Globally |
| TypeSafe | Turn on TypeSafe's Jev checks? | Off (Recommended) · On: I have an API key. Why opt-in: a template anyone can use cannot require a paid account. |
| Conductor | Will the project run in Conductor workspaces? | No (Recommended) · Yes, landing on `main` · Yes, on another branch (they type it in "Other") |

**Round 3: typed answers, one short chat message each, only for what was chosen.**

- Paper: the link to the Paper frame or page, and, with a shell, which frames hold it.
- TypeSafe on: the API key. If the host has a secret field (such as `request_secret`), use it instead of chat, because a key typed in chat stays in the transcript.
- Always, last: "Anything about the product for `PRODUCT.md`? Reply 'skip' to leave it empty."

Without a question tool (another agent, or a host that lacks one), ask everything in one message with defaults in brackets, and wait for every answer. Nothing in steps 3 to 6 runs until every round is answered.

Comments and the share link come later, with `miles-deploy`, because they need a Vercel project.

## 3. Create the project

```bash
npm create @milesroxas/design-hub@latest -- --path <path> --visibility private|public|none [--owner <owner>]
```

It copies the template, pins the `@milesroxas/design-hub` package, installs, puts the `miles-*` skills in `.claude/skills/`, makes the first commit, and with `private` or `public` creates the GitHub repo and pushes. It prints one JSON object; `ok: false` names the fix. A second run finds the project and changes nothing, so rerun it after a fix instead of finishing by hand.

## 4. Run the setup

```bash
pnpm --dir <path> bootstrap [--typesafe-key <key>] [--conductor --branch <branch>]
```

It picks a port nothing holds and no other project claims, writes it to `.env` and `.claude/launch.json`, and applies the flags. Read the JSON's `warnings`. With the skills answered globally: `npx skills add milesroxas/design-hub -g -y`.

## 5. Record what was answered

Write the shell answer under `DESIGN.md`, Shell (kind, the Paper frames, or "none"), so it is built once and every later session reads it instead of asking. Fill `PRODUCT.md` from what the user said about the product; leave a section empty only when they said nothing about it, and say so.

## 6. Hand off

- **Paper start:** open the Paper link and load `miles-paper-to-prototype`. It reads the fonts and tokens first, then the shell frames, then the feature frame, and leaves `sample-list/` in place as the reference until the first feature exists.
- **Sample start:** `pnpm dev` and open `http://localhost:<port>/sample-list/`; point the user at `/guide/sample/` for the walkthrough. The next step is `miles-new-feature`.

Close with the path, the port, the repo URL when there is one, whether TypeSafe is on, and the one command that starts the server. Nothing is committed unless the user asks.
