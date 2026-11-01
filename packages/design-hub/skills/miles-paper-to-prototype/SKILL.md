---
name: miles-paper-to-prototype
description: "Turn a Paper Desktop comp into prototype conventions: tokens into kit/tokens.css, the shell into kit/shell.ts, components onto @kit/ui, content into fixtures. Load on every Paper MCP read, not only the first. Triggers on: Paper, Paper Desktop, paper.design, comp, frame, artboard, get_jsx, get_computed_styles, get_tokens, from the design, match the comp, the design says."
---

# Paper to prototype

Paper is the source of the design; the prototype is built from its values, never from its code. This skill loads on every Paper read, because the drift it prevents compounds: a size read off a screenshot is a few pixels out, and three components later the page is a different design.

## Hard rules

1. **Values come from the tools, never from a screenshot.** Sizes, spacing, colours and type come from `get_computed_styles`, `get_tokens` and `get_font_family_info`; structure from `get_jsx` and `get_tree_summary`. `get_screenshot` is for seeing the whole, never for measuring. Why: screenshot values drift by a few pixels and the drift compounds across components.
2. **Never paste Paper JSX.** It is a reference for structure and values. The prototype is written in `@kit/ui` and the feature's own CSS on `kit/tokens.css` variables. Why: pasted JSX carries inline values and Paper's class names, which is a second design system beside the kit's.
3. **Tokens land once.** A value the design uses in two places becomes a token in `kit/tokens.css` under the kit's existing name, and `DESIGN.md`'s frontmatter gets the same value. A value used once stays a raw value in the feature's CSS, named in the README.
4. **The comp decides, the kit draws.** Where the comp and `@kit/ui` disagree on a control, the comp wins inside the feature folder (fork the control there); the kit changes only when the shell or a second feature needs it too.

## Procedure

1. **Open the file.** `get_basic_info` for the artboards and their sizes; `get_selection` when the user is pointing at something. Omit `fileId` to read the file the user has open.
2. **Fonts first.** `get_font_family_info` before any type is styled. Write the family to `--font` in `tokens.css`; add the `@font-face` there if the design names a file. Do this once per project.
3. **Tokens.** `get_tokens` for the project's palette, spacing and radii. Map each onto the kit's names (the table below). Write `tokens.css` light and dark, and `DESIGN.md` frontmatter, in one change. A design with no dark values gets the kit's dark derived by the same steps (neutral surfaces step down, brand lifts one step). When the repo has `design-system/` (the Elyx add-on), run `pnpm elyx` in the same change and never edit that folder: it is generated from `tokens.css`, and an edit there is lost on the next run.
4. **The shell.** Read `DESIGN.md`, Shell. If it names frames, `get_computed_styles` on each and fill `kit/shell.ts` (brand, nav, footer) and the shell CSS in `kit/`. If it is empty, prototypes stand in the Space and the shell is not built.
5. **The feature frame.** `get_tree_summary` for the structure, `get_computed_styles` on each component node for its values. Build top down in `@kit/ui` and the feature's CSS. Content on the frame goes to `fixtures.json` `real`, word for word (`miles-get-hostile`).
6. **Compare.** `get_screenshot` of the frame beside the prototype at the same width. Fix what differs by measuring the node again, never by eye.
7. **Visual match, only with TypeSafe on.** Export the frame as PNG and screenshot the prototype in the same state, both between 280 and 1568 px a side, then `pnpm visual-match <slug> --comp <png> --shot <png>`. It answers three questions: an element missing, an element added, a changed order. Treat a finding as a place to look, then measure the node; never act on it for a size or a colour. Why: Jev reads images in an experimental mode and is weak on numbers, so it can point at a difference but never measure one.

## Token map

Kit names stay; values change. The common Paper names and where they land:

| In the design | In the kit |
| --- | --- |
| primary, accent, brand | `--brand-*` and the `--bg-brand-*`, `--button-primary-*`, `--border-brand`, `--fg-brand-*` tokens |
| text, foreground, ink | `--text-primary`, `--text-secondary`, `--text-tertiary`, `--text-quaternary` |
| background, surface, canvas | `--bg-primary`, `--bg-secondary`, `--bg-tertiary` |
| border, stroke, divider | `--border-primary`, `--border-secondary` |
| radius | `--radius-xs` to `--radius-2xl` |
| shadow, elevation | `--shadow-xs` to `--shadow-xl` |
| font family, weight, size | `--font`, and the hierarchy in `DESIGN.md`, Typography |
| easing, duration | `--ease-*`, `--dur-*`; a curve the design names and the kit lacks is added once with a comment |

A design value with no kit name is added to `tokens.css` under a kit-shaped name (`--bg-brand-subtle`), noted in `DESIGN.md`, and never written raw in two places.

## Done

The feature's values are in `tokens.css` and `DESIGN.md` and nowhere else; the shell, when there is one, is in `kit/shell.ts`; the prototype's CSS uses only `var(--…)` and the raw values its README names; `pnpm check` passes.
