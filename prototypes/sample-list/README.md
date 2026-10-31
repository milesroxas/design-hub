---
title: Sample list
summary: A list page with every fixture set on a dial, as the reference for the conventions.
context: app
status: exploring
kind: sprint
feature: sample
created: 2026-10-30
---

# Sample list

The one prototype that ships with the template. It is the reference Claude reads for the conventions, because a working example teaches them more reliably than prose: a feature folder, the README frontmatter the index reads, hostile fixtures on a dial, motion on `DialVars`, scope toasts, and a walkthrough at `/guide/sample/`. Delete it when the project has a feature of its own.

## Problem

A list is where edge cases hide: the name nobody expected, the empty team, the fortieth row, the item with no image. Reviewers see one pretty state and sign off on it.

## Question

Does the row hold up under every fixture set without the layout moving?

## Flows

| Flow | Starts from | Edge cases |
| --- | --- | --- |
| Read the list | `#/items` | longest name, no items, 40 items, no cover |
| Open an item | a row | the row is the link; Open is a scope toast |
| Add an item | New item | a scope toast; adding is not this prototype's question |

## States

Every state the prototype holds, one row each. The fidelity guard and `miles-port` read this table.

| State | How to reach it |
| --- | --- |
| Real list | Controls → Review → Fixtures → **real** |
| Longest names | Controls → Review → Fixtures → **longest** |
| Empty | Controls → Review → Fixtures → **empty** |
| Maximum count | Controls → Review → Fixtures → **max** |
| Missing media | Controls → Review → Fixtures → **missing** |
| Compact rows | Controls → Review → Density → **compact** |
| Dark | Controls → View → Theme → **dark** |

## Fixtures

`fixtures.json` holds `real` (eight items written from the comp; a Webflow project would pull them with one `collections_items_list_items` call) and `missing` (hand-written: no cover, no owner, no name). `@kit/fixtures` derives `longest`, `empty` and `max`; the design's maximum is 40 rows.

## Decision

Empty until picked. What was chosen, its values, and what was rejected and why. Then delete the folder.
