# Porting into Next.js (App Router)

Read the target first; where it already decides something below, it wins. This file decides only what the target leaves open.

## Where each piece goes

| Prototype | Next.js |
| --- | --- |
| `kit/tokens.css` values | The target's tokens. CSS variables in `app/globals.css`, or `@theme` in Tailwind v4, under the target's names. Never a second token file. |
| A hash route (`#/items/42`) | A segment: `app/items/[id]/page.tsx`. A hash route was the prototype's shortcut, never the product's URL. |
| `fixtures.json` `real` | The target's data layer: a fetch in a Server Component, a CMS query, or a route handler. The fixture shape is the props contract the data must meet. |
| The hostile sets | Test fixtures beside the component: `<Component>.fixtures.ts`, used by its tests and stories. |
| A dial's committed default | A constant or a prop default. Never `useState` for a value the README decided. |
| `useStoredState` | Only if the README says the preference persists in the product; then the target's own persistence. Otherwise drop it. |
| `notInPrototype()` and scope toasts | Deleted. Each one is a feature the port report lists as not built. |

## Server or client

```
Does the component hold state, handle an event, or animate on interaction?
├── No  → Server Component (the default). It renders the README's static states from props.
└── Yes → the smallest leaf that needs it gets 'use client'; its parent stays on the server.
```

Why the smallest leaf: `'use client'` pulls everything the file imports into the browser bundle, and the prototype's fidelity shortcuts make that bundle large.

## States

- **Empty and missing** come from the data: the Server Component branches on an empty array or a null field. The README's copy for each state is the copy that ships.
- **Loading** is `loading.tsx` or a `<Suspense>` boundary with a skeleton the same size as the loaded row, so the layout never moves. A prototype that had no loading state gets one here, and the report says so.
- **Errors** are `error.tsx` at the segment. The prototype never had error handling (it had no backend), so each error state is new and listed in the report.
- **Motion** keeps the README's committed durations and curves as CSS. `motion` only where the prototype used it, imported in the client leaf.

## Tests and stories

Each README state becomes one test or one story with its fixture set: `real`, `longest`, `empty`, `max`, `missing`, plus the feature's own. Use the target's runner (Vitest, Jest, Playwright) and Storybook if it has one. Never add a runner the target does not have; list the gap in the report.
