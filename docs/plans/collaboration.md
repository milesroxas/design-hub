# Collaboration: people, access and what clients see

Status: plan, not started. Sections 3 to 7 are a proposed design for the decisions in section 2. Two points stay open (section 8); both are answered by the exploration in slice 6 and block nothing before it.

## 1. Problem and success

Found by running the whole flow: invite, comment, manage the review.

- The Comments button is always on screen, above the prototype. It and the pins cannot be hidden.
- An invited person cannot tell how to get back in. The copied link says nothing about what it does. Neither the client nor the studio is told that a shared password exists or what it is for.
- Everyone who gets in sees everything. A comment, a prototype or a dial cannot be kept inside the studio.
- The review UI is unrefined next to the rest of the hub.

| It is working when | Measured by |
| --- | --- |
| A used or forwarded link opens nothing | Gate test: second use of a link answers 404 |
| No password page exists | `GATE_PASSWORD` appears nowhere in the repo; an anonymous request gets the sign-in page |
| A Client can never fetch anything internal | Service and gate tests: every read and write path refuses an internal thread, prototype and file to a Client session |
| Comments get out of the way | One action hides the button and pins, and the choice is remembered |
| A first-time client finishes the flow alone | Miles's walkthrough (open link, comment, come back the next day, resolve) completes with no help |

## 2. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | DialKit is for prototype tuning only: dials, variants, View tools. Collaboration keeps its own UI. | The review layer is already separate (`shell/review/`); the gaps are in its UI and flow, not in DialKit. |
| D2 | Two kinds of people, **Studio** and **Client**, replace editor and reviewer. No viewer. | One label per person; "editor" never said which side someone is on. |
| D3 | Every person is named. No anonymous access. | Studio knows exactly who can see the work and can remove one person. |
| D4 | The shared password is dropped everywhere. | Nobody understood it, it never protected an invite link, and changing it signs everyone out. |
| D5 | Default sign-in is a **one-time link**: it signs in one device, then stops working. A second device gets a second link. | A leaked link opens nothing, with nothing to explain to the client. |
| D6 | A signed-in device stays signed in for the length of the engagement (3 months, 6 months, or open-ended). The project sets a default at setup or by a prompt to Claude, and Studio can override it for one person. | Engagements run for months; a short-term reviewer should not keep access as long as the main client. |
| D7 | Email sign-in (a one-time code through Resend) is an option a project adds, not a second setup. It turns on when Resend is connected. | One code path per release; one step, and it cannot be half on. |
| D8 | With email sign-in on, one-time links are off and every person has an email on record. | A leaked link is then never a way in. |
| D9 | The People tab says how links behave and offers a prompt to copy for Claude that upgrades the project to email sign-in. | The team learns the trade-off at the moment they share. |
| D10 | One pair of words, **internal** and **client-facing**, applies to a comment, a prototype and a dial. | Three objects, one rule to learn. |
| D11 | A Studio comment is internal and stays internal. To tell the client, Studio writes a new comment. Clients never receive internal ones. | Production notes stay inside the studio, and no reply is ever exposed by a later switch. |
| D12 | Studio sees all comments by default, each thread marked with its audience, with a filter to narrow. | A missed client comment costs more than a crowded list. |
| D13 | A new prototype is internal. Studio marks it client-facing with a switch in the hub. | Private features must not leak by default, and Studio can share without a redeploy. |
| D14 | Internal prototypes are split and refused: their code and text load only for Studio, and the server refuses those files to a Client. | Hiding them in the index would leave names and code in the client's browser. |
| D15 | A dial is internal until marked client-facing. The marking workflow is explored first, in the hub and in code. | Safer default; the workflow is a product-experience problem. |
| D16 | View tools (theme, reduce motion, speed) are always available to Clients. | They change how a client looks at a prototype, not the design. |
| D17 | Studio has a **Client view** that shows the hub exactly as a client gets it. | Checking that work is client-ready before a presentation. |
| D18 | A Client can resolve and reopen any client-facing thread, not only their own. | Clients work with others in their own organisation. |
| D19 | Clients do not manage people. Studio adds and removes them. | Follows D2: Miles's list of what a Client does has no people management. |
| D20 | Start clean: no migration of people, comments or sign-ins. | Nothing is live; there is one test account. |
| D21 | Later work, in the backlog: tagging a person in a comment, and comment notifications by email. | Out of scope here. |

## 3. Architecture

| Component | Today | After |
| --- | --- | --- |
| `core/review/model.ts` | `Person.role` (editor, reviewer); `Comment` has no audience; thread number is list position | `Person.kind`, `email`, `accessEndsAt`; root `Comment.audience` and a fixed `number`; an audience per prototype |
| `core/review/policy.ts` | Rules by role and ownership | Rules by kind, ownership and thread audience |
| `core/review/service.ts` | Reusable 14-day invite; `reissue` ends all sessions | One-time link; a new link that keeps other devices; every read filtered by audience; prototype audience get and set |
| `server/session.ts` | Gate cookie (password) and person cookie, 30 days | Person cookie only, signed with `GATE_SECRET`, lasting to the access end |
| `vercel/proxy.ts` | Password page; invite path skips the gate | Sign-in page; one-time link; refuses an internal prototype's page and files to a Client; email code form when email is on |
| `server/api.ts` | Ops return everything to any signed-in person | Reads take the caller's kind, or `client` in Client view; new ops list the visible prototypes and set a prototype's audience |
| `shell/review/` | One 989-line file, own styles, always-on launcher | Split by part, built on `kit/ui`, hideable, audience on threads, Client view, People tab disclosure |
| `vite/registry.ts`, `shell/registry.ts`, `shell/Index.tsx` | Every README inlined in one bundle; index built from it | Each prototype's README and code in files named for it, loaded on demand; index built from the server's list; a Studio switch per prototype |
| `kit/ViewTools.tsx` | Shown to everyone | Unchanged: always client-facing (D16) |
| `kit/dials.tsx`, `kit/Variants.tsx` | Every control shown to everyone | Internal by default; marking per slice 6 |
| `scripts/` (`people`, `share`, `bootstrap`, `comments`) | Password set at bootstrap and returned by `share` | No password; access length flags; kind on people; audience in pulled comments |
| `server/mailer.ts` (new, slice 7) | none | One port for sending mail; Resend behind it |

Contracts that change:

- **Store keys** (`core/review/store.ts`): a new key prefix, so old records are ignored (D20). People, links, comments per prototype, plus settings (default access length), counters (thread numbers), prototype audiences, and email codes (slice 7).
- **Gate responses**: an anonymous page request gets the sign-in page (401). `/invite/<token>`: GET shows who the link is for, POST uses it up and sets the cookie. A used, expired or unknown link gets 404. A person past their access end is signed out. A Client asking for an internal prototype's page or files gets 404. Old cookies stop working.
- **Environment**: `GATE_PASSWORD` is no longer read. `GATE_SECRET` stays. Slice 7 adds the Resend key and a sender address; their presence turns email sign-in on.

## 4. Program design

Only where rework is costly: the stored shapes, the rules, sign-in, and the prototype boundary. Every later slice reads these.

```ts
// core/review/model.ts
type PersonKind = 'studio' | 'client';              // replaces Role
type Audience = 'internal' | 'client';
type Person = { id; name; team; kind: PersonKind; email: string | null;
                accessEndsAt: string | null; createdAt; revokedAt; epoch };
type Comment = { /* as today */ audience: Audience; number: number };   // both on roots; replies follow the thread
type Link = { person: string; expiresAt: string };  // unused-link lifetime as today; deleted when used

// core/review/policy.ts
type Action = 'read' | 'comment' | 'edit' | 'delete' | 'resolve' | 'triage' | 'people' | 'audience';
function can(actor: Person | null, action: Action, root?: Comment, subject?: Comment): boolean;
function visibleTo(viewAs: PersonKind, comments: Comment[]): Comment[];

// core/review/service.ts (changed and new members)
addPerson(actor, input): Promise<{ person: Person; token: string }>;      // was invite; input may carry an access end
newLink(actor, id): Promise<{ person: Person; token: string }>;           // another device; sessions stay
signOutEverywhere(actor, id): Promise<{ person: Person; token: string }>; // was reissue
peekLink(token): Promise<Person | null>;                                  // GET
useLink(token): Promise<Person | null>;                                   // POST; deletes the link
listComments(actor, prototype, viewAs?: PersonKind): Promise<Comment[]>;
visiblePrototypes(actor, viewAs?: PersonKind): Promise<string[]>;         // slugs
setAudience(actor, prototype, audience: Audience): Promise<void>;         // Studio only
audienceOf(prototype): Promise<Audience>;                                 // absent means internal

// server/session.ts
type Gate = { secret: string };
issuePersonToken(gate, claim: PersonClaim, endsAt: string | null): Promise<string>;
```

Call trees:

- **Sign-in.** `proxy` on `/invite/<token>`: GET calls `peekLink` and renders who it is for. POST calls `useLink`, then `issuePersonToken`, sets the cookie and redirects.
- **Any page.** `proxy`: `readPersonToken`, then `sessionPerson` (revoked, epoch, access end). Pass, or the sign-in page.
- **A prototype's page or file.** `proxy` reads the slug from the path or the file name; for a Client it calls `audienceOf` and answers 404 when internal. Studio skips the lookup.
- **Any API op.** `handleReview`: `actorFrom`, then the service, where `can` and `visibleTo` decide. The browser never filters.

File naming is the prototype boundary: everything built from `prototypes/<slug>/` (code, README, CSS, images) lands in files that carry the slug in their name, so the gate refuses by name with no build manifest.

Rule table `can` must satisfy, tested row by row:

| Action | Studio | Client |
| --- | --- | --- |
| read, comment, reply | any thread | client-facing threads only |
| edit | own | own |
| resolve, reopen | any | any client-facing |
| delete | any | own |
| triage, people, prototype audience | yes | no |

A Studio comment is internal; a Client comment is client-facing. A Studio reply in a client-facing thread is client-facing.

Not designed here, and why:

- **Comment UI (slice 1)**: visual, judged by eye, cheap to change. Only the file split is fixed.
- **CLI flags, docs, skills**: the contract is already fixed by `scripts/lib/cli.ts`.
- **Dials (slice 6)**: the exploration is the design step.
- **Email sign-in (slice 7)**: sits behind one port, designed after a learning test proves how Resend behaves. Only `Person.email` is needed earlier, and it is above.

## 5. Structure outline

Each slice works end to end (store, API, gate, UI, CLI, docs) and ships as its own release. `pnpm check`, `pnpm test`, `pnpm quality` and `release-check` pass on every slice. The order is a recommendation.

| # | Delivers | Deterministic check | Files |
| --- | --- | --- | --- |
| 1 | Comments that get out of the way: hide and show the button and pins, remembered; panel rebuilt on `kit/ui`; `Review.tsx` split by part. Interaction details are settled in review of the running UI, not here. | New `node:test` on the view reducer moved to a pure module (hidden state, pick, close); `pnpm quality` holds every function under cyclomatic 10 | `shell/review/*`, `kit/ui/*`, `kit/prefs.ts` |
| 2 | Studio and Client: kind on people, rules by kind, a Client resolves any thread, People tab and `people` command use the new words, new key prefix. Sign-in unchanged. | `policy` table test, row by row; `service.test.ts` | `core/review/{model,policy,service,store}.ts`, `server/{api,local}.ts`, `scripts/{people,lib/review}.ts`, `shell/review/*`, `docs/guide/comments.md` |
| 3 | One-time links and no password: link works once, second device by a new link, project access length with a per-person override, sign-in page that says what to do, People tab disclosure, password removed from bootstrap, `share`, the deploy skill and the docs. | `proxy.test.ts`: second use is 404, anonymous is 401, access end signs out, an old cookie gets the sign-in page; `session.test.ts`; `bootstrap.test.ts`; `share` gate check as a browser; `grep GATE_PASSWORD` is empty | `vercel/proxy.ts`, `server/session.ts`, `core/review/service.ts`, `scripts/{share,bootstrap,people}.ts`, `scripts/lib/{deploy,vercel}.ts`, `template/.env.example`, `skills/miles-deploy`, `docs/guide/sharing.md`, `README.md` |
| 4 | Internal comments: audience on a thread, server filter, fixed numbers, Studio sees all with a filter, Client view for comments, audience in `comments pull`. | `service.test.ts`: a Client gets no internal thread or reply through any op (list, reply, edit, resolve, locate by id); numbers do not move when a thread is hidden | `core/review/*`, `server/api.ts`, `shell/review/*`, `scripts/comments.ts` |
| 5 | Internal prototypes: every prototype starts internal, Studio switches it in the hub, a Client's index lists only client-facing, internal pages and files are refused, Client view covers the index. | Learning test first: a Vite build names code, README, CSS and images by prototype. Then `registry.test.ts`; `proxy.test.ts` (Client on an internal page or file is 404); a build check that no file outside an internal prototype's own holds its README text | `vite/{registry,plugin}.ts`, `core/review/*`, `server/api.ts`, `shell/{registry.ts,Index.tsx,main.tsx}`, `vercel/proxy.ts`, `template/AGENTS.md`, `skills/miles-prototype` |
| 6 | Dials. First an exploration: marking in the hub and marking in code, plus the variant picker, as prototypes in the sample project using Emil's skills, for Miles to choose from. Then the build. | Exploration: none; the choice is recorded in this file. Build: a Client's page holds no internal dial, checked as defined with the chosen design | `kit/dials.tsx`, `kit/Variants.tsx` |
| 7 | Email sign-in: learning test against Resend, mailer port, email on a person, code form on the gate, links off, a setup command, the upgrade prompt in the People tab. | Learning test run once with a real key and its output kept; `proxy.test.ts` with a fake mailer: unknown email gets the same answer and no mail, wrong codes are capped, a right code signs in, a link is refused when email is on | `server/mailer.ts`, `vercel/proxy.ts`, `core/review/service.ts`, a new command in `scripts/`, `SCRIPTS` in `scripts/skills.ts` and `template/package.json`, `skills/miles-deploy`, `docs/guide/` |

## 6. Review

This repo commits to main with no PRs, so the review unit is one slice's commits, read before the release is published. Each commit stays inside one package.

| Slice | Size (lines changed) | A person reads |
| --- | --- | --- |
| 1 | 1,500 to 2,500 | The running UI in `pnpm dev`; skim the file split |
| 2 | about 1,000 | All of `policy.ts` and its table test |
| 3 | 2,000 to 3,000 | All of `proxy.ts` and `session.ts`: this is the security boundary |
| 4 | about 1,500 | Every service read path, for a missed filter |
| 5 | 1,500 to 2,500 | The file naming, the gate rule, and the learning test's output |
| 6 | about 1,000 after the exploration | The chosen design against the prototype |
| 7 | about 2,000 | The code flow in `proxy.ts` and the mailer port |

A slice over 3,000 lines is split before it is built. Slices 1 and 2 are read in full and the plan is corrected from them while that is cheap.

## 7. Models and effort

| Role | Model | Effort | Note |
| --- | --- | --- | --- |
| Research per slice | Sonnet 5.5 | medium | Fresh context; gets questions about the code, not this plan, so it reports facts and not opinions |
| Build, slices 2 to 5 and 7 | Opus 5.5 | medium | One slice per fresh session |
| Build, slices 1 and 6 | Fable 5.2 | medium | UI and CSS work, with Emil's skills |
| Second read of slices 3, 5, 7 | A different model from the builder | high | Raises the floor on the security slices; it does not replace the human read |

No extra-high effort: it costs two to four times as much with no reliable gain in keeping everything working (Dex Horthy, `scb-oct-2026`).

## 8. Open questions

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Does Studio mark a dial client-facing in the hub, in code, or both? | Decide from the slice 6 exploration. Leaning hub, to match prototypes (D13). |
| Q2 | Is the variant picker client-facing, and can Studio limit which variants a Client sees? | Decide from the slice 6 exploration. Leaning the same rule as dials. |
