# Porting into WordPress

WordPress is the CMS, headless: the site's pages are the front end in `website.frontend` (Astro or Next), which reads WordPress over its REST API. Read `astro.md` or `next.md` for the page side; this file covers the content model and how content gets in. Read the target's theme or plugin code, its registered post types and its field plugin (ACF or another) first; where they decide something, they win.

## Where each piece goes

| Prototype | WordPress |
| --- | --- |
| `fixtures.json` `real` | Posts or pages when the content is the site's articles or pages; a custom post type (`register_post_type` with `show_in_rest: true`) when it is anything else (case studies, team, events). |
| A fixture key | A core field when one fits (`title`, `excerpt`, `date`, the featured image); a custom field otherwise, exposed in REST (ACF with "Show in REST API" on puts it under `acf`). |
| A category or tag key | A taxonomy (`register_taxonomy` with `show_in_rest: true`), never a free-text field. |
| A page made of sections | The target's convention: ACF flexible content, or Gutenberg blocks. Follow what the site already uses; never introduce the other one for one feature. |
| A hostile set | Field rules (required, character limits in the field's instructions), and the front end's handling of each case. The sets stay test fixtures, never site content. |

## Content model rules

- **Fields over HTML.** Content the design styles per part (a title, a date, a quote) is a field, so the front end owns the markup. Body copy stays `content`, rendered from `content.rendered` with the core block styles the front end already ships.
- **Add, never rename.** A field or post type rename orphans existing content. List it in the report for the user.
- Field groups live in code when the target keeps them in code (ACF JSON or PHP); never only in the database of one environment.

## Content in

The `real` items go in as drafts (`status: draft`) through WP-CLI, the REST API with an application password, or the admin. Never publish, never on production without the user's word.

## Front end reads

`GET /wp-json/wp/v2/<rest base>?_embed=1` returns the items with their featured media and terms embedded; `_fields=` trims a response to what the page renders. `title.rendered` and `excerpt.rendered` are HTML: strip or render them as the design says. Each README state maps to a response: empty is `[]`, missing is an item with empty fields or no `_embedded` media.

## Report

Under Mapped: each post type, taxonomy and field with its REST path. Under Not mapped: fixture keys with no field, and anything that would need a plugin the site does not have.
