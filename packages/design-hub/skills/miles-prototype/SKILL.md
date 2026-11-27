---
name: miles-prototype
description: "The rules for writing or changing any prototype code under prototypes/: low gravity, the fidelity ceiling, DialKit patterns, the scope toast, and the binding motion, accessibility and performance rules in references/. Load before the first line of prototype code in a session and again whenever a change touches kit/. Triggers on: prototype, prototyping, build the state, add a dial, DialKit, variant, fixture set, fidelity, too much code, kit, AppShell, SiteShell, Space, motion, animation, accessibility, performance."
---

# Prototype

A prototype here answers one written question with the least code that can answer it, in the project's real materials, with every state reachable from a dial. This skill holds the ceiling. `AGENTS.md` holds the stack and the layout; the sample of the prototype's track (`prototypes/sample-list/` for product, `prototypes/sample-page/` for website, `prototypes/sample-social/` for brand, where `miles-brand` adds the collateral rules) is the worked example and wins over any description of it here.

## Before the first line

1. Read the feature's `README.md`. If it has no Problem, Question and States, stop and write them with `miles-new-feature`. Code written before the question is code that answers a different question.
2. Decide where it stands: `AppShell` or `SiteShell` when the question is about the feature in context, `Space` when it is about one thing alone. Never both in one prototype.
3. Read the `index.tsx` of the track's sample once per session (`sample-list` for product, `sample-page` for website, `sample-social` for brand, whichever the project kept). It is the reference for every pattern below.

## The fidelity ceiling

The guard (the `design-hub hook fidelity-guard` hook in `.claude/settings.json`) names these rules when a write goes over them; the headings are the names it uses. It speaks at two levels, with thresholds in `.design-hub/checks.json`:

- **A warning** arrives as context. Fix it, or say in one sentence why this write earns it.
- **A block** stops the turn until you answer it: an import that leaves the feature folder, or a Jev judgment over `fidelity.blockAt`. Undo the write, or tell the user why it must stay and wait for their answer. Never write around a block.

A finding with a log id (`log 3f9a…`) was Jev's. When the user says it was wrong, run `pnpm calibrate --no <id>`; when right, `--yes <id>`. Why: the thresholds move only with labels, so an unlabelled false alarm keeps firing.

### Low gravity

A prototype imports only `@kit/*` and files in its own folder. Never another prototype, never the hub's own code in `node_modules/@milesroxas/design-hub`. Why: the moment two prototypes share a file, deleting one breaks the other, and a prototype that cannot be deleted is production. The build refuses an import from another prototype's folder, naming both files: copy the file in, or promote it to `kit/`.

### Fork, don't flex

A kit piece that needs to behave differently is copied into the feature folder and changed there. Never add a prop, a variant or a branch to `kit/` for one prototype. Promote on second use: when a second prototype copies the same thing, move it into `kit/` and point both at it, in one change that says so. A kit piece that lives in the package (`@kit/ui`, `@kit/dials`) is forked the same way: copy the file into `kit/` under the same name and every import takes the copy.

### No new dependency without the user

Adding a package needs the user's OK first, with the reason and the gzipped cost. Why: every prototype pays for every kit import, and a library brought in for one state stays for all of them.

### Fixtures, never a backend

Data is `fixtures.json` in the feature folder, bundled at build (`miles-get-hostile`). Never `fetch`, never a server module, never IndexedDB, never `localStorage` as a store (`useStoredState` is for a prototype preference, such as which fold is open). Latency, when it is part of the question, is a timer on a dial. Why: a prototype with a backend has a second thing that can be wrong, and a reviewer cannot tell which.

### No abstraction for later

No custom hook, context, generic component or utility module used in one place. Inline it. Why: an abstraction is a bet on a second use, and the second use is the one that moves it into `kit/`, not the first.

### No handling a fixture cannot reach

No error state, loading state or validation for a case none of `real`, `longest`, `empty`, `max`, `missing` exercises. If the case matters, add it to `fixtures.json` and the README's States first; then build the handling and put it on the dial. Why: handling nobody can reach is code nobody reviews.

### Every state is in the README

A user-visible state the README's `## States` table does not list does not exist. Add the row before the code, with how to reach it (a dial, a route, a click). Why: `miles-port` builds from that table, and a state missing there is a bug found after launch instead of before.

### Scope, said in the prototype's voice

Anything a control would do that the prototype does not build says so: `notInPrototype('Model history')` or `toast(message, { kind: 'scope' })`. Never a product toast with a green check for something that did not happen. Why: a reviewer who sees a success they did not get stops trusting the ones they did.

## Who sees it

A new prototype is **Internal**: only Studio can open it, until a Studio person marks it **Client-facing** with the switch beside it on the hub's index (no command reads or sets it). Never tell the user a new prototype is ready for the client before that. Everything in `prototypes/<slug>/` (code, README, styles, fixtures, images) ships only to people who may see that prototype: the deployed site refuses its page and files to a Client while it is internal. Why: an internal prototype stays inside the studio only because nothing of it leaves its folder.

- Never reach into another prototype's folder: an import, a CSS `@import` or `url()`, a `new URL(…, import.meta.url)`. The build refuses each, naming both files: copy the file in, or promote it to `kit/`. A link to another prototype's page is fine; reading its files is not. And nothing in `kit/` may point into a prototype's folder: the build refuses that too.
- No web worker in a prototype (`new Worker`, `?worker`, `?worker&inline`): Vite builds it outside the prototype's folder, so the build refuses it. Run the work on the main thread, or build the worker from `kit/` files that use no prototype's.
- Write styles in plain CSS (or `.pcss`). Sass, Less and Stylus are refused in prototypes and in `kit/`, in `pnpm dev` and `pnpm build`, naming the file. Why: their own `@import` and `@use` resolve inside the preprocessor, where no check can see a reach into another prototype.
- The build also reads what it wrote, as a backstop for a whole file copied out of the folder: a file outside a prototype's folder that is one of its files whole (the same bytes, a `data:` URI of it, or its whole text as a string in a script) fails it, naming both files. It does not look for a part of a file, so shared lines, rules or snippets build.
- Limits: a `new URL` whose path is built at run time is not seen, until its content lands outside the folder. `pnpm dev` checks less than `pnpm build` (no read or output check). Nothing directly in `prototypes/`, or in a folder there without a README: shared code belongs in `kit/`, and the build refuses the rest. Run `pnpm build` before sharing.
- A prototype's small images and SVGs are built as files of their own, never inlined as `data:` URIs, so the site can refuse them to a Client while the prototype is internal.
- `kit/` is shared with every signed-in person, the client included, so nothing client-secret goes there: no unreleased product name, internal note or real data that only one prototype may show.
- Walkthrough text (`docs/sprints/<feature>/guide.md`) and feature names go to every signed-in person, clients included, whether or not the feature's prototypes are client-facing. A walkthrough must not name or describe internal work until the client may see it.

## DialKit patterns

Walk this for every number and every switch:

```
Is it a value CSS consumes (duration, distance, scale, colour)?
├── Yes → <DialVars name config target={ref}> and read it as var(--key) with calc(var(--dur) * 1ms)
│         Why: a slider tick re-renders nothing; React state per tick stutters at 60fps.
└── No
    ├── Does JS branch on it (which fixture set, which role, a count)?
    │   └── Yes → useDials(name, config, { hints }); one panel per group a reviewer reaches for
    └── Does code also set it (a reset, every toggle at once)?
        └── Yes → useDialsController
```

- Every dial carries a hint: one sentence, the unit named. A reviewer never guesses what a slider does.
- Panels register in the order a reviewer reaches for them: Review (fixtures, role, scenarios) first, then the feature's own numbers, then Motion. View is mounted by the shell.
- Slider defaults are the comp's values. The decision is the number the user settles on; copy it into the README's Decision with the rejected range.
- Every dial is internal: a client's panel has the View tools and nothing else until a dial is marked client-facing. `client(...)` from `@kit/dials` marks one where it is declared (`density: client({ type: 'select', ... })`, or around a folder for every dial in it); use it only when the user asks for clients to have that dial. Studio can also mark any dial with the eye beside its row, per deployed site, and that overrules the code. Fixtures, roles and scenarios stay internal.
- A client reads an internal dial at its default, so the default is the value to present, not a test value.
- The picker is Studio's until marked: a client gets the first variant and no picker, unless Studio marks variants with the picker's eye. Put the direction to present first.
- Never a control inside the product chrome. A sidebar item or a sheet that switches fixtures is a testing aid wearing the product's clothes.

## Motion, accessibility, performance

The references beside this skill (`references/motion.md`, `references/accessibility.md`, `references/performance.md`) are binding; the short rules: transform and opacity only, ease-out in and ease-in out, nothing over 300ms, nothing animates on a keyboard action, reduced motion keeps the fades, every control has a name, 40px targets, no state per frame.

## Done

Before reporting any change: `pnpm check` passes, the page loads with no console errors and no `[a11y]` lines, the main path works by keyboard, `?theme=dark` and `?motion=reduce` look right, and the README's States and Decision are current. Say what you could not verify.
