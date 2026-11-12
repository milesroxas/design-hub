# Agent guide

The contract for every coding agent in this project (Claude, Codex, Cursor, others). `CLAUDE.md` points here.

This project holds prototypes, the materials they are drawn with, and the documents around them. The hub that lists and serves them, the review panel, the password gate and the `design-hub` command are the `@milesroxas/design-hub` package in `node_modules`: never edit it, never read it to do prototype work. Everything an agent touches is in this folder.

## Why it works this way

Code here is for sketching, not shipping. Following Karri Saarinen's [Design is more than code](https://linear.app/now/design-is-more-than-code), a prototype answers a question that was written down first, in words. Speed comes from removing production constraints, never from skipping the problem.

1. **Problem first.** `README.md` states the problem and the one question before any code exists. Restate it when you present the prototype.
2. **Two places to stand.** Pick one per prototype: the disposable shell (`AppShell` for a product, `SiteShell` for a website), the project's chrome from `kit/shell.ts` and `DESIGN.md`, Shell; or the low-gravity space (`Space`), one thing alone on a quiet canvas with the picker and live dials.
3. **Low gravity.** A prototype imports only `@kit/*` and its own folder. Never another prototype. No tests, no stories, no abstractions for later. The fidelity ceiling is in the `miles-prototype` skill, and the fidelity guard hook says so when a write goes over it.
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
pnpm new <slug> --feature <feature>       # a space prototype with the picker and dials
pnpm new <slug> --app --sprint --feature <feature>   # the feature's one primary prototype, in the shell
pnpm new <slug> --app --alternate --feature <feature>   # another take on the primary
pnpm guide <feature>                      # the feature's walkthrough, docs/sprints/<feature>/guide.md
pnpm check                                # TypeScript and Biome; must pass before you report done
pnpm fix                                  # Biome format and safe fixes
pnpm preflight                            # every check a share link needs (miles-deploy)
pnpm comments pull                        # review comments into docs/sprints/<feature>/comments.md (miles-review)
pnpm fixtures-pull <slug> --collection <id> --map key=field   # real fixtures from Webflow (miles-get-hostile)
pnpm commands                             # every command, with its flags, as JSON
```

Each checkout (the main clone, a git worktree, a harness workspace) runs on its own port. A new one needs only `pnpm install && pnpm dev`: the first start claims a free port for the folder and writes it to `.env`. A harness that assigns ports sets `$DESIGN_HUB_PORT` (Conductor's `$CONDUCTOR_PORT` also works), and that wins. A taken port is refused. Never pass another port: a second port silently serves the wrong project.

## Layout

```
prototypes/<slug>/   one prototype: README.md, index.tsx, styles.css, fixtures.json
kit/                 the project's materials: tokens.css, shell.ts (brand, nav), icons.ts, AppShell, SiteShell
docs/sprints/<feature>/   design-doc.md, guide.md, comments.md (generated), port.md, assets/
DESIGN.md  PRODUCT.md     the design system's named rules; who the product is for
.design-hub/checks.json   the Jev thresholds (design-hub calibrate --write rewrites it)
api/review.ts  proxy.ts  vercel.json   the deploy entries; one line each, never edited
```

`prototypes/sample-list/` is the reference for every convention; delete it once the project has a feature.

## A prototype

README frontmatter, all fields required (`feature` may be empty for a one-off): `title`, `summary`, `context` (space | app), `status` (exploring | decided | archived), `kind` (sprint | alternate | exploration), `feature`, `created`. `pnpm new` writes it.

The README's `## States` table lists every state the prototype holds and how to reach it. The fidelity guard asks whether a write adds a state that is not there, and `miles-port` refuses a folder without the table.

- Sub-pages are hash routes (`/sample-list/#/items/42`) via `useHashRoute`. The path belongs to the hub, and `/guide/` is taken.
- Persist with `useStoredState(key, initial)`, keys prefixed with the slug. A preference, never a store.
- Only the open prototype's code and CSS load. Kit class names are shared: never reuse one for something else.

## A feature

One slug in two places: `docs/sprints/<feature>/` and the `feature:` line of every prototype that belongs to it. The hub serves `docs/sprints/<feature>/guide.md` at `/guide/<feature>/`; inside any prototype of the feature, **Open the walkthrough** is the last row of Controls. Nothing is wired by hand.

## Kit

`@kit/<name>` is `kit/<name>` when the project has that file, else the package's copy. Copying a package file into `kit/` under the same name replaces it everywhere.

| Import | What |
| --- | --- |
| `@kit/shell` | `BRAND`, `PRODUCT` (nav, workspace, user), `SITE` (nav, footer): the one place the chrome is written. |
| `@kit/AppShell`, `@kit/SiteShell` | The disposable shells. Mount the dialog, sheet and toast hosts and the View dials. `PageHead({ title, desc, back, actions })`. |
| `@kit/Space` | `<Space title lede width>`: the low-gravity canvas. |
| `@kit/ui` | `Button`, `Chevron`, `Segmented`, `Badge`, `Checkbox`, `useMenu`, `Select`, `openDialog`, `confirmDialog`, `openSheet`, `toast()`, `notInPrototype(what)`. Card, table and empty-state classes in `ui.css`. |
| `@kit/fixtures` | `fixtureSets({ real, missing }, { max, text })` returns `{ real, longest, empty, max, missing }`; `SET_NAMES` for the dial. |
| `@kit/Variants` | `<Variants options={{ Quiet, Editorial }}>`: the picker. Keys 1-N, arrows, R; `?v=N`. |
| `@kit/dials` | `useDials(name, config, { hints })` for values JS reads; `<DialVars name config target?>` writes CSS variables without re-rendering. Every dial carries a hint. |
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

The `miles-*` skills in `.claude/skills/` come from the `@milesroxas/design-hub` package (`pnpm skills` refreshes them; never edit the copies). Load one when its trigger matches.

| Skill | Load when |
| --- | --- |
| `miles-prototype` | Writing or changing any prototype code: the fidelity ceiling, DialKit, motion, accessibility, performance. |
| `miles-new-feature` | Starting a feature or a prototype: the folder, the README, `docs/sprints/<feature>/`. |
| `miles-get-hostile` | Writing `fixtures.json` or deciding what an edge case looks like. |
| `miles-paper-to-prototype` | Every Paper MCP read. Maps Paper output onto the kit's tokens and components. |
| `miles-deploy` | Deploying, sharing a link, the password, checking the work before either. |
| `miles-review` | Comments from the deployed prototypes, and who may comment. |
| `miles-port` | Turning an approved prototype into production. |
| `miles-worktrees` | Worktrees, parallel agents, Conductor or any harness, and port collisions. |

Existing skills these lean on: `emil-prototype`, `emil-animations`, `emil-touch-and-accessibility`, `emil-performance`, `emil-writing-skills` for every Markdown file, `impeccable` for a design pass. If a skill disagrees with this file, this file wins.
