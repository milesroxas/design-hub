---
name: miles-get-hostile
description: "Hostile fixtures for a prototype: fixtures.json with real data from the CMS or the comp, the missing set by hand, and the strategy and design answers for the edge cases (longest, empty, maximum count, missing media). Load when writing or changing fixtures.json, when a reviewer asks what happens with no items or a long name, or when a state needs data to reach it. Triggers on: fixtures, fixture set, hostile, edge case, worst content, longest, empty state, max count, missing image, real data, CMS pull, collection items, fixtures-pull, Webflow token."
---

# Get hostile

Pretty placeholder data hides the decision. Every prototype carries five sets, switched by a dial, and a reviewer signs off on all five or none. The cost per feature is one pull and a few hand-written entries.

## The sets

| Set | Holds | Who writes it |
| --- | --- | --- |
| `real` | 8 to 20 real items with only the fields the component renders | the CMS, or the comp |
| `longest` | the first item with each free-text field named in `text` at the longest real value, doubled | `@kit/fixtures` |
| `empty` | nothing | `@kit/fixtures` |
| `max` | the real items repeated to the design's maximum count | `@kit/fixtures` |
| `missing` | items with no image, no link, no owner, no name | you, by hand |

`fixtures.json` holds `real` and `missing`. `fixtureSets(data, { max, text })` fills the rest at runtime; a key written in the JSON by hand wins over the derived one, for the component whose edge no rule can know.

`text` lists the fields a reviewer reads as prose: a name, a title, a description. Never a date, a status, an id, a URL or a colour. Why: doubling those does not make a longer value, it makes a broken one (`Invalid Date`, a status the code does not know), and the review then argues about a bug the CMS can never produce.

## Where `real` comes from, cheapest first

1. **A Webflow project with `WEBFLOW_TOKEN` in `.env`.** Run `pnpm fixtures-pull <slug> --collection <id>` once with no `--map`: it lists the collection's fields. Then pull with one `--map key=field.path` per field the component renders (`--map cover=thumbnail.url`). It pages through any `--limit` and keeps every other key in `fixtures.json`. Why a script: it costs no tokens per item, so a pull of 200 items costs the same as 20.
2. **A Webflow project without a token.** One call to the Webflow MCP's CMS tool for the collection behind the design, `limit` 20 or fewer. Keep only the fields the component renders. Never a full-collection pull: every field of every item spends tokens on nothing the component shows.
3. **No CMS.** Write `real` from the content in the Paper comp, word for word. Eight items minimum, because a list of three never shows its rhythm.
4. **A different CMS.** One read of up to 20 items with the same field cut. Say which tool was used in the README's Fixtures section.

Strip anything that identifies a private person before writing it down: a phone number, a personal email, a home address. `pnpm preflight` stops on every email and phone number until each is replaced or confirmed as a business contact.

## The shape

There is no shared schema. The component's props type is the schema, and TypeScript checks the JSON against it:

```ts
const sets = fixtureSets(data satisfies { real: Item[]; missing: Item[] }, { max: 40, text: ['name', 'owner'] });
```

Keep `id` on every item: `max` suffixes it to keep keys unique.

## What each edge case means for the design

Decide these before the user sees the set, and write the answer in the README:

- **Longest.** The text wraps or truncates, and the choice is written down. A column that holds the longest value is the column's width; nothing else on the row moves. Why: the CMS will hold a longer title than anything in it today, and a layout that moves under it was never tested.
- **Empty.** One sentence that says the state and the next step, and the one action that starts it. Never a blank card, never a disabled button beside an empty table. Why: the first visit is the page's teaching moment.
- **Max.** The page at the design's maximum count, scrolled. Entrance stagger capped at eight so the fortieth row does not wait a second; over about 200 rows, `content-visibility: auto` or a window. Why: the maximum is where performance gets judged.
- **Missing.** Each absent field says what is absent where the value would be (`Untitled`, `No owner`, a dashed tile for a cover). Never a broken image, never a blank cell. Why: a blank reads as a bug, a word reads as a state.

## On the dial

```ts
const review = useDials('Review', {
  fixtures: { type: 'select', options: [...SET_NAMES], default: 'real' },
}, { hints: { fixtures: 'Which fixture set the list shows.' } });
const items = sets[review.fixtures as SetName];
```

Each set is a row in the README's States table (`Controls → Review → Fixtures → **longest**`), so the walkthrough and the port report can name it.
