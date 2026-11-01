---
type: guide
feature: sample
date: 2026-10-30
audience: Anyone learning the template
---

# Sample list: a walkthrough

The one prototype that ships with the template: a list page inside the product shell, with every fixture set on a dial. Nothing here is a real product. It exists so a reviewer can see what a prototype from this hub looks like, and so Claude has a working example of the conventions to read.

## Before you start

1. **Open the prototype** at `/sample-list/`.
2. **Find Controls.** The dark round button at the top of the page opens a panel that belongs to the prototype, not the product. Review holds the fixture set and the row density; Motion holds the two numbers the entrance uses; View holds theme, reduced motion and speed. The panel's last row, **Open the walkthrough**, brings this page back in a new tab.
3. **Nothing persists.** Reload and the list is back on the real set.

## 1. Read the list

**Do:** open the prototype. Eight items arrive one after another.

- The row is the link. Its name and owner sit beside a cover; status and date are pinned right so they line up down the list.
- The foot counts the items (the Ledger Foot Rule).

**Try:** click a row. A dark toast says the item would open here. That is the prototype speaking, not the product: anything a control would do that the prototype does not build says so in that voice (the Scope Toast Rule).

## 2. Break it

Controls → Review → Fixtures → **longest**

The first item carries, in every text field, the longest real value doubled. The name wraps; the status and the date stay where they were.

Controls → Review → Fixtures → **empty**

The empty state replaces the list. The one action stays in the page head.

Controls → Review → Fixtures → **max**

Forty rows, the design's maximum. Scroll: the entrance stagger is capped at the eighth row, so the fortieth does not wait a second to appear.

Controls → Review → Fixtures → **missing**

An item with no cover, one with no owner, one with no name. Each says what is missing where the value would be.

## 3. Tune the entrance

Controls → Motion → **Rise** and **Stagger**

The numbers the entrance uses, live. Watch at 0.25× (Controls → View → Speed) to see the curve. When a pair feels right, copy it into the README's Decision.

## Every state, and how to reach it

| State | How to reach it |
| --- | --- |
| Real list | Controls → Review → Fixtures → **real** |
| Longest names | Controls → Review → Fixtures → **longest** |
| Empty | Controls → Review → Fixtures → **empty** |
| Maximum count | Controls → Review → Fixtures → **max** |
| Missing media | Controls → Review → Fixtures → **missing** |
| Compact rows | Controls → Review → Density → **compact** |
| Dark | Controls → View → Theme → **dark** |

## What the prototype does not do

Opening an item and adding one are scope toasts. The sidebar's other pages are the shell's stubs.

## What we need from you

Nothing. Delete `prototypes/sample-list/` and `docs/sprints/sample/` once the project has a feature of its own.
