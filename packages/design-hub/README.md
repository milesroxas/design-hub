# design-hub

The Design Hub product as an npm package: the hub that lists and serves a project's prototypes, the review panel and its API, the sign-in gate, the kit, the `design-hub` command and the `miles-*` skills. A project installs it and keeps only its prototypes, kit materials and docs; `npm create @milesroxas/design-hub` makes one.

```bash
design-hub dev                    # the hub on http://localhost:<PORT>
design-hub new <slug> --feature <feature>         # a prototype in the low-gravity space
design-hub new <slug> --app --sprint --feature <feature>   # a feature's own prototype, in the shell
design-hub guide <feature>        # its walkthrough, docs/sprints/<feature>/guide.md
design-hub commands               # every command, with its flags, as JSON
```

Inside the package, from the inside out: `core/` is the pure kernel (README states, the catalog, fixture sets, checks, the Jev client, the review domain); `kit/` the materials prototypes import; `shell/` the browser hub; `server/` the Node side (the review API, signed sessions, the stores, env and paths); `vite/` the plugin that turns a project into a Vite app; `vercel/` the deployed entries; `scripts/` the CLI; `templates/` what `new` copies; `skills/` what `skills` installs. `AGENTS.md` here holds the layers and their rules.

How a project becomes an app: `design-hub dev` runs Vite with the package's `shell/` as the root and the project as the content. `vite/registry.ts` writes `virtual:design-hub/registry` from the project's `prototypes/` and `docs/sprints/`; `vite/kit.ts` resolves `@kit/<name>` to the project's `kit/<name>` first and the package's second. The sections below describe the hub's own interface and the deployed site; they are the reference for changing the package, not for using it.

## The index

`/` lists every prototype from its README frontmatter (`shell/Index.tsx`, `shell/shell.css`). The page answers one question for a reviewer: which prototype is the feature, and what else was tried around it.

### Which kind

Walk this for every new prototype; the first match wins.

1. The feature's main prototype, the one its walkthrough opens → `sprint`. Exactly one per feature, so a reviewer never has to guess which build is current. `design-hub new --sprint` refuses a second while the first is not archived.
2. Another full take on that same flow, built to compare against the primary → `alternate` (`--alternate`). Refused until the primary exists, because an alternate is only legible next to what it replaces.
3. Anything else: a side question about one part (a menu's motion, a loading state) → `exploration`, the default.

### Layout

Groups, in order: one per feature, then `Without a feature` (explorations with an empty `feature:`), then `Archived` (`status: archived`, any kind, plain rows).

A feature group, top to bottom:

1. **Heading.** The feature's name. `Walkthrough →` ends the line when `docs/sprints/<feature>/guide.md` exists.
2. **Primary.** The one `sprint` row, its title 16px against 14px for every other row. Size alone marks it; no badge, no new shape.
3. **Alternates.** Under an `Alternates` caption (12px, 500, quaternary text), indented 20px and joined to the primary by a 1px rail in `--border-secondary` on the primary's text edge. The rail makes them children of that one row; a heading of their own would make them peers of the feature. A stray second `sprint` renders here too.
4. **Internal explorations.** A toggle (`Internal explorations`, the count, a chevron), collapsed by default because explorations are working material, not the feature. The open state persists per group in `localStorage` (`index-explorations-open`). Typing in the filter opens every fold, so a match is never hidden. Open, the explorations are cards on a grid (`minmax(208px, 1fr)`, 8px gap). Every exploration lives here, never in the row list.

Within any list: exploring above decided, then newest first.

Rhythm: inside a group, each block's text sits 20px under the text above it (primary under heading, each caption under the last summary), and a caption sits 8px over what it labels, so it reads as the start of what follows. Groups sit 40px apart, double the inner step, so a group reads as one unit.

Surfaces:

- **Rows** draw no dividers. The hover surface is the only drawn shape and bleeds 12px into the gutter, so every text edge on the page lines up. One page grid reaches every row through subgrid, so the context, status and date columns align across groups without fixed widths; the alternates' indent reaches the first column only.
- **Cards** take `--radius-lg` and 12px padding, so card text keeps the page's text edge. The title line ends in an arrow (quaternary), because the whole card opens the prototype. The summary drops to caption size (12px/18px, tertiary) so three cards scan as three titles. Context, status and date sit pinned to the bottom so the meta lines up across a row of cards. The edge is an inset ring (`oklch(0 0 0 / 0.08)`) plus two soft layers in light, and a white 9% ring alone in dark, where the tokens drop every shadow. The ring is inset because the fold clips its content while it animates and would cut an outer one. Focus stacks the focus ring on the edge, since both are box-shadows and the edge alone would erase it.
- **Status** is a 6px dot before the word: ink for exploring, success for decided, quinary for archived. The word stays, so colour is never the only signal.
- **Foot.** The count alone, in body type over a hairline (the Ledger Foot Rule).
- **Lede.** 18px/28px Geist at 400, secondary text. `--font-voice` resolves to Geist inside the hub's `.sys` scope (`shell/system.css`), so the index never borrows the project's faces.

### Motion

Nothing animates on a keyboard action.

- **Arrival**, one shot: the head fades over 200ms, then each heading, caption, row and open card rises 4px and fades over 220ms, 30ms apart (stagger capped at eight), then the foot. Keyframes fill backwards only, so a settled row's opacity stays free to transition.
- **Departure**, pointer only: a clicked row or card holds while the rest of the page fades over 150ms on the Layer Exit curve, filling the wait while the browser fetches the prototype. A modified click or Enter opens instantly; a back-forward restore clears the fade.
- **Fold:** opens over 220ms (grid row `0fr` to `1fr`, plus the fade) and closes over 150ms, both `--ease-out`; the chevron turns 180°. A keyboard toggle is instant.
- **Hover:** a row takes the Hover Rule fill. A card stays white and lifts instead (ring and shadow deepen; in dark, the ring brightens and the surface steps up to `--bg-primary_hover`), and its arrow moves 2px right and darkens to secondary. Both lift the summary to secondary. **Press:** `scale(0.97)`.
- **Reduced motion** keeps the fades and drops the rise, the press, the fold's growth, the chevron's turn and the arrow's nudge.
- Up and Down arrows walk the rows and the cards of open folds.

A speculation rule in `shell/index.html` prefetches a prototype's page when its row is hovered, so the document is in cache by the click (Chromium; other browsers ignore the rule). Prerendering was rejected: it would play a prototype's entrance motion before anyone saw it.

## The walkthrough

`/guide/<feature>/` is `docs/sprints/<feature>/guide.md`, rendered for reviewers who have a sign-in link but not the repo; `/guide/` alone opens the only guide, or lists them. The registry plugin lists the guides, so a new feature's walkthrough appears the moment the file exists (`design-hub guide <feature>` starts one from `templates/guide.md`). The Markdown stays the one source: a Vite plugin (`vite/markdown.ts`, the `?doc` import) compiles it at build time with `marked`, so nothing is parsed in the browser. It turns the first H1 into the title, every H2 and H3 into the contents rail, each image into a figure with its pixel size (no layout shift, lazy below the first), and `> [!NOTE]` quotes into callouts. A paragraph that starts `Controls → …` renders as a click path. Links to other Markdown files lose their href, since nothing serves them. The page reads at 16px on a 680px measure; screenshots and tables take the full 960px column, because a 1440px shot at 680px is unreadable. Two raw values: a screenshot wears a 1px inset outline at 10% (black on light, white on dark) and a callout a 6% ring (8% on dark), alphas rather than tokens because they composite on any surface the page is set on. The slug `guide` is the hub's (`design-hub new guide` refuses it). The page's **Open the prototype** button goes to the feature's sprint prototype, and every prototype of the feature answers with **Open the walkthrough** as the last row of Controls, under every group, in a new tab, so a reviewer reads and clicks side by side. Above it, on every prototype, **All prototypes** goes back to `/` in the same tab. A sheet inside the product was rejected: it would be modal over the thing under review, and testing aids never sit in the product chrome.

## Deploying, and signing in

`miles-deploy` owns the steps; this is what they rest on. `design-hub signin` starts `vercel login`'s device sign-in in the background and returns its link, so the user clicks instead of typing. `design-hub bootstrap --vercel <project>` links the project, connects it to the `origin` repo when Vercel can reach it, turns Vercel Authentication off and sets the env. `design-hub share` runs the pre-flight, then deploys: a push of a clean production branch when the project is connected to the repo (following the build for that commit), else `vercel deploy --prod`; then it requests the production URL as a signed-out browser and fails unless the sign-in page answers with `noindex` and a link no store holds answers 404, which proves the review store is wired (503 means there is none, so nobody could sign in). Every path on the deployed site sits behind the gate, enforced on the server by Vercel Routing Middleware (`vercel/proxy.ts`, exported as `createProxy` and default-exported by the project's one-line `proxy.ts`, which `vercel.json` names as `proxy.entrypoint`). A client-side gate was rejected because the bundle and the state behind it would still download.

Every person is named, and signs in with a one-time link that Studio makes in the review panel's People tab or with `design-hub people add`.

- **A link works once.** `GET /invite/<token>` shows who it is for and a Continue button, and uses nothing up, since mail and chat previews open links too. Continue is a same-origin `POST` that uses the link up, sets the session cookie and goes to `/`. The use is atomic: the store's delete is the claim, so of two requests with one link only the one whose delete removed it signs in. A used, expired or unknown link answers 404, as does a link for someone revoked or past their access end. An unused link lasts 14 days. The store keeps only a hash of each token (32 random bytes), so a read of the store signs nobody in.
- **A second device gets a second link** (`design-hub people link <id>`), and the first stays signed in. **Sign out everywhere** (`people sign-out <id>`) bumps the person's epoch, drops their unused links and returns one new link. **Revoke** ends their access everywhere.
- **What a stale write cannot undo.** A person is a profile (name, team, kind, access end), written read-modify-write, plus two records only revoke and sign out everywhere touch: the revocation, written once and never cleared, and the epoch, raised only by `HINCRBY`. So a profile change that started before a revoke or a sign out everywhere and lands after it never clears the revocation or lowers the epoch, and two sign outs everywhere at once raise it twice.
- **Access lasts the engagement.** Each person has an access end: 3 months, 6 months, or open-ended. The project default (`people access --access <length>`, or `bootstrap --review --access`) applies to a new Client and is 3 months when unset; a new Studio person is open-ended, and Studio can set one person's length from the People tab or `people access <id>`.
- **The session** is one cookie, `__Host-hub_person`: `HttpOnly`, `Secure`, `SameSite=Lax`, signed with HMAC-SHA256 over the person, their epoch, an expiry, `checkedAt` (when the store last said yes) and the review store's URL, which is signed but never written into the token, so two projects that share a `GATE_SECRET` never accept each other's cookies, and versioned (`p3`), so a cookie from an older release never verifies. It lasts to the access end, at most 400 days, the longest a browser keeps one. For `CHECK_SECONDS` (5 minutes) after `checkedAt` any request passes on the signature. After that the next request, of any kind, asks the store: a current person passes with a fresh cookie whose expiry follows their current access end; a revoked, signed-out-everywhere or ended person gets 401 and the cookie cleared. The request's own headers never decide whether the store is asked, since the client chooses them. A store that fails answers 503 with `Retry-After`, and leaves the cookie, so an outage signs nobody out; the review panel reads `Retry-After` as try again, and a 503 without it as a site with no store. The API function answers the same way in JSON. The sign-in POST also refuses a store failure with 503, and a link is checked before it is used up, so a failure never burns one.
- **The link page** sends `Referrer-Policy: same-origin`, so Continue's POST carries a real `Origin` (with `no-referrer` a browser sends `Origin: null`, trusted only beside `Sec-Fetch-Site`, which older Safari does not send). Every other gate response sends `no-referrer`.
- **Signed out**, a page gets the sign-in page (401). It has no form: it says to open the link the studio sent, that each link signs in one device and then stops working, and to ask the studio for a new one for another device. Anything else gets a plain-text 401, an anonymous `POST` included.

The middleware reads one environment variable, set in the Vercel project for Production and Preview and never committed (`.env.example` names it): `GATE_SECRET`, at least 32 random characters that sign the session cookie. With it missing the gate answers 503 on every path, so a misconfigured deploy never serves the prototypes open. People and links live in the review store, so a site without it has a gate nobody can pass. The gate pages ship a hash-based Content Security Policy with no `unsafe-inline` and no script, plus `font-src 'self'` and `img-src 'self'`, and send no referrer. They wear the hub's neutral look in Geist, so two files pass the gate without a session: `/_gate/geist.woff2` (the latin subset, emitted by `vite/plugin.ts` at that fixed path) and `/favicon.svg`. Nothing else does. Every response carries `X-Robots-Tag: noindex`, so no search engine lists the site. The pages' title is the `siteName` the project's `proxy.ts` passes to `createProxy`. Under `design-hub dev` there is no gate; `/_gate/` previews the sign-in page, `?page=link` a link's page and `?page=used` a used one.

## Comments and people

Every signed-in person can comment as themselves. The People tab lists each person with their team, kind and when their access ends, and says how links behave where Studio shares them.

The panel (`shell/review/`) mounts on every prototype page in its own React root, so a prototype that throws never takes it down. A comment carries the prototype, the URL, every dial panel's values (`snapshotDials`), and the element it was pinned to as a selector path with an offset; Show state reopens the URL and sets the dials back. Pins draw over their elements and below the Controls panel. The API is one endpoint, `/api/review` (`server/api.ts`, reached on Vercel through the project's one-line `api/review.ts`, which also bundles the project's `checks.json` so triage runs on its thresholds): queries by GET, commands by POST with a JSON body, same-origin only. The rules (who may delete, what a valid comment is) live once, in `core/review/`, behind a small storage port: Upstash Redis over REST when deployed, a file in `.design-hub/review.json` under `design-hub dev`, where whoever runs the server is a local Studio person.

`design-hub dev` serves the prototypes open, with the review panel on the local store. The gate is covered by `pnpm test` (`vercel/proxy.test.ts`, against an in-memory Upstash); `vercel dev` in a project runs it for real.
