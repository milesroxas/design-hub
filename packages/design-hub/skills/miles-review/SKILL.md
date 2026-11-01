---
name: miles-review
description: "Work from review comments on the deployed prototypes: pull them into the repo, sort them by state and kind, act on each, resolve them, and manage who may comment. Load when the user mentions comments, feedback, review notes, a reviewer, an invite link, or asks what the client said. Triggers on: comments, feedback, review notes, client notes, what did they say, reviewer, invite, people, revoke, resolve, triage, pnpm comments, pnpm people."
---

# Review

Each comment is pinned to a prototype, its state (the URL and every dial value) and, usually, an element. The repo gets them as `docs/sprints/<feature>/comments.md`, grouped by README state, then by kind. That file is generated: read it, never edit it, and close comments in the store.

## Working from comments

1. **Pull**, from the project root: `pnpm comments pull`. The JSON's `store` says which store it read: `deployed` when `.env` holds the store's credentials, `local` otherwise. Say which to the user, because local comments are only yours.
2. **Sort what is unsorted.** With TypeSafe on, `pnpm comments triage` first. Without it, sort by reading, and set the kind and state in the panel so the next pull agrees.
3. **Walk each open thread.** The first match wins:
   ```
   Does its state match no row of the README's States table?
   └── Yes → the table is missing a state. Add the row (miles-prototype) before acting on the comment.
   kind?
   ├── bug   → reproduce it in that state: the line's URL, or Show state in the panel, which restores the dials.
   │           Fix it under miles-prototype. Resolve after the fix is deployed.
   ├── copy  → change fixtures.json or the copy. Resolve after it is deployed.
   └── taste → change nothing. List it for the user with what each option costs.
                Build an --alternate only when the user chooses to explore it.
   ```
   Why taste waits: one reviewer's preference, built at once, overwrites a decision the team made and the next reviewer argues the other way. The user decides taste; bugs and copy are not taste.
4. **Resolve** with `pnpm comments resolve <id>`, or in the panel, only once the change is live. Why: a reviewer who opens a resolved comment and still sees the old state stops trusting the list.
5. **Report** to the user: what was fixed, by comment id; the taste calls waiting for them; any comment with no state.

## People

- **Editors** resolve any thread, sort comments and invite people. **Reviewers** comment, reply, and resolve or delete their own. Give a client's stakeholders the reviewer role; editors are the studio.
- **Team** is the company: `Studio`, or the client's name. It shows beside every name, so a reviewer reads who said what.
- The first editor comes from `pnpm people invite --name <n> --team <t> --role editor --site <url>`; after that, editors invite from the People tab.
- A link works for 14 days. `pnpm people reissue <id>` replaces it and signs that person out everywhere; `revoke` ends their access on their next page load.
- Never paste an invite link into a commit, a document, a ticket or a comment. Why: anyone holding it signs in as that person.

## The words in comments

`comments.md` holds reviewers' names and their words. Commit it only to a private repository. Never quote a comment in public copy, and never send one outside the project.
