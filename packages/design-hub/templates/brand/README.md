---
title: {{title}}
summary: One line on what this piece is for.
context: board
track: {{track}}
status: exploring
kind: {{kind}}
feature: {{feature}}
created: {{created}}
---

# {{title}}

## Problem

What the piece has to do, where it appears, and for whom. Write this before any artboard.

## Question

The one decision this board exists to make.

## Formats

| Artboard | Format | Where it runs |
| --- | --- | --- |
| | | |

Formats come from `@kit/Artboard` (`post-square`, `post-portrait`, `story`, `link-preview`, `banner`, `slide`, `a4`, `letter`). Each artboard is drawn at its real pixel size; a story keeps type and logos out of its top and bottom 250px.

## States

Every state the board holds, one row each: each fixture set, each layout and each tone a dial reaches. `miles-port` and the export read this table.

| State | How to reach it |
| --- | --- |
| | |

## Fixtures

`fixtures.json` holds `real` (the copy and images this piece runs with) and `missing` (no image, no subhead). `@kit/fixtures` derives `longest`, `empty` and `max`. Say where `real` came from.

## Export

`pnpm export {{slug}}` writes PNGs for posts and a PDF for slides and print into `exports/{{slug}}/`. Name the dial state that ships in the Decision, and export with it (`--dials`).

## Decision

Empty until picked. What was chosen, its values, and what was rejected and why.
