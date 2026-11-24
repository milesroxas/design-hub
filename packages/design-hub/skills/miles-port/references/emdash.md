# Porting into EmDash

EmDash is a CMS that runs inside an Astro site, deployed on Cloudflare (Workers, with D1 for content and R2 for media). The front end is that Astro site, so read `astro.md` for components, islands, states and tests; this file covers EmDash's content model and how pages read it. Read the target's `astro.config.mjs`, `src/live.config.ts` and its pages first; where they decide something, they win.

## Where each piece goes

| Prototype | EmDash |
| --- | --- |
| `fixtures.json` `real` | A collection. Collections live in the database, not in code: made in the admin's schema builder (`/_emdash/admin`) or with the CLI (`npx emdash schema list`, `schema get <collection>`, `schema add-field`). `pages` and `posts` exist from the start. |
| A fixture key | A field of the type its value needs: `string`, `text`, `url`, `number`, `integer`, `boolean`, `datetime`, `select`, `multiSelect`, `portableText` (formatted copy), `image`, `file`, `reference` (another collection's entry), `json`, `slug`, `repeater` (a repeated group), `blocks`. |
| A page made of sections | A `blocks` or `repeater` field, one front-end component per block type. |
| A hostile set | Field validation and the page's handling of each case. The sets stay test fixtures, never site content. |

## Content model rules

- **Add, never rename.** Each collection is a real SQL table; renaming or retyping a field of a live collection risks its content. List any rename in the report for the user.
- After a schema change, `npx emdash types` regenerates the types the pages read.

## Content in

The `real` items go in as drafts, through the site's MCP server or the `npx emdash content` commands (`npx emdash content --help` lists them on the installed version), against the local dev site first (`--url http://localhost:4321`). Never publish, and never write to the deployed site or run `npm run deploy` without the user's word.

## Pages read

Pages query at request time through Astro's live collections:

```astro
---
import { getEmDashCollection, getEmDashEntry } from 'emdash';
import { Image, PortableText } from 'emdash/ui';
const { entries: posts } = await getEmDashCollection('posts', { status: 'published', limit: 12 });
---
```

Fields are on `entry.data` (`post.data.title`); `entry.id` is the slug for links. Formatted copy renders with `<PortableText value={post.data.content} />`, images with `Image`. Each README state maps to a query: empty is `entries.length === 0`, missing is an entry with empty fields, and an unknown slug returns no `entry`.

## Real fixtures back out

`npx emdash content list <collection> --json > items.json`, then `pnpm fixtures-pull <slug> --from items.json --map key=path` (with no `--map` it lists the paths).

## Report

Under Mapped: each collection, block and field with its type. Under Not mapped: fixture keys with no field, and schema changes left for the user.
