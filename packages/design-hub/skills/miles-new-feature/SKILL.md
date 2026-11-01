---
name: miles-new-feature
description: "Start a feature or a prototype: the folder, the README with its question and states, docs/sprints/<feature>/ with the design doc and the walkthrough. Load when the user names a new feature, page, flow or exploration, or asks for a new prototype. Triggers on: new feature, new prototype, start a prototype, scaffold, pnpm new, sprint, alternate, exploration, design doc, walkthrough, guide."
---

# New feature

One feature is one slug used in two places: `docs/sprints/<slug>/` and the `feature:` line of every prototype that belongs to it. This skill makes both, in an order that puts the question before the code.

## Procedure

1. **Name the slug.** Kebab-case, the feature's name in the product's words (`bulk-export`, not `feature-2`). It never changes once a prototype carries it, because the index, the walkthrough route and the port report all key on it.
2. **Which kind?** Walk this; the first match wins.
   - The feature's main prototype, the one its walkthrough opens → `--sprint`. One per feature; `pnpm new` refuses a second.
   - Another full take on the same flow, to compare against the primary → `--alternate`. Refused until the primary exists.
   - A side question about one part (a menu's motion, a loading state) → exploration, the default.
3. **Where does it stand?** `--app` when the question is about the feature in context (the shell from `DESIGN.md`, Shell); nothing when it is one thing alone in the Space.
4. **Scaffold.** From the project root:
   ```bash
   pnpm new <slug> --app --sprint --feature <feature> --title "Title"
   pnpm guide <feature>              # once per feature, for the sprint
   ```
   The scaffolder fills the frontmatter and refuses a bad slug, a second sprint, or an alternate without a primary. Never create the folder by hand: a folder without the README's frontmatter is invisible to the index.
5. **Write the README before any code**, top to bottom:
   - **Problem.** What is wrong or unknown today, and for whom. Two sentences.
   - **Question.** The one decision the prototype exists to make. One sentence, a question mark. If there are two questions, there are two prototypes.
   - **Flows** (app) or **Directions** (space). A table: each flow with where it starts and its edge cases; each direction with its name and the axis it varies on.
   - **States.** Every state the prototype will hold and how to reach it. Start with the five fixture sets (`miles-get-hostile`); add the feature's own (selected, editing, a run in progress). The guard and `miles-port` read this table.
   - **Fixtures.** Where `real` comes from and the design's maximum count.
   - **Decision.** Empty.
6. **Design doc.** `docs/sprints/<slug>/design-doc.md` holds what the prototype tests: the context, the proposal, the open decisions. Write it when the feature has more than one flow; a single exploration needs only its README.
7. **Then build**, under `miles-prototype`.

## The walkthrough

`docs/sprints/<feature>/guide.md` is for the reviewer who has the password and not the repo. It is written from the States table: one section per workflow, then "Every state, and how to reach it" copied from the README, then what the prototype does not do, then what the review must settle. Screenshots go in `assets/guide/` beside it, named in order (`01-list.jpg`); a missing file fails the build. Write it before the share link goes out (`miles-deploy` checks it exists for a sprint).

## When done means decided

When the user picks: the Decision section gets what was chosen, its values, what was rejected and why; then the folder is deleted, or `status: archived` when the user wants it kept. A rule the decision made lands in `DESIGN.md` as a named rule the same day.
