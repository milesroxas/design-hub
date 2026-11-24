# Porting into Payload

Payload is the CMS; the site's pages are the front end in `website.frontend` (Astro or Next). Read `astro.md` or `next.md` for the page side; this file covers the content model and how content gets in. Read the target's `payload.config.ts` and `src/collections/` first; where they already decide something, they win.

## Where each piece goes

| Prototype | Payload |
| --- | --- |
| `fixtures.json` `real`, one item's keys | A collection's `fields` (`src/collections/<Name>.ts`, a `CollectionConfig`), when the content is a list (posts, people, products). A global when there is exactly one (a footer, site settings). |
| A page made of sections | A `blocks` field on the pages collection: one block config per prototype section, one front-end component per block, matched by `blockType`. |
| A fixture key's value | The field type by what it holds: `text` or `textarea` for strings, `richText` (Lexical) for formatted copy, `upload` for an image, `relationship` for another collection's item, `select` for a fixed set, `date`, `number`, `checkbox`, `array` for a repeated group. |
| A hostile set (`longest`, `missing`) | Field `validation`, `maxLength` and `required` decided from it: `missing` says which fields may be empty, `longest` what the front end must survive. The sets stay test fixtures, never CMS content. |
| The README's Decision | `admin.description` on each field that carries a rule an editor must follow (an image ratio, a character limit). |

## Content model rules

- **Add, never rename.** A new field is additive; renaming or retyping a live field loses content. List any rename the design wants in the report and leave it for the user.
- **Drafts first.** Collections an editor publishes get `versions: { drafts: true }` when the target uses drafts elsewhere. Never turn drafts on for one feature only.
- **Migrations.** On a SQL adapter (Postgres, SQLite), a schema change needs `payload migrate:create`; commit the migration with the code. Then `payload generate:types` so the front end reads typed data.

## Content in

The `real` items go in as drafts: `_status: 'draft'` through the target's seed script, the Local API (`payload.create({ collection, data, draft: true })`) or the admin. Never publish, and never seed a production database: content on a live site is the user's call.

## Front end reads

Astro reads with the REST API (`GET /api/<collection>?where[...]&depth=1`) or the Local API when the front end shares the Payload app (Next). `depth` decides how far relationships and uploads expand; set it to what the components render and no deeper. Each README state maps to a query result: empty is zero docs, missing is a doc with empty fields.

## Report

Under Mapped: each collection, block and field with its type. Under Not mapped: any fixture key with no field, and any field the design needs that would rename or retype a live one.
