---
title: Sample social post
summary: One announcement post in three formats, with every fixture set, layout and tone on a dial, as the reference for brand collateral.
context: board
track: brand
status: exploring
kind: sprint
feature: sample-brand
created: 2026-11-24
---

# Sample social post

The brand track's reference prototype. It shows what collateral from this hub looks like: one template drawn at real size in three formats, copy from fixtures, the brand's tokens, dials for layout and tone, and files written with `pnpm export sample-social`. Delete it when the project has a brand feature of its own.

## Problem

A post template is approved with one tidy headline and then filled by whoever posts next week: a long headline, no image, no call to action. The square looks right and the story crops the logo under the platform's own buttons.

## Question

Does one template hold every post the team will write, in square, portrait and story, without a format breaking?

## Formats

| Artboard | Format | Where it runs |
| --- | --- | --- |
| square | `post-square`, 1080 × 1080 | Instagram and LinkedIn feeds |
| portrait | `post-portrait`, 1080 × 1350 | Instagram feed |
| story | `story`, 1080 × 1920 | Instagram and LinkedIn stories; type stays out of the top and bottom 250px |

## States

Every state the board holds, one row each. `miles-port` and the export read this table.

| State | How to reach it |
| --- | --- |
| Real post | Controls → Review → Fixtures → **real** |
| Longest copy | Controls → Review → Fixtures → **longest** |
| No post | Controls → Review → Fixtures → **empty** |
| Missing content | Controls → Review → Fixtures → **missing** |
| Another post | Controls → Review → Post → **2** or **3** |
| Type only | Controls → Review → Layout → **type** |
| Light tone | Controls → Review → Tone → **light** |

## Fixtures

`fixtures.json` holds `real` (three announcements written from the comp) and `missing` (no image or kicker; no subhead or call to action). `@kit/fixtures` derives `longest`, `empty` and `max`.

## Export

`pnpm export sample-social` writes `exports/sample-social/sample-social-square.png`, `-portrait.png` and `-story.png` at 1080 wide. Another state: `pnpm export sample-social --dials '{"Review":{"layout":"type","tone":"light"}}'`.

## Decision

Empty until picked. What was chosen, its values, and what was rejected and why. Then delete the folder.
