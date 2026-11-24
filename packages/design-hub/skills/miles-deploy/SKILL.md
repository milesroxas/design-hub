---
name: miles-deploy
description: "Deploy the prototypes to Vercel behind the password gate and hand out the share link: the pre-flight (pnpm preflight), the GATE_* env, the review store for comments, the handover message. Load when the user asks to deploy, share, send a link, set or rotate the password, turn on comments, or check the work before any of those. Triggers on: deploy, share, share link, send to the client, send it to the team, put it online, publish, go live, update the link, push the latest, Vercel, sign in to Vercel, vercel login, password, gate, GATE_PASSWORD, production, preview URL, pre-flight, preflight, ready to send, turn on comments, review store, invite someone."
---

# Deploy

`pnpm share` deploys the project to the linked Vercel project and checks the live link; the user never types a command. Every path sits behind the gate in `proxy.ts`: the shared password opens it to view, and an invite link opens it to one named person who can comment. The mechanics are scripts; this skill decides when they run and what the user is told.

## Before every link goes out

`pnpm share` runs this first and stops on a failure; run it alone to check without deploying:

```bash
pnpm preflight
```

It runs every check in one pass and prints JSON with one entry per step. Read it, then walk this for each step with `ok: false`:

```
step failed?
├── contacts → show the user each value with its file and path. Replace it in fixtures.json,
│              or, only after the user says it is a business contact:
│              pnpm preflight --allow-contact <value>
├── states   → add the missing rows to that README's States table (miles-prototype), then rerun
├── gate     → pnpm bootstrap --vercel <project> sets GATE_PASSWORD and GATE_SECRET
└── any other → fix what `detail` names; `fix` says how
```

Never send the link with a failed step, and never skip one with `--skip` without the user's word. Why: the link is what the client signs off on, and every step guards something they would see (a private phone number, a state nobody listed, a page that will not load).

## Signing in

Every Vercel step needs the CLI signed in. The user never opens a terminal for it:

```bash
pnpm signin
```

Signed in, it prints `signedIn: true` and the account. Signed out, it starts the sign-in in the background and prints a `url` at once. Send the user that link to open and approve, then run `pnpm signin --wait 300`, which returns when they have. Why a link: `vercel login` is a device sign-in that waits for a browser click, so a terminal adds nothing but a step the user can get wrong. Any command below that answers "not signed in" gets the same treatment.

## First deploy

1. `pnpm signin` (above).
2. Ask which Vercel team the project goes in when `vercel teams ls` lists more than one. Then, from the project root:
   ```bash
   pnpm bootstrap --vercel <project-name> --team <team-slug> [--review]
   ```
   `--team` is the team the project is created in; without it the CLI's current team wins, which is often not the one the user means. It links the project, connects it to the GitHub repo (`vercel.git`: `connected`, `kept`, or `none` with a warning), turns Vercel Authentication off (the hub's gate is the protection), writes `GATE_PASSWORD` (12 readable characters, or `--gate-password <word>`) and a fresh `GATE_SECRET` to `.env` and to Production and Preview, and prints the password in `share.password`. `--review` also adds the comment store (see Comments). A second run keeps what is set.
3. Deploy:
   ```bash
   pnpm share
   ```
   It runs the pre-flight, deploys, waits for the build, and requests the production URL signed out, which must answer with the password page. Connected to the repo and on a clean `main`, it pushes and follows the build for that commit; otherwise it uploads the folder with the Vercel CLI. It refuses uncommitted changes rather than deploy something other than the commit: ask the user before committing. `ok: false` names the `stage` (`preflight`, `deploy` or `gate`) and the fix; a failed pre-flight step is walked as above, and nothing deploys until it passes.
4. The handover message, from the JSON's `share`, in one message: the `url`, the `password`, which prototype to open (`share.open`: its path and its walkthrough), and that Controls is the round button at the top of the page. A reviewer who is not told about Controls reviews one state. Never send `GATE_SECRET`.

## Comments

Ask the user once whether reviewers should comment on the link; ask before the first deploy, so one `bootstrap` carries `--review`. If yes, `--review [--typesafe-key <key>]` adds Upstash Redis to the project through the Vercel Marketplace and copies the store's credentials into `.env`. The first time on a team it can stop on the Marketplace terms: send the user the link in its `fix` to accept, then rerun. With TypeSafe on, comments are sorted by kind and state as they arrive. `pnpm share` after it, so the env reaches the site, then invite the first editor:

```bash
pnpm people invite --name "<user>" --team "<studio>" --role editor --site <share.url>
```

Send them the link; from then on, editors invite reviewers from the People tab. `miles-review` owns working from the comments.

## Rotating access

- **A reviewer leaves:** revoke them in the People tab, or `pnpm people revoke <id>`. Their sessions end on their next page load.
- **The shared password leaked:** `pnpm bootstrap --vercel <project> --gate-password <new>`, then `pnpm share`. Every password visitor signs in again; invited people are not affected.

## Security, never weakened for a prototype

- `vercel.json` sets `noindex`, `X-Frame-Options: DENY`, `nosniff`, HSTS and a same-origin referrer on every path. The gate and invite pages add a hash CSP and send no referrer.
- A wrong password waits 800ms. For a link going to a large client list, add a Vercel Firewall rate-limit rule on `POST` before it goes out.
