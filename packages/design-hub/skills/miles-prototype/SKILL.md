---
name: miles-prototype
description: "The rules for writing or changing any prototype code under prototypes/: low gravity, the fidelity ceiling, DialKit patterns, the scope toast, and the binding motion, accessibility and performance rules in references/. Load before the first line of prototype code in a session and again whenever a change touches kit/. Triggers on: prototype, prototyping, build the state, add a dial, DialKit, variant, fixture set, fidelity, too much code, kit, AppShell, SiteShell, Space, motion, animation, accessibility, performance."
---

# Prototype

A prototype here answers one written question with the least code that can answer it, in the project's real materials, with every state reachable from a dial. This skill holds the ceiling. `AGENTS.md` holds the stack and the layout; `prototypes/sample-list/` is the worked example and wins over any description of it here.

## Before the first line

1. Read the feature's `README.md`. If it has no Problem, Question and States, stop and write them with `miles-new-feature`. Code written before the question is code that answers a different question.
2. Decide where it stands: `AppShell` or `SiteShell` when the question is about the feature in context, `Space` when it is about one thing alone. Never both in one prototype.
3. Read `prototypes/sample-list/index.tsx` once per session. It is the reference for every pattern below.

## The fidelity ceiling

The guard (the `design-hub hook fidelity-guard` hook in `.claude/settings.json`) names these rules when a write goes over them; the headings are the names it uses. It speaks at two levels, with thresholds in `.design-hub/checks.json`:

- **A warning** arrives as context. Fix it, or say in one sentence why this write earns it.
- **A block** stops the turn until you answer it: an import that leaves the feature folder, or a Jev judgment over `fidelity.blockAt`. Undo the write, or tell the user why it must stay and wait for their answer. Never write around a block.

A finding with a log id (`log 3f9a…`) was Jev's. When the user says it was wrong, run `pnpm calibrate --no <id>`; when right, `--yes <id>`. Why: the thresholds move only with labels, so an unlabelled false alarm keeps firing.

### Low gravity

A prototype imports only `@kit/*` and files in its own folder. Never another prototype, never the hub's own code in `node_modules/@milesroxas/design-hub`. Why: the moment two prototypes share a file, deleting one breaks the other, and a prototype that cannot be deleted is production.

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
- Never a control inside the product chrome. A sidebar item or a sheet that switches fixtures is a testing aid wearing the product's clothes.

## Motion, accessibility, performance

The references beside this skill (`references/motion.md`, `references/accessibility.md`, `references/performance.md`) are binding; the short rules: transform and opacity only, ease-out in and ease-in out, nothing over 300ms, nothing animates on a keyboard action, reduced motion keeps the fades, every control has a name, 40px targets, no state per frame.

## Done

Before reporting any change: `pnpm check` passes, the page loads with no console errors and no `[a11y]` lines, the main path works by keyboard, `?theme=dark` and `?motion=reduce` look right, and the README's States and Decision are current. Say what you could not verify.
