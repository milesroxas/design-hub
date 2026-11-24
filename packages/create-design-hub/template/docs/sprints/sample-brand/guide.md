---
type: guide
feature: sample-brand
date: 2026-11-24
audience: Anyone learning the template
---

# Sample social post: a walkthrough

The brand track's reference: one announcement post in three formats, at real size, with every fixture set, layout and tone on a dial. Nothing here is a real campaign. It exists so a reviewer can see what collateral from this hub looks like, and so Claude has a working example of the conventions to read.

## Before you start

1. **Open the prototype** at `/sample-social/`.
2. **Find Controls.** The dark round button at the top of the page opens a panel that belongs to the board, not the post. Review holds the fixture set, the post, the layout and the tone; Board holds the zoom and the safe-area guides; View holds theme and motion. The panel's last row, **Open the walkthrough**, brings this page back in a new tab.
3. **Nothing persists.** Reload and the board is back on the first real post.

## 1. Read the board

**Do:** open the prototype. The same post sits in three artboards: square, portrait and story, each labelled with its format and size.

- Each artboard is drawn at its real size (1080 wide) and scaled to fit the screen. Type sizes in the code are the sizes that ship.
- The story's top and bottom 250px are shaded: the platform's own buttons cover them, so type and the mark stay out.

## 2. Break it

Controls → Review → Fixtures → **longest**

The headline and subhead doubled. The headline wraps; the square, with the least room, is where it breaks first.

Controls → Review → Fixtures → **missing**, then Post → **1** and **2**

A post with no image or kicker, and one with no subhead or call to action. The photo shows a dashed outline where the image would be.

Controls → Review → Fixtures → **empty**

No post: each artboard says so.

## 3. Change the template

Controls → Review → Layout → **type**, Tone → **light**

The copy alone, larger, on the page colour. Every combination is a state the export can write.

## 4. Export it

Ask Claude to export the post, or run `pnpm export sample-social`. It writes one PNG per artboard into `exports/sample-social/`, at exactly 1080 wide, from the dial state you name.

## Every state, and how to reach it

| State | How to reach it |
| --- | --- |
| Real post | Controls → Review → Fixtures → **real** |
| Longest copy | Controls → Review → Fixtures → **longest** |
| No post | Controls → Review → Fixtures → **empty** |
| Missing content | Controls → Review → Fixtures → **missing** |
| Another post | Controls → Review → Post → **2** or **3** |
| Type only | Controls → Review → Layout → **type** |
| Light tone | Controls → Review → Tone → **light** |

## What we need from you

Nothing. Delete `prototypes/sample-social/` and `docs/sprints/sample-brand/` once the project has a brand feature of its own.
