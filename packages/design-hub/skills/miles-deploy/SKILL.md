---
name: miles-deploy
description: "Deploy the prototypes to Vercel behind the password gate and hand out the share link: the pre-flight (pnpm preflight), the GATE_* env, the review store for comments, the handover message. Load when the user asks to deploy, share, send a link, set or rotate the password, turn on comments, or check the work before any of those. Triggers on: deploy, share, share link, send to the client, Vercel, password, gate, GATE_PASSWORD, production, preview URL, pre-flight, preflight, ready to send, turn on comments, review store."
---

# Deploy

Pushing `main` deploys the project to the linked Vercel project. Every path sits behind the gate in `proxy.ts`: the shared password opens it to view, and an invite link opens it to one named person who can comment. The mechanics are scripts; this skill decides when they run and what the user is told.

## Before every link goes out

Run from the project root:

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

## First deploy

1. The user signs in once, in their own terminal: `vercel login`. It is interactive; never run it for them.
2. From the project root:
   ```bash
   pnpm bootstrap --vercel <project-name> --team <team-slug>
   ```
   `--team` is the Vercel team the project is created in (`vercel teams ls` lists them); without it the CLI's current team wins, which is often not the one the user means. It links the project, writes `GATE_PASSWORD` (12 readable characters, or `--gate-password <word>`) and a fresh `GATE_SECRET` to `.env` and to Production and Preview, and prints the password in `share.password`. A second run keeps what is set.
3. `pnpm preflight`, then push `main` (or `vercel --prod` from the project root).
4. On a Pro team Vercel turns Vercel Authentication on for every new project, which sends each visitor to a Vercel login before the gate. Turn it off for Production once: Project Settings, Deployment Protection, Vercel Authentication, set to Only Preview Deployments or Disabled. The hub's gate is the protection. Test by opening the production URL in a private window: the password page must appear, not vercel.com.
5. The handover message, in one message: the URL, the password, which prototype to open (the sprint's slug), the walkthrough at `/guide/<feature>/`, and that Controls is the round button at the top of the page. A reviewer who is not told about Controls reviews one state. Never send `GATE_SECRET`.

## Comments

Ask the user once whether reviewers should comment on the link. If yes:

```bash
pnpm bootstrap --vercel <project> --review [--typesafe-key <key>]
```

It adds Upstash Redis to the project through the Vercel Marketplace and copies the store's credentials into `.env`. If it stops on the Marketplace terms, the user runs `vercel integration add upstash/upstash-kv` once in their terminal, then you rerun. With TypeSafe on, comments are sorted by kind and state as they arrive. Redeploy so the env reaches the site, then invite the first editor:

```bash
pnpm people invite --name "<user>" --team "<studio>" --role editor --site https://<deployment>
```

Send them the link; from then on, editors invite reviewers from the People tab. `miles-review` owns working from the comments.

## Rotating access

- **A reviewer leaves:** revoke them in the People tab, or `pnpm people revoke <id>`. Their sessions end on their next page load.
- **The shared password leaked:** `pnpm bootstrap --vercel <project> --gate-password <new>`, then redeploy. Every password visitor signs in again; invited people are not affected.

## Security, never weakened for a prototype

- `vercel.json` sets `noindex`, `X-Frame-Options: DENY`, `nosniff`, HSTS and a same-origin referrer on every path. The gate and invite pages add a hash CSP and send no referrer.
- A wrong password waits 800ms. For a link going to a large client list, add a Vercel Firewall rate-limit rule on `POST` before it goes out.
