# Agent guide

The contract for every coding agent in this project (Claude, Codex, Cursor, others). `CLAUDE.md` points here.

This project holds prototypes, the materials they are drawn with, and the documents around them. Its tracks, in `.design-hub/project.json`, say what kind of engagement it is: **product** (app screens, handed to the client's engineers as a spec), **website** (pages on a CMS: Webflow, Payload, WordPress or EmDash), **brand** (collateral: social posts, slides, print), or any mix. Read it before starting work; `pnpm tracks` prints it. The hub that lists and serves them, the review panel, the sign-in gate and the `design-hub` command are the `@milesroxas/design-hub` package in `node_modules`: never edit it, never read it to do prototype work. Everything an agent touches is in this folder.

## Why it works this way

Code here is for sketching, not shipping. Following Karri Saarinen's [Design is more than code](https://linear.app/now/design-is-more-than-code), a prototype answers a question that was written down first, in words. Speed comes from removing production constraints, never from skipping the problem.

1. **Problem first.** `README.md` states the problem and the one question before any code exists. Restate it when you present the prototype.
2. **Where it stands.** Pick one per prototype: the shell of its track (`AppShell` for product, `SiteShell` for website), the project's chrome from `kit/shell.ts` and `DESIGN.md`, Shell; or the low-gravity space (`Space`), one thing alone on a quiet canvas with the picker and live dials. Brand collateral always stands on a `Board` of `Artboard`s, each at its real pixel size.
3. **Low gravity.** A prototype imports only `@kit/*` and its own folder. Never another prototype: the build refuses it. No tests, no stories, no abstractions for later. The fidelity ceiling is in the `miles-prototype` skill, and the fidelity guard hook says so when a write goes over it.
4. **Fork, don't flex.** If a kit piece needs to behave differently, copy it into the prototype folder and change the copy. Never add a prop or a variant to `kit/` for one prototype.
5. **Promote on second use.** When a second prototype copies the same thing, move it into `kit/` and point both at it.
6. **Real materials, worst content.** Real tokens, fonts and icons. The content comes from `fixtures.json`: `real` pulled from the CMS or copied from the comp, `missing` written by hand, and `longest`, `empty` and `max` derived by `@kit/fixtures`.
7. **Done means decided.** When the user picks, write the decision in the prototype's README: what was chosen, its values, what was rejected and why. Then delete the folder, or set `status: archived` if the user wants it kept.
8. **The floor never moves.** Accessibility and performance are not polish passes. The `miles-prototype` skill carries the rules.

## Stack (fixed)

| Need | Use | Not |
| --- | --- | --- |
| UI | React 19 function components, TypeScript strict | class components |
| Styling | Plain CSS beside the component, `kit/tokens.css` variables | Tailwind, CSS-in-JS, CSS modules, UI libraries |
| Motion | CSS transitions, `@starting-style`, keyframes, WAAPI first; `motion/react` only when it earns it | GSAP, react-spring |
| Live values, controls | DialKit through `@kit/dials` | custom panels, testing aids inside the product chrome |
| Data | `fixtures.json` in the prototype folder | fetching, a server, localStorage as a store |
| State, routing | `useState`, a module store with `useSyncExternalStore`, `@kit/hooks` `useHashRoute` | state libraries, React Router |
| Tests | none in a prototype | Vitest, Jest, Playwright, Storybook |

Adding a dependency needs the user's OK. Ask, with the reason and the bundle cost.

## Commands

Run from the project root. Every command prints one JSON object; `--help` prints its schema; `ok: false` comes with `fix`. Read the JSON; never parse prose.

```bash
pnpm dev                                  # http://localhost:<PORT>, review panel and all
pnpm tracks                               # the project's tracks and website platform
pnpm new <slug> --feature <feature>       # a space prototype with the picker and dials
pnpm new <slug> --app --sprint --feature <feature>   # the feature's one primary prototype, in its track's shell
pnpm new <slug> --app --alternate --feature <feature>   # another take on the primary
pnpm new <slug> --app --track website ... # with several tracks, name the one it belongs to
pnpm new <slug> --track brand --feature <feature>   # brand collateral: a Board of artboards
pnpm guide <feature>                      # the feature's walkthrough, docs/sprints/<feature>/guide.md
pnpm export <slug>                        # brand artboards to exports/<slug>/: PNG for posts, PDF for slides and print (miles-brand)
pnpm check                                # TypeScript and Biome; must pass before you report done
pnpm fix                                  # Biome format and safe fixes
pnpm preflight                            # every check a share link needs (miles-deploy)
pnpm signin                               # Vercel sign-in as a link for the user to click; --wait 300 after (miles-deploy)
pnpm share                                # preflight, deploy, wait, check the live gate, print the handover (miles-deploy)
pnpm comments pull                        # review comments into docs/sprints/<feature>/comments.md (miles-review)
pnpm fixtures-pull <slug> --collection <id> --map key=path   # real fixtures from the CMS: Webflow, Payload, WordPress, or --from a JSON file (miles-get-hostile)
pnpm commands                             # every command, with its flags, as JSON
```

Each checkout (the main clone, a git worktree, a harness workspace) runs on its own port. A new one needs only `pnpm install && pnpm dev`: the first start claims a free port for the folder and writes it to `.env`. A harness that assigns ports sets `$DESIGN_HUB_PORT` (Conductor's `$CONDUCTOR_PORT` also works), and that wins. A taken port is refused. Never pass another port: a second port silently serves the wrong project.

## Layout

```
prototypes/<slug>/   one prototype: README.md, index.tsx, styles.css, fixtures.json
kit/                 the project's materials: tokens.css, shell.ts (brand, nav), icons.ts, AppShell, SiteShell
docs/sprints/<feature>/   design-doc.md, guide.md, comments.md (generated), port.md, assets/
DESIGN.md  PRODUCT.md     the design system's named rules (Brand for collateral); who the product is for
exports/                  exported collateral, gitignored; rebuilt from the prototype any time
.design-hub/project.json  the tracks and website platform (pnpm tracks set rewrites it)
.design-hub/checks.json   the Jev thresholds (design-hub calibrate --write rewrites it)
api/review.ts  proxy.ts  vercel.json   the deploy entries; one line each, never edited
```

Each track's sample is the reference for its conventions: `prototypes/sample-list/` for product, `prototypes/sample-page/` for website, `prototypes/sample-social/` for brand. Setup keeps only the samples of the project's tracks; delete one, with its `docs/sprints/` folder, once its track has a feature of its own.

## A prototype

README frontmatter, all fields required (`feature` may be empty for a one-off): `title`, `summary`, `context` (space | app | board), `track` (product | website | brand), `status` (exploring | decided | archived), `kind` (sprint | alternate | exploration), `feature`, `created`. `pnpm new` writes it.

The README's `## States` table lists every state the prototype holds and how to reach it. The fidelity guard asks whether a write adds a state that is not there, and `miles-port` refuses a folder without the table.

- Sub-pages are hash routes (`/sample-list/#/items/42`) via `useHashRoute`. The path belongs to the hub, and `/guide/`, `/api/` and `/assets/` are taken.
- Persist with `useStoredState(key, initial)`, keys prefixed with the slug. A preference, never a store.
- Only the open prototype's code and CSS load. Kit class names are shared: never reuse one for something else.

## Who sees a prototype

- A new prototype is **Internal**: only Studio can open it. A Studio person marks it **Client-facing** with the switch beside it on the hub's index (no command reads or sets it); a Client's index lists only client-facing prototypes. Say so when you hand a new one over. A switch flipped under `pnpm dev` writes this machine's store only; the deployed site keeps its own.
- Everything in `prototypes/<slug>/` (code, README, styles, fixtures, images) ships only to people who may see that prototype. The deployed site refuses its page and files to a Client while it is internal.
- Never reach into another prototype's files (an import, a CSS `@import` or `url()`, a `new URL`): the build refuses it, naming both. No web worker in a prototype either: the build refuses it (a worker in `kit/` that uses no prototype's files is fine). Run `pnpm build` before you share: it checks more than `pnpm dev` does. Never put shared code directly in `prototypes/` or in a folder there without a README: the build refuses it; shared code belongs in `kit/`. Write styles in plain CSS (or `.pcss`): Sass, Less and Stylus are refused in prototypes and in `kit/`, in `pnpm dev` and `pnpm build`, because their own imports resolve where no check sees them. The build also fails when a file outside a prototype's folder is one of that prototype's files whole (the same bytes, a `data:` URI of it, or its whole text as a string), however it got there; it does not look for part of a file, so shared lines and rules build. A `new URL` whose path is built at run time is not seen until its content lands outside the folder.
- A prototype's small images and SVGs are files of their own, never `data:` URIs, so the site can refuse them to a Client while the prototype is internal.
- `kit/` is shared with every signed-in person, clients included: nothing client-secret goes there, and nothing in it may point into a prototype's folder (the build refuses it). A link from one prototype's page to another's is fine.
- A dial is **Internal** too: a client's Controls panel has only the View tools until a dial is marked client-facing. Mark one in code with `client(...)` from `@kit/dials` only when the user asks for clients to have it; otherwise leave it, and Studio marks it with the eye beside its row in the Controls panel, which overrules the code on that site. Never mark fixtures, roles or scenarios: they are how the studio tests. An internal dial's name, range and default are still in the page's code a client's browser loads, so a dial's name never says what a client must not read. A client reads an internal dial's default, so the default is the value to present.
- Walkthrough text (`docs/sprints/<feature>/guide.md`) and feature names go to every signed-in person, clients included, whether or not the feature's prototypes are client-facing: a walkthrough must not name or describe internal work until the client may see it.
- `guide`, `api` and `assets` are the hub's paths, never a slug (`pnpm new` refuses them).

## A feature

One slug in two places: `docs/sprints/<feature>/` and the `feature:` line of every prototype that belongs to it. The hub serves `docs/sprints/<feature>/guide.md` at `/guide/<feature>/`; inside any prototype of the feature, **Open the walkthrough** is the last row of Controls. Nothing is wired by hand.

## Kit

`@kit/<name>` is `kit/<name>` when the project has that file, else the package's copy. Copying a package file into `kit/` under the same name replaces it everywhere.

| Import | What |
| --- | --- |
| `@kit/shell` | `BRAND`, `PRODUCT` (nav, workspace, user), `SITE` (nav, footer): the one place the chrome is written. |
| `@kit/AppShell`, `@kit/SiteShell` | The disposable shells. Mount the dialog, sheet and toast hosts and the View dials (theme, reduce motion, speed). A prototype never mounts `ViewTools` itself. `PageHead({ title, desc, back, actions })`. |
| `@kit/Space` | `<Space title lede width tools?>`: the low-gravity canvas. `tools` narrows the View panel to what changes something here: `['theme']` when nothing moves, `['motion']` when there is one theme, `false` for neither. |
| `@kit/Artboard` | `<Board title lede>` holding `<Artboard format name>`s: collateral at real pixel size, scaled to fit on screen, written to files by `pnpm export`. `FORMATS` lists the sizes. A board has no View panel and is held to the light look it exports in: no motion, no theme styles, no `ViewTools`; a dark version is a `tone` dial. |
| `@kit/ui` | `Button`, `Chevron`, `Segmented`, `Badge`, `Checkbox`, `useMenu`, `Select`, `openDialog`, `confirmDialog`, `openSheet`, `toast()`, `notInPrototype(what)`. Card, table and empty-state classes in `ui.css`. |
| `@kit/fixtures` | `fixtureSets({ real, missing }, { max, text })` returns `{ real, longest, empty, max, missing }`; `SET_NAMES` for the dial. |
| `@kit/Variants` | `<Variants options={{ Quiet, Editorial }}>`: the picker. Keys 1-N, arrows, R; `?v=N`. A client gets only the variants Studio marks with the picker's eye, the first when none is marked, and no picker when there is one. |
| `@kit/dials` | `useDials(name, config, { hints })` for values JS reads; `<DialVars name config target?>` writes CSS variables without re-rendering. Every dial carries a hint. `client(dial)` around a dial, or a folder of them, marks it client-facing. |
| `@kit/Icon`, `@kit/icons` | `<Icon name size label?>`. Add a glyph in `kit/icons.ts`. |
| `@kit/prefs`, `@kit/hooks`, `@kit/format`, `@kit/motion` | Theme and motion preferences; `useHashRoute`, `useStoredState`; `fmtDate`, `plural`; `ease.*` and `spring.*`. |
| `@kit/tokens.css` | The design's tokens, light and `.dark-mode`. Loaded globally. |

URL switches on any prototype: `?v=2`, `?theme=dark|light|system`, `?motion=reduce`, `?a11y=0`, and `?lapse` when the project has installed `@aiforui/lapse` (`pnpm add -D @aiforui/lapse`; it is not part of the hub).

## Code

- TypeScript strict. `any` is allowed when it saves time; never `// @ts-ignore`.
- Comments: none by default. One line when the reason is not obvious. Rationale, values and rejected options go in the README.
- Colors, radii, shadows, type and motion come from tokens. A raw value is a decision: name it in the README or add a token and note it in `DESIGN.md`.
- Copy follows `DESIGN.md` and the product voice: plain, specific, no em dashes.
- **The Scope Toast Rule.** Anything a control would do that the prototype does not build says so in the prototype's own voice: `notInPrototype('Model history')`, or `toast(message, { kind: 'scope' })`. A product toast with a green check for something that did not happen is a bug.

## Definition of done

1. `pnpm check` passes.
2. The page loads with no console errors and no `[a11y]` warnings.
3. The main path works by keyboard alone.
4. `?motion=reduce` and `?theme=dark` look right, when the prototype has motion or should support dark.
5. README is current: problem, question, flows or directions, states, fixtures, and the decision once there is one.

Say what you could not verify. Do not commit unless asked.

## Skills

The `miles-*` skills in `.claude/skills/` come from the `@milesroxas/design-hub` package (`pnpm skills` refreshes them and adds any `package.json` script they call; never edit the copies). The package upgrades itself: a SessionStart hook runs `design-hub upgrade` on every new session. When it reports an upgrade, tell the user in one line and commit `package.json`, the lockfile and `.claude/` as their own commit ("Upgrade Design Hub to <version>") with the next commit the user asks for. When it reports a failure, say so and offer `pnpm exec design-hub upgrade` once the cause is fixed. Load one when its trigger matches.

| Skill | Load when |
| --- | --- |
| `miles-prototype` | Writing or changing any prototype code: the fidelity ceiling, DialKit, motion, accessibility, performance. |
| `miles-new-feature` | Starting a feature or a prototype: the folder, the README, `docs/sprints/<feature>/`. |
| `miles-get-hostile` | Writing `fixtures.json` or deciding what an edge case looks like. |
| `miles-paper-to-prototype` | Every Paper MCP read. Maps Paper output onto the kit's tokens and components. |
| `miles-deploy` | Deploying, sharing or updating the link, signing in to Vercel, adding people and sending each their sign-in link, a new link for another device, how long access lasts, turning on comments, checking the work before any of those. The user never types these commands: run them and send any link they must click. |
| `miles-review` | Comments from the deployed prototypes, and who may comment. |
| `miles-port` | Turning an approved prototype into production. |
| `miles-brand` | Brand collateral: social posts, slides, print; artboards, formats and export. |
| `miles-worktrees` | Worktrees, parallel agents, Conductor or any harness, and port collisions. |

Existing skills these lean on: `emil-prototype`, `emil-animations`, `emil-touch-and-accessibility`, `emil-performance`, `emil-writing-skills` for every Markdown file, `impeccable` for a design pass. If a skill disagrees with this file, this file wins.
