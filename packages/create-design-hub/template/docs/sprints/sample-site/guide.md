---
type: guide
feature: sample-site
date: 2026-11-24
audience: Anyone learning the template
---

# Sample page: a walkthrough

The website track's reference: a journal index inside the website shell, with every fixture set on a dial. Nothing here is a real site. It exists so a reviewer can see what a website prototype from this hub looks like, and so Claude has a working example of the conventions to read.

## Before you start

1. **Open the prototype** at `/sample-page/`.
2. **Find Controls.** The dark round button at the top of the page opens a panel that belongs to the prototype, not the site. Review holds the fixture set and the column count; Motion holds the two numbers the entrance uses; View holds theme, reduced motion and speed. The panel's last row, **Open the walkthrough**, brings this page back in a new tab.
3. **Nothing persists.** Reload and the grid is back on the real set.

## 1. Read the journal

**Do:** open the prototype. Six posts arrive one after another, under the site's header and above its footer.

- The card is the link. Category and date sit above the title; the excerpt stops at three lines.
- The header and footer come from `kit/shell.ts`, written once for every page of the site.

**Try:** click a card. A dark toast says the post would open here. That is the prototype speaking, not the site.

## 2. Break it

Controls → Review → Fixtures → **longest**

The first post carries the longest real title and excerpt doubled. The title wraps; the excerpt still stops at three lines, so the row stays level.

Controls → Review → Fixtures → **empty**

No posts: the grid gives way to one line and a Subscribe action.

Controls → Review → Fixtures → **max**

Forty posts, the design's maximum for one page. The entrance stagger is capped at the eighth card.

Controls → Review → Fixtures → **missing**

A post with no image, one with no excerpt or category, one with no title or date. Each says what is missing where the value would be.

## 3. Change the grid

Controls → Review → Columns → **2**

Two cards per row on a wide screen. Phones always show one.

## Every state, and how to reach it

| State | How to reach it |
| --- | --- |
| Real posts | Controls → Review → Fixtures → **real** |
| Longest titles | Controls → Review → Fixtures → **longest** |
| Empty | Controls → Review → Fixtures → **empty** |
| Maximum count | Controls → Review → Fixtures → **max** |
| Missing content | Controls → Review → Fixtures → **missing** |
| Two columns | Controls → Review → Columns → **2** |
| Dark | Controls → View → Theme → **dark** |

## What the prototype does not do

Opening a post and subscribing are scope toasts. The header's other links are the shell's stubs.

## What we need from you

Nothing. Delete `prototypes/sample-page/` and `docs/sprints/sample-site/` once the project has a website feature of its own.
