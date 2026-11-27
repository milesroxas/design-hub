---
name: miles-deploy
description: "Deploy the prototypes to Vercel behind the gate and hand out sign-in links: the pre-flight (pnpm preflight), GATE_SECRET, the review store that keeps people and their links, the handover message, adding people, a second device, signing someone out, how long access lasts. Load when the user asks to deploy, share, send a link, add or remove someone, give someone access on another device, change how long access lasts, turn on comments, or check the work before any of those. Triggers on: deploy, share, share link, send to the client, send it to the team, put it online, publish, go live, update the link, push the latest, Vercel, sign in to Vercel, vercel login, gate, GATE_SECRET, sign-in link, one-time link, new link, another device, link stopped working, sign out everywhere, access length, 3 months, 6 months, open-ended, password, production, preview URL, pre-flight, preflight, ready to send, turn on comments, review store, add someone, invite someone, remove someone."
---

# Deploy

`pnpm share` deploys the project to the linked Vercel project and checks the live link; the user never types a command. Every path sits behind the gate in `proxy.ts`. There is no password: each person is named, and signs in with their own one-time link. A link signs in one device, then stops working, so a used link opens nothing. An unused link signs in whoever opens it first, so it goes only to its person. The mechanics are scripts; this skill decides when they run and what the user is told.

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
├── gate     → pnpm bootstrap --vercel <project> --review sets GATE_SECRET and adds the review store
│              (KV_REST_API_URL, KV_REST_API_TOKEN): without the store nobody can sign in
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
   pnpm bootstrap --vercel <project-name> --team <team-slug> --review [--access 3m|6m|open]
   ```
   `--team` is the team the project is created in; without it the CLI's current team wins, which is often not the one the user means. It links the project, connects it to the GitHub repo (`vercel.git`: `connected`, `kept`, or `none` with a warning), turns Vercel Authentication off (the hub's gate is the protection), and writes a fresh `GATE_SECRET` to `.env` and to Production and Preview. `--review` adds the review store, which keeps the people and their links (see The review store). Without it nobody can sign in. `--access` sets how long a new client keeps access by default (see Access). A second run keeps what is set.
3. Deploy:
   ```bash
   pnpm share
   ```
   It runs the pre-flight, deploys, waits for the build, and requests the production URL as a signed-out browser, which must answer with the sign-in page, and then a made-up sign-in link, which must answer 404: that proves the review store is wired, since nobody signs in without it. Connected to the repo and on a clean `main`, it pushes and follows the build for that commit; otherwise it uploads the folder with the Vercel CLI. It refuses uncommitted changes rather than deploy something other than the commit: ask the user before committing. `ok: false` names the `stage` (`preflight`, `deploy` or `gate`) and the fix; a failed pre-flight step is walked as above, and nothing deploys until it passes.
4. Add the first Studio person, the user, and send them their link (see People).
5. The handover message, from the JSON's `share`, one per person: their own link, which prototype to open (`share.open`: its path and its walkthrough), that Controls is the round button at the top of the page, and that the link signs in one device, then stops working, so for another device they ask for a new one. A reviewer who is not told about Controls reviews one state. Never send `GATE_SECRET`, and never send one person's link to another.

## The review store

Every share needs it: it keeps the people, their links and their comments. Ask once whether comments should be sorted by TypeSafe; `--review [--typesafe-key <key>]` adds Upstash Redis to the project through the Vercel Marketplace and copies the store's credentials into `.env`. The first time on a team it can stop on the Marketplace terms. Send the user the message in its `fix` as written: it links that team's terms page, names the one product to pick (**Upstash for Redis**, Redis Compatible Database) when Vercel lists several, and tells them not to create a database there, since the rerun creates the store and connects it. Rerun when they say it is done; if `stderr` shows another cause, show it to them instead. With TypeSafe on, comments are sorted by kind and state as they arrive. `pnpm share` after it, so the env reaches the site. `miles-review` owns working from the comments.

## People

Every person is named, and each gets their own link. Add the first Studio person, the user, from here:

```bash
pnpm people add --name "<user>" --team "<studio>" --kind studio --site <share.url>
```

Send them the `link`; from then on, Studio adds everyone else in the People tab (the round comments button, then **⋯**, **People**), or ask for it here with `pnpm people add --name "<name>" --team "<company>" --site <share.url>`. A Client is the default kind.

- **A link signs in one device, then stops working.** Opening it shows who it is for and a Continue button; Continue uses it up. Why: a mail or chat preview opens links too, and must not use one up. An unused link lasts 14 days.
- **Another device, or a link that stopped working:** `pnpm people link <id> --site <url>` gives one more link. Their other devices stay signed in.
- **A lost or shared device:** `pnpm people sign-out <id> --site <url>` ends every session (within five minutes) and every unused link (at once) they hold, and gives one new link.
- **Someone leaves:** `pnpm people revoke <id>`, or Revoke in the People tab. Their access ends on every device within five minutes, and their links stop working at once.
- `pnpm people` lists everyone, with their id and when their access ends.
- Never paste a link into a commit, a document, a ticket or a comment, and never send one to anyone but its person. Why: until it is used, whoever opens it first signs in as that person.

## Access

A signed-in device stays signed in until the person's access ends: 3 months, 6 months, or open-ended. A new client gets the project default; a new Studio person is open-ended.

- The project default: `pnpm people access` reads it, `pnpm people access --access 6m` sets it. Absent, it is 3 months. Ask the user at the first deploy how long the engagement runs.
- One person: `pnpm people access <id> --access 3m|6m|open`, counted from today, or `--access` on `pnpm people add`.
- When someone's access ends their links stop working at once, and every device signs out within five minutes. A changed access length reaches their signed-in devices within five minutes too. Change their access to let them back in, then send a new link.

## Internal and client-facing prototypes

Every prototype is **Internal** until a Studio person marks it **Client-facing** with the switch beside it on the deployed site's **Prototypes** page; only then can a Client open it or see it listed. No command reads or sets it: to check one, open the site's index signed in as Studio and look at its switch, or turn on **Client view** there to see the index as a client gets it. A switch flipped under `pnpm dev` writes the local store only; the deployed site has its own. A new prototype is internal, and so is every prototype on a site upgraded to the release that brought this: after that upgrade, tell the user once that clients see nothing until they switch on the prototypes the client should see. Before sending a handover, ask the user to check that the prototype it names is switched on. Walkthroughs and feature names reach every signed-in person whatever the switches say, so a walkthrough that describes internal work must wait.

Dials and variants follow the same rule from the release after that one. Every dial is internal until marked: a client's **Controls** panel has only the View tools (theme, reduce motion, speed), and each internal dial stays at its default. A client gets the first variant and no picker. Studio marks a dial with the eye beside its row in Controls, and variants with the eye at the end of the picker; both are kept per site, so marks made under `pnpm dev` do not reach the deployed one. After that upgrade, tell the user once that clients lose every dial and the picker until Studio marks what they should have, and that the brand board's Zoom and Guides stay theirs. Copy parameters and Save version are Studio's only. To check what a client gets, a Studio person presses **Client view** at the bottom of a prototype's Controls panel, or on the Prototypes page.

The same upgrade changes what a build accepts and writes. Tell the user once, and when a build fails fix the file it names; never work around the check:

- A stylesheet that does not parse (an unclosed block) fails `pnpm build` and stops `pnpm dev` (the page answers 500), naming file and line, where both worked before: every stylesheet is now read for reaches into a prototype's folder.
- A prototype that reaches into another prototype's folder fails in `pnpm dev` and `pnpm build`, naming both files: an import (any query), a CSS `@import` or `url()`, or a `new URL('…', import.meta.url)`. Copy the file into the prototype that uses it, or move it into `kit/`.
- Importing a file that sits directly in `prototypes/`, or in a folder there with no `README.md`, fails in `pnpm dev` and `pnpm build`: nothing in `prototypes/` is shared. Move shared code into `kit/`.
- A `kit/` file that imports or references anything in a prototype's folder fails in `pnpm dev` and `pnpm build`: the kit never reads a prototype. Move what it needs into `kit/`.
- A web worker in a prototype fails `pnpm build`. Run the work on the main thread, or build the worker from `kit/` files only.
- Sass, Less and Stylus are refused: importing a `.scss`, `.sass`, `.less`, `.styl` or `.stylus` file from a prototype or from `kit/` fails in `pnpm dev` and `pnpm build`, naming the file. Rewrite it as plain CSS or `.pcss`.
- Stylesheet ties resolve in source import order, as in `pnpm dev`: when a prototype imports a kit sheet and then its own, a rule of equal weight in its own sheet wins, where a build could put the kit's last before.
- A prototype's small images and SVGs are separate requests from its own folder, no longer inlined as `data:` URIs.
- A build fails when a file outside a prototype's folder is one of that prototype's files whole (the same bytes, a `data:` URI of it, or its whole text as a string), naming both files.
- `postcss` is a direct dependency of the hub, and Vite is pinned to 8.3 (it was any 8.x from 8.3.5): the project's next install may move its Vite to any 8.3 patch, never 8.4. Nothing to do.

## A project that shared before one-time links

A project that shared with a password (before one-time links) needs this once, before its next `pnpm share`. The pre-flight `gate` step stops the share until the store is there, so production is never replaced by a gate nobody can pass.

1. The review store is now required: `pnpm bootstrap --vercel <project> --review`. Why: people and their links live in it, so without it nobody can sign in.
2. People, links and comments from before are not carried over. Add everyone again with `pnpm people add`, and send each person their own link. Tell the user once that the old comments stay in the old store and in any `comments.md` already pulled, and are not on the new site.
3. The old password variable (the `GATE_` one that is not `GATE_SECRET`) is no longer read. Remove it from `.env`, and from the Vercel project: `vercel env ls` names it, then `vercel env rm <name> production` and `preview`.
4. Earlier deployments still serve the old password page at their own URLs. Remove them: `vercel ls <project>` lists them; `vercel rm <url>` each one older than the new production deployment, with the user's word.

## Security, never weakened for a prototype

- `vercel.json` sets `noindex`, `X-Frame-Options: DENY`, `nosniff`, HSTS and a same-origin referrer on every path. The gate pages add a hash CSP, run no script and send no referrer.
- A link is 32 random bytes, and the store keeps only its hash. Using one is atomic: of two requests with the same link, only one signs in.
- The session cookie carries when the store last said yes. After five minutes the gate asks the store again on the next request of any kind and issues a fresh cookie, so a revoke, a sign out everywhere or a changed access length reaches every device within five minutes. A store that does not answer gives 503 and signs nobody out.
- `--site` needs the deployed store's credentials in `.env`; with only the local store, `people` refuses rather than print a link the site does not know.
- `GATE_SECRET` signs every session, together with the review store's URL, so two projects that share a secret (a copied folder) never accept each other's cookies. Never send it, never commit it. Replacing it on Vercel signs everyone out.
