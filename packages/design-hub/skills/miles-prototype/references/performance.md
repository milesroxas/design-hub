# Performance

A prototype that stutters gets judged on the stutter. The floor below keeps the question about the design.

## Already handled by the shell

- Each prototype is its own lazy chunk; the index loads none of them.
- Dev-only tools (axe, and Lapse when a project installs it) never ship in a build and load only when used.
- `motion` and DialKit load only in prototypes that import them.

## Rendering

- Animate `transform` and `opacity`; they skip layout and paint. See `motion.md`.
- CSS animations and transitions run off the main thread; prefer them to JS-driven motion.
- No React state per animation frame or per slider tick. Use `DialVars` (CSS variables), motion values, or a ref.
- Setting a CSS variable on a parent restyles every child. For per-frame values on one element, set `transform` on that element.
- Read layout, then write it: never interleave `getBoundingClientRect()` or `offsetWidth` with style writes in a loop.
- `will-change` only on elements that are about to move, and remove it after.
- Keep `backdrop-filter` and `filter: blur()` to small areas; both are expensive, worst in Safari.

## React

- State lives where it is used. Lift it only as far as needed.
- A module store read through `useSyncExternalStore` with a narrow selector beats context for values that change often; context re-renders every consumer.
- `useDeferredValue` for filtering or searching over big lists.
- Don't add `useMemo` and `useCallback` by reflex; add them when a profile shows the cost.
- Stable `key`s from data, never array indexes for lists that reorder.

## Content

- More than ~200 rows: `content-visibility: auto` with `contain-intrinsic-size`, or window the list.
- Images and media carry `width` and `height` (no layout shift), `loading="lazy"` below the fold, `decoding="async"`.
- Fonts come from tokens (`--font`, `--font-voice`). Add a web font only in `tokens.css`, once, as the design names it.
- Data is local: seed files in the prototype folder. Simulate latency with timers when latency is part of the question.

## Dependencies

- Each new dependency needs the user's OK (see `AGENTS.md`). Say what it costs gzipped and why CSS or the kit can't do it.
- Nothing heavy goes in `kit/`: every prototype that imports the kit pays for it.

## How to check

1. Chrome Performance panel with 4x CPU throttling on the main interaction: no long tasks over 50ms during an animation.
2. With `@aiforui/lapse` installed, `?lapse` and record a take of the interaction: its report lists dropped frames, layout shifts and which properties animated on layout or paint.
3. React DevTools Profiler, "Highlight updates": a slider or a tick should light up only what it changes.
