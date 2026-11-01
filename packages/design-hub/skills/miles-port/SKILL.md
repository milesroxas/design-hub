---
name: miles-port
description: "Turn an approved prototype into production: in Webflow (variables, CMS, conditional visibility, interactions) or in another codebase (its tokens, components, tests or stories). The prototype is a spec, never code to paste. Load when the user asks to build, ship, port, hand off or implement an approved prototype. Triggers on: port, hand off, handoff, implement, build it for real, into Webflow, into the codebase, production, engineers, state map, port report."
---

# Port

An approved prototype is a spec. It is never pasted: pasted prototype code carries the kit, DialKit and the fidelity-ceiling shortcuts into production, which is the rebuild this hub exists to prevent. The port reads the feature folder, writes a state map, builds in the target's own materials, and writes a report the user reads before anything goes live.

## Input: the feature folder is complete, or the port does not start

Read `prototypes/<slug>/`, never the running prototype. Refuse to start, naming what is missing, unless all five hold:

1. The README's `## States` table lists every state (a dial option, a route, a click) the prototype holds.
2. Final dial values are committed as defaults in the code (`useDials` and `DialVars` configs) and in the README's Decision. A live dial value never written down does not exist to the port.
3. `fixtures.json` holds `real` and `missing`, and the component's `max` is in the code, so `@kit/fixtures` can derive the rest.
4. The CSS references tokens by name. A raw value is allowed only where the README names it.
5. No open `bug` comment on the feature. Run `pnpm comments pull` and read `docs/sprints/<feature>/comments.md`; an open bug is fixed first (`miles-review`), or the user says in so many words that it ships as is, and the report lists it. Why: a bug a reviewer already found and nobody fixed is the cheapest bug the port can stop.

## Branch: where is it going?

Ask one question first: Webflow, or a codebase (the path to its repo)? Then walk one branch. Both follow three rules:

- **The target's conventions win.** Where a token or component has no match in the target, list it in the port report. Never invent one in the target.
- **Dials become fixed values.** DialKit never ships. Each dial's committed default is the value; the README's Decision is the source.
- **The state map comes before any build.** One row per README state: the state, the mechanism that carries it in the target, and where. A state with no mechanism is a bug found before build instead of after launch; it goes in the report as unmapped and the user decides.

### Webflow

1. **Tools.** Call `webflow_guide_tool` once. Check whether the Designer tools are connected (`designer_tool`, `data_variable_tool`, `data_style_tool`, `data_element_tool`). If they are, layout, classes and variables are built over MCP; if not, step 4 writes the build spec for a person in the Designer.
2. **Tokens → variables.** Each token the feature uses becomes a Webflow variable with the same name (`bg-primary`, `radius-md`). Existing variables with the same meaning are reused, named in the report.
3. **States → mechanisms.** Walk each README state:
   - empty, missing → conditional visibility on a CMS field
   - a visual variant (compact, selected) → a combo class
   - motion, open and close → an interaction, with the committed durations and curves
   - anything else → unmapped, in the report
4. **CMS.** Collection fields from the shape of `real` (one field per rendered key, typed from the value). Then the `real` items as drafts through the CMS tool's create-item action. Never the `_live` variants, never a site publish: publishing a client site is the user's call. Hostile sets stay in the prototype; draft test items in a client CMS get published by accident.
5. **Layout, classes, interactions.** Over MCP when the Designer tools are connected, otherwise from the build spec in the report, by a person.

### Codebase

1. **Read the target first.** Framework, styling, component library, tokens, and its `AGENTS.md` or `CLAUDE.md`. Its rules bind the port.
2. **Map tokens and components by name** onto the target's. Unmatched ones go in the report, never into the target as new ones.
3. **Fixtures travel.** Each fixture set becomes a test fixture or a story in the target's own convention, and each README state a test or a story. Why: the hostile sets are where QA catches the edge cases, so they go with the feature.
4. **A new branch**, never the target's main. Name it after the feature slug.

Read the reference for the target's stack before step 2, when there is one: `references/next.md` for Next.js, `references/astro.md` for Astro. The target's own `AGENTS.md` still wins over both. For any other stack, the target's docs are the reference.

## Output: the port report

`docs/sprints/<feature>/port.md`, written before the user is told the port is done:

- **State map.** The table from the branch step, every README state, with its mechanism or `unmapped`.
- **Mapped.** Tokens and components with their target names.
- **Not mapped.** Tokens with no target, states with no mechanism, and what the user has to decide for each.
- **Webflow build spec** (Webflow branch): the structure, classes, variables and interactions a person builds in the Designer, in build order.
- **Where it is.** The branch, the collection, the draft items.

The report is the review surface. Nothing goes live until the user has read it.
