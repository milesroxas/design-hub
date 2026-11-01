# Porting into Astro

Read the target first; where it already decides something below, it wins. This file decides only what the target leaves open.

## Where each piece goes

| Prototype | Astro |
| --- | --- |
| `kit/tokens.css` values | The target's tokens: CSS variables in its global stylesheet, or its Tailwind theme, under the target's names. Never a second token file. |
| A hash route (`#/items/42`) | A page: `src/pages/items/[id].astro` with `getStaticPaths`, or an on-demand route if the target renders on request. |
| `fixtures.json` `real` | A content collection (`src/content.config.ts`) when the content is the site's own; the CMS loader when it comes from a CMS. The fixture shape is the collection's schema. |
| The hostile sets | Test fixtures for the component tests, plus one collection entry per hostile case in a draft or test collection that never builds into production. |
| A dial's committed default | A prop default or a constant. |
| `notInPrototype()` and scope toasts | Deleted. Each one is a feature the port report lists as not built. |

## Astro component or island

```
Does the state change after the page loads (a click, a toggle, an animation on interaction)?
├── No  → an .astro component. Every static state (empty, missing, longest) renders on the server.
└── Yes → an island in the target's UI framework, hydrated with the lightest directive that works:
          client:visible below the fold, client:idle above it, client:load only for what the first interaction needs.
```

Why the lightest directive: each island ships its framework and code to the browser, and the prototype hydrated everything because it was one React app.

## States

- **Empty and missing** branch in the `.astro` template on the collection's data; the README's copy for each state ships as written.
- **Motion** keeps the README's committed durations and curves as CSS. Page-to-page motion is the target's View Transitions setup when it has one; never add it for one feature.
- **Errors and loading** exist only for on-demand routes and islands that fetch. Each one is new and listed in the report.

## Tests

Each README state becomes one test with its fixture set, in the target's runner (Vitest with the Astro container API for `.astro` components, the framework's own for islands). Never add a runner the target does not have; list the gap in the report.
