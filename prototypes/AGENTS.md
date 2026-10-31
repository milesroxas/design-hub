# Prototypes: agent guide

Read this before touching anything under `prototypes/`. It is the contract for every coding agent (Claude, Codex, Cursor, others). `CLAUDE.md` points here.

One Vite + React + TypeScript app. Each top-level folder without a leading underscore is one disposable prototype. The shell lists them at `/` and loads one at `/<slug>/`. Folders that start with `_` are infrastructure, and so are `api/`, `proxy.ts` and `checks.json`.

## Why it works this way

Code here is for sketching, not shipping. Following Karri Saarinen's [Design is more than code](https://linear.app/now/design-is-more-than-code), a prototype answers a question that was written down first, in words. The code is how the answer gets found. Speed comes from removing production constraints, never from skipping the problem.

1. **Problem first.** `README.md` states the problem and the one question before any code exists. Restate it when you present the prototype.
2. **Two places to stand.** Pick one per prototype:
   - **The disposable shell** (`AppShell` for a product, `SiteShell` for a website): the project's chrome, close enough to the real thing that a feature can be judged in context. Cheap to rebuild, never production code. What the chrome is comes from `_kit/shell.ts` and `DESIGN.md`, Shell.
   - **The low-gravity space** (`Space`): one thing alone on a quiet canvas, with the picker, live dials and slow motion at hand.
3. **Low gravity.** Nothing pulls a prototype down. It imports only `@kit/*` and its own folder. It never imports another prototype or `_shell/`, and nothing in production ever imports a prototype. No tests, no stories, no abstractions for later. The fidelity ceiling is in the `miles-prototype` skill, and the fidelity guard (`.claude/hooks/fidelity-guard.sh`) says so when a write goes over it.
4. **Fork, don't flex.** If a kit piece needs to behave differently, copy it into the prototype folder and change the copy. Never add a prop or a variant to `_kit` for one prototype.
5. **Promote on second use.** When a second prototype copies the same thing, move it into `_kit` and point both at it.
6. **Real materials, worst content.** Real tokens, fonts and icons. The content comes from `fixtures.json`: `real` pulled from the CMS or copied from the comp, `missing` written by hand, and `longest`, `empty` and `max` derived by `@kit/fixtures`. Pretty placeholder data hides the decision.
7. **Done means decided.** When the user picks, write the decision in the prototype's README: what was chosen, its values, what was rejected and why. Then delete the folder, or set `status: archived` if the user wants it kept.
8. **The floor never moves.** Accessibility and performance are not polish passes. A prototype that fails them answers a question about a product nobody would ship. See `_guides/`.

## Stack (fixed)

| Need | Use | Not |
| --- | --- | --- |
| Build, dev server | Vite 8 on the `PORT` in `.env` (`pnpm bootstrap` picks it) | anything else, another port |
| UI | React 19 function components, TypeScript strict | class components (error boundaries only) |
| Styling | Plain CSS files beside the component, `_kit/tokens.css` variables | Tailwind, CSS-in-JS, CSS modules, UI libraries |
| Motion | CSS transitions, `@starting-style`, keyframes, WAAPI first; `motion` (`motion/react`) only when `_guides/motion.md` says it earns it | GSAP, react-spring, other motion libraries |
| Live values, prototype controls | DialKit through `@kit/dials`: sliders, toggles, selects, action buttons | custom control panels, testing aids inside the product chrome (a sidebar item, a sheet) |
| Data | `fixtures.json` in the feature folder, bundled at build | fetching, a server, a database, localStorage as a store |
| Slow motion, takes | Lapse, `?lapse` | |
| Accessibility check | axe-core in dev (console `[a11y]`), Biome a11y lint | |
| Format, lint | Biome (`pnpm fix`, `pnpm check`) | ESLint, Prettier |
| State, routing | `useState`, a module store with `useSyncExternalStore`, `@kit/hooks` `useHashRoute` | state libraries, React Router |
| Tests, prototypes | none | Vitest, Jest, Playwright test suites, Storybook |
| Tests, infrastructure (`_core`, `_server`, `_scripts`, `proxy.ts`) | `node:test` beside the file (`x.test.ts`), run by `pnpm test` | a test framework dependency |

Adding a dependency needs the user's OK. Ask, with the reason and the bundle cost.

## Commands

Run from `prototypes/`.

```bash
pnpm bootstrap                            # once per clone: a free port into .env and .claude/launch.json, pnpm install
pnpm commands                             # every script below, with its flags, as JSON
pnpm dev                                  # http://localhost:<PORT>, review panel and all
pnpm new <slug> --feature <feature>       # a space prototype with the picker and dials
pnpm new <slug> --app --title "Title"     # a prototype inside the shell
pnpm new <slug> --app --sprint --feature <feature>   # the feature's one primary prototype; refused if it has one
pnpm new <slug> --app --alternate --feature <feature>   # another take on the primary; refused until it exists
pnpm new:guide <feature>                  # the feature's walkthrough, docs/sprints/<feature>/guide.md
pnpm check                                # tsc + Biome; must pass before you report done
pnpm test                                 # the infrastructure's node:test suites
pnpm quality                              # fallow over real test coverage: dead code, duplication, layers, complexity
pnpm fix                                  # Biome format and safe fixes
pnpm guard <file>                         # the fidelity guard by hand, over a whole file
pnpm preflight                            # every check a share link needs (miles-deploy)
pnpm fixtures:pull <slug> --collection <id> --map key=field   # real fixtures from Webflow (miles-get-hostile)
pnpm comments pull                        # review comments into docs/sprints/<feature>/comments.md (miles-review)
pnpm people invite --name <n> --team <t>  # an invite link to comment (miles-review)
pnpm calibrate                            # Jev thresholds from labelled judgments
pnpm visual-match <slug> --comp <png> --shot <png>   # experimental, TypeSafe on
pnpm elyx                                 # the Elyx add-on: design-system/ from tokens.css
```

Every script is agent-facing: flags only, no prompts, one JSON object on stdout, `--help` prints its schema, and `ok: false` comes with `fix`. Read the JSON; never parse prose.

The port is Conductor's `$CONDUCTOR_PORT` in a workspace, else the one in `.env`. `strictPort` refuses a taken one, and `pnpm bootstrap` names the process that holds it. Never pass `--port` to `pnpm dev` to get round that: a second port silently serves the wrong project. The launch config in `.claude/launch.json` carries the same port.

## Layout

```
prototypes/
  AGENTS.md  CLAUDE.md  README.md
  _shell/       the browser shell: index page, loader, error boundary, a11y watcher, walkthroughs at /guide/<feature>/, the review panel (review/)
  _kit/         shared materials: tokens, base, Icon, shell.ts, AppShell, SiteShell, Space, Variants, dials, fixtures, prefs, hooks, motion, ui/
  _core/        the shared kernel, pure: README states, catalog, fixture sets, checks, the Jev client, contacts, bytes, images, the review domain (review/)
  _server/      Node and HTTP adapters: the review API, signed sessions, the stores, env and paths, the dev server
  _scripts/     the agent-facing CLI, one file per pnpm command; lib/ holds what they share
  api/          the Vercel function entry for /api/review
  proxy.ts      the gate: shared password to view, invite links to comment
  checks.json   every Jev threshold, and the contacts confirmed as business ones
  _templates/   space/ and app/, copied by `pnpm new`; guide.md, copied by `pnpm new:guide`
  _guides/      motion.md, accessibility.md, performance.md
  sample-list/  the sample prototype: the reference for every convention below; delete it once the project has a feature
  <slug>/       one prototype: README.md, index.tsx, styles.css, fixtures.json, anything else it needs
```

The layers, from the inside out, are enforced by `pnpm quality` (`.fallowrc.jsonc`, boundaries), not by convention:

| Layer | May import |
| --- | --- |
| `_core` | nothing outside itself; no React, no DOM, no file system, no network except what a caller passes in |
| `_kit` | `_core` |
| `_shell` | `_core`, `_kit`, and the prototypes it hosts |
| `_server`, `api/`, `proxy.ts` | `_core` |
| `_scripts` | `_core`, `_server` |
| a prototype | `@kit/*` and its own folder (the fidelity guard holds this on every write) |

A rule that two layers need goes in `_core`, once. Never copy it.

## A prototype

```
<slug>/
  README.md       frontmatter feeds the index; Problem, Question, Flows or Directions, States, Fixtures, Decision
  index.tsx       export default function Prototype() { ... }
  styles.css      imported by index.tsx
  fixtures.json   { real: [...], missing: [...] }; @kit/fixtures derives longest, empty and max
```

README frontmatter, all fields required (`feature` may be empty for a one-off):

```yaml
---
title: Sample list
summary: One line on what this explores.
context: app            # space | app
status: exploring       # exploring | decided | archived
kind: sprint            # sprint | alternate | exploration; pick with README.md, The index, Which kind
feature: sample         # the folder under docs/sprints/; groups the index and finds the walkthrough
created: 2026-10-30
---
```

The README's `## States` table lists every state the prototype holds and how to reach it. The fidelity guard asks whether a write adds a state that is not there, and `miles-port` refuses a folder without the table: a state nobody wrote down is a state nobody tests.

## A feature

A feature is one bounded effort and the key that ties its material together, by one slug used in two places:

| Where | What |
| --- | --- |
| `docs/sprints/<feature>/` | `design-doc.md`, `guide.md` (the reviewer's walkthrough), `comments.md` (generated by `pnpm comments pull`; never edited), `port.md` (the port report, once `miles-port` has run), `archive/`, and `assets/` for the figures only these documents embed. |
| `<slug>/README.md` `feature:` | Every prototype of the feature: its one primary (`sprint`), its alternates, its internal explorations. The index groups them under the feature's name in that order. |

The shell finds `docs/sprints/*/guide.md` by glob and serves each at `/guide/<feature>/` (`/guide/` alone opens the only one, or lists them). Inside any prototype of the feature, **Open the walkthrough** is the last row of Controls, under every group, and opens that page in a new tab so the reviewer reads and clicks side by side. The guide's **Open the prototype** button goes to the feature's sprint prototype. Nothing about a guide is wired by hand: write the file and both links appear.

- Only the open prototype's code and CSS load, and leaving it is a full page load, so its CSS cannot leak into another prototype. Kit class names are shared, though: never reuse a kit class name for something else.
- Sub-pages are hash routes (`/sample-list/#/items/42`) via `useHashRoute`. The path segment belongs to the shell, and `/guide/` is taken by the walkthroughs (see README).
- Persist with `useStoredState(key, initial)`. Prefix keys with the slug. This is a prototype preference, never a store.

## Kit

| Import | What |
| --- | --- |
| `@kit/shell` | `BRAND`, `PRODUCT` (nav, workspace, user) and `SITE` (nav, footer): the one place the project's chrome is written. Filled from the Paper frames `DESIGN.md`, Shell, names. |
| `@kit/AppShell` | `<AppShell active={path} role nav? workspace? user?>`: the disposable product shell (sidebar, workspace menu, hash nav, user). Product chrome only. Mounts the dialog, sheet and toast hosts and the View dials; the Controls panel (DialKit) starts closed, parked beside the brand, so the product stays in view, and opens on Open the walkthrough when the feature has a guide. A prototype's own testing aids (role, fixtures, scenarios) go in a `useDials` panel, registered in the order a reviewer reaches for them (sibling components register in order; a child registers before its parent). `PageHead({ title, desc, back, actions })`. |
| `@kit/SiteShell` | `<SiteShell active={path} nav? preFooter?>`: the disposable website shell (header, content, pre-footer slot, footer). Same hosts and dials as AppShell. |
| `@kit/Space` | `<Space title lede width="narrow\|wide\|full">`: the low-gravity canvas. Mounts the View dials (theme, reduce motion, speed). |
| `@kit/ui` | Product materials: `Button` (icon-only requires `aria-label`), `Chevron`, `Segmented`, `Badge`, `Checkbox`, `useMenu(config)`, `Select`, `openDialog`, `confirmDialog`, `openSheet`, `toast()`, `notInPrototype(what)`. Card, table and empty-state classes in `ui.css`. Needs a shell (or `OverlayHost` and `Toaster`) mounted. |
| `@kit/fixtures` | `fixtureSets({ real, missing }, { max, text })` returns `{ real, longest, empty, max, missing }`; `text` names the free-text fields `longest` stretches. `SET_NAMES` for the dial. A set written in the JSON by hand wins over the derived one. |
| `@kit/Variants` | `<Variants options={{ Quiet, Editorial }} onReplay?>`: the picker, styled as the `emil-prototype` skill specifies; never restyle it. Keys 1-N, arrows, R; `?v=N`. Switching is instant and remounts. |
| `@kit/dials` | `useDials(name, config, options?)` for values JS reads; `<DialVars name config target?>` writes CSS variables without re-rendering (unitless numbers: `calc(var(--duration) * 1ms)`). `options.hints` names what each dial does, one sentence per key (a folder's as a nested object; an action's by its key, matched to its button), shown under the row on hover or focus. `writeDialVars(el, values)` is the writer `DialVars` uses, for a panel whose values JS reads too. `snapshotDials()` and `restoreDials()` carry every panel's values by name; review comments use them to reopen a state. One DialKit root per page, mounted for you, titled Controls (`DIALS_TITLE`) rather than the library's name, and kept on in production builds (`productionEnabled`) so the deployed prototypes carry their dials. |
| `@kit/Icon` | `<Icon name size label?>`. Decorative unless `label` is set. Names come from `_kit/icons.ts`; add a glyph there by pasting its inner SVG. |
| `@kit/prefs` | `useReducedMotion`, `useDark`, `setAppearance`, `useSpeed`/`getSpeed`. Mirrored on `<html>` as `.dark-mode` and `[data-motion="reduce"]`. |
| `@kit/hooks` | `useHashRoute`, `useStoredState`. |
| `@kit/format` | `fmtDate(iso)` ("28 Oct 2026") and `plural(n, word)`, the same in the shell and every prototype. |
| `@kit/motion` | `ease.*` and `spring.*` matching the CSS tokens, for `motion/react` and WAAPI. |
| `@kit/tokens.css` | The design's tokens (light, `.dark-mode`), `--font`, `--ease-*`, `--dur-*`. Loaded globally. `miles-paper-to-prototype` replaces the values from the design. |
| `_shell/system.css` | The hub's own look, never the design's: Geist and Geist Mono (`--sys-font`, `--sys-font-mono`), the harness material (`--harness-*`: one dark neutral surface in both themes, for anything the prototype says in its own voice), and the `.sys` scope that remaps the semantic tokens to pure neutrals on the index, the walkthrough and notices. Never edit it to match a project. |

URL switches on any prototype: `?v=2` variant, `?theme=dark|light|system`, `?motion=reduce`, `?lapse` (Lapse panel), `?a11y=0` (silence axe).

## Code

- TypeScript strict. `any` is allowed when it saves time; never `// @ts-ignore`.
- In `_core`, `_server` and `_scripts`, relative imports carry the `.ts` extension: Node runs those files as TypeScript directly, and Vercel's compiler rewrites the extension. Nothing there imports React or the DOM, and nothing in `_core` touches the file system or the network except through what a caller passes in.
- Comments: none by default. One line when the reason is not obvious from the code. Rationale, values and rejected options go in the README.
- Names say what a thing is in the product's words (`ItemRow`, not `Row2`).
- Colors, radii, shadows, type and motion come from tokens. A raw value is a decision: name it in the README or add a token and note it in `DESIGN.md`.
- Copy follows `DESIGN.md` and the product voice: plain, specific, no em dashes.
- **The Scope Toast Rule.** Anything a control would do that the prototype does not build says so in the prototype's own voice, never the product's: `notInPrototype('Model history')` (the sentence is fixed: "Model history is not part of this prototype."), or `toast(message, { kind: 'scope' })` when the sentence is yours ("The file would download here."). A scope toast wears the harness material and the dashed circle (`circle-dashed`), a slot the sketch leaves empty. A product toast with a green check for something that did not happen is a bug.
- The repo's design rules live in `/DESIGN.md` (named rules) and the product context in `/PRODUCT.md`. Comps live in Paper; `sketches/paper/` holds exports a document cites.

## Motion, accessibility, performance

The short version. The guides hold the detail and are binding.

- **Motion** (`_guides/motion.md`): animate only with a purpose; never animate keyboard-initiated actions; ease-out custom curves from tokens, no `ease-in` on an entrance; UI under 300ms; transform and opacity only; transitions for anything interruptible; popovers grow from their trigger, modals from center; press feedback `scale(0.97)`; hover behind `(hover: hover) and (pointer: fine)`; reduced motion keeps fades, drops movement.
- **Accessibility** (`_guides/accessibility.md`): native elements first; every control has a name; everything works by keyboard with a visible focus ring; Esc closes and focus returns; dialogs trap focus; async status is announced; AA contrast from tokens; 24px minimum targets; works at 200% zoom.
- **Performance** (`_guides/performance.md`): CSS before JS; no re-render per frame or per slider tick; narrow subscriptions; long lists use `content-visibility` or virtualize; nothing heavy in `_kit`.

## Definition of done

Before you report a prototype or a change as done:

1. `pnpm check` passes.
2. The page loads with no console errors and no `[a11y]` warnings (axe runs about 2 seconds after the page settles).
3. The main path works by keyboard alone.
4. `?motion=reduce` and `?theme=dark` look right, when the prototype has motion or should support dark.
5. README is current: problem, question, flows or directions, states, fixtures, and the decision once there is one.

Say what you could not verify. Do not commit unless asked.

## Skills

The `miles-*` skills in `.claude/skills/` are the hub's own. Load one when its trigger matches; the user can invoke any by name.

| Skill | Load when |
| --- | --- |
| `miles-prototype` | Writing or changing any prototype code. Owns the low-gravity rules, the fidelity ceiling and the DialKit patterns. |
| `miles-new-feature` | Starting a feature or a prototype: the folder, the README, `docs/sprints/<feature>/`. |
| `miles-get-hostile` | Writing `fixtures.json` or deciding what an edge case looks like: longest, empty, maximum count, missing media. |
| `miles-paper-to-prototype` | Every Paper MCP read, not only the first. Maps Paper output onto `_kit` tokens and components. |
| `miles-deploy` | Deploying, sharing a link, setting the password, or checking the work before either. |
| `miles-port` | Turning an approved prototype into production, in Webflow or in another codebase. |
| `miles-review` | Comments from the deployed prototypes: pulling, sorting, acting, resolving, and who may comment. |
| `miles-conductor` | Running the project in Conductor workspaces, and any port collision. |
| `miles-design-hub` | Global only: starting a new project from this template. Never inside a project. |

Existing skills these lean on: `emil-prototype` for variant explorations, `emil-animations`, `css-animations` or `motion-react` for motion, `emil-touch-and-accessibility` for interaction, `emil-performance` for anything list-heavy, `emil-writing-skills` for every Markdown file (the hook in `.claude/settings.json` asks for it on each `.md` edit), `impeccable` for a design pass. If a skill disagrees with this file, this file wins.
