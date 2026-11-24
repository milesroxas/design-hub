---
title: Sample page
summary: A journal index inside the website shell, with every fixture set on a dial, as the reference for a website's conventions.
context: app
track: website
status: exploring
kind: sprint
feature: sample-site
created: 2026-11-24
---

# Sample page

The website track's reference prototype. It shows what a website prototype from this hub looks like: a page inside `SiteShell`, sections that read their content the way the CMS hands it over, hostile fixtures on a dial, and a walkthrough at `/guide/sample-site/`. Delete it when the project has a website feature of its own.

## Problem

A CMS page is designed with six tidy posts and launched with a hundred messy ones. Editors skip images, write long titles and publish drafts without excerpts, and the grid breaks on the first week of real content.

## Question

Does the journal grid hold up under every fixture set, in two and three columns, without a card changing height in a way that breaks the row?

## Flows

| Flow | Starts from | Edge cases |
| --- | --- | --- |
| Read the journal | `#/journal` | longest title, no posts, 40 posts, no image, no excerpt |
| Open a post | a card | the card is the link; Open is a scope toast |
| Filter by category | a category chip | a scope toast; filtering is not this prototype's question |

## States

Every state the prototype holds, one row each. The fidelity guard and `miles-port` read this table.

| State | How to reach it |
| --- | --- |
| Real posts | Controls → Review → Fixtures → **real** |
| Longest titles | Controls → Review → Fixtures → **longest** |
| Empty | Controls → Review → Fixtures → **empty** |
| Maximum count | Controls → Review → Fixtures → **max** |
| Missing content | Controls → Review → Fixtures → **missing** |
| Two columns | Controls → Review → Columns → **2** |
| Dark | Controls → View → Theme → **dark** |

## Fixtures

`fixtures.json` holds `real` (six posts written from the comp; a CMS project pulls them from its posts collection with the fields `title`, `excerpt`, `category`, `published` and `image`) and `missing` (hand-written: no image, no excerpt or category, no title or date). `@kit/fixtures` derives `longest`, `empty` and `max`; the design's maximum is 40 posts on one page.

## Decision

Empty until picked. What was chosen, its values, and what was rejected and why. Then delete the folder.
