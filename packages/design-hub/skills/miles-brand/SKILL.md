---
name: miles-brand
description: "Brand collateral as prototypes: social post templates, stories, link previews, banners, slides and print, drawn on artboards at real pixel size from the project's tokens and DESIGN.md, Brand, with copy and layout on dials, and written to PNG and PDF with pnpm export. Load when the work is the brand track, or when the user asks for a post, a story, a deck, a slide, a one-pager, a flyer, a banner, an export or a template. Triggers on: brand, collateral, social post, Instagram, LinkedIn, story, carousel, link preview, banner, slide, deck, presentation, one-pager, flyer, print, A4, letter, artboard, export, PNG, PDF, template."
---

# Brand collateral

A piece of collateral here is a template, not a picture: one component that holds every post the team will write, drawn at the size it ships, with its copy and layout on dials. Files come out of it with `pnpm export`, so the next post is a dial change, not a redraw.

## Before the first artboard

1. **Read `DESIGN.md`, Brand.** Logo, imagery, collateral type, formats and voice. Where it is empty, ask for the one answer you need, write it there, then build. Why: collateral repeats; a guess on the first post becomes the brand on the tenth.
2. **Read `prototypes/sample-social/`** when the project kept it. It is the worked example and wins over any description here.
3. **Scaffold** with `pnpm new <slug> --track brand --feature <feature>` (`--sprint` for the feature's primary). The README's Formats table lists each artboard, its format and where it runs, before any code.

## Drawing

- **Real pixels.** An artboard is its format's size (`post-square` is 1080 × 1080, `slide` 1920 × 1080, `a4` 794 × 1123). Write type, spacing and radii at that size: a feed headline is 64 to 104px, never the 32px a web page would use. The Board scales the view; the values never change. Why: export writes the values in the code, so a value tuned on a scaled preview ships at the wrong size.
- **Position inside the frame.** The artboard is `position: relative` with fixed size: lay out with an absolutely filled root (`position: absolute; inset: 0`) and flex or grid inside it. Nothing scrolls, nothing depends on the viewport.
- **Tokens only.** Colours, fonts and radii come from `kit/tokens.css`; a new brand colour is a token first, then used. The logo is `<Icon name={BRAND.glyph}>` or the file DESIGN.md names, never redrawn.
- **Safe areas.** A story keeps type, buttons and the logo out of its top and bottom 250px; the Board shades them (Controls → Board → Guides). Other formats keep a margin of at least 64px at 1080 wide.
- **One template, many formats.** Draw the content once as a component and place it in one `<Artboard>` per format, adjusting per format with `[data-format="story"] .x { … }` in CSS. Never a second copy of the markup per format.

## Still, and one look

Collateral is a file: a PNG or a PDF. Nothing in it moves and it has no dark mode, so a board has no View panel. Its viewing tools are the Board's own **Zoom** and **Guides**.

- **No motion.** No `transition`, `animation`, `@keyframes` or `motion/react` in a brand prototype, and no reduce-motion or speed control. Export turns motion off, so anything that moves on the board is not what ships. The guard warns on it.
- **No theme.** A board is held to the look it exports in: light, whatever theme the person looking has. Never style collateral with `.dark-mode`, `prefers-color-scheme`, `useDark` or `useAppearance`, and never mount `ViewTools`. A dark or inverse version is a `tone` dial on the piece, so it is a state a reviewer can see and an export can name.
- **A piece that moves is not collateral here.** An animated story, a logo sting or a transition between slides is a `Space` prototype (`pnpm new <slug> --feature <feature>`), where View has the motion tools and nothing is exported. Say so to the user instead of animating an artboard.
- **A slide deck is stills.** One artboard per slide, no builds or slide transitions.
- **Collateral beside a product or a site.** A mock of a screen inside a post is drawn still, as a picture of that screen. It does not make the board a product prototype.

## Dials are the template's slots

Every slot an editor will change is a dial or a fixture, never a hard-coded string:

| Slot | How |
| --- | --- |
| Copy (kicker, headline, subhead, call to action) | `fixtures.json`, one item per post; `text` names headline and subhead so `longest` stresses them |
| Which post | A `post` select over the set |
| Layout (photo, type only, quote) | A `layout` select; each option a state in the README |
| Tone (brand, light, inverse, dark) | A `tone` select. This is the only way a piece has a dark version: the board ignores the theme. |

The README's States table lists every combination a reviewer must see: each fixture set, each layout, each tone. `empty` and `missing` are real states here too: a post with no image is the one that runs on a busy day.

## Export

```bash
pnpm export <slug>                                          # every artboard at its format's default
pnpm export <slug> --dials '{"Review":{"layout":"type"}}'   # a chosen state, by panel and dial name
pnpm export <slug> --as pdf                                 # everything as PDF
pnpm export <slug> --scale 2                                # PNGs at twice the pixels
```

PNG for posts, stories, link previews and banners, at the exact size platforms ask for; one PDF per format for slides and print, each page at the format's size. Files land in `exports/<slug>/` (gitignored), named `<slug>-<artboard name>.png`. It needs Chrome, Chromium or Edge on the machine (`CHROME_PATH` for another location).

Export the state the README's Decision names. When the user asks for "the posts", export each post in the set: one `--dials` per post, `--out exports/<slug>/post-<n>`.

## Done

The definition of done in `AGENTS.md`, plus: every artboard exports without an error, the exported files are opened and look like the board, and nothing sits in a story's safe bands.
