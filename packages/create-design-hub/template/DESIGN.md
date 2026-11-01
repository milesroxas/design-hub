---
name: Project name
description: The product design system this project builds on, recorded from the design (Paper) and, where one exists, the live product
colors:
  brand: "#2b57cc"
  brand-hover: "#2246a6"
  ink: "#101828"
  ink-secondary: "#344054"
  ink-tertiary: "#475467"
  ink-quaternary: "#667085"
  surface: "#ffffff"
  surface-secondary: "#f9fafb"
  surface-tertiary: "#f2f4f7"
  line: "#d0d5dd"
  line-secondary: "#eaecf0"
  error: "#d92d20"
  warning: "#dc6803"
  success: "#079455"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  full: "9999px"
spacing:
  2xs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "32px"
---

# Design System: Project name

This file is the template's. Replace every value and every sentence below with the project's own the first time `miles-paper-to-prototype` reads the design, and keep it current after: `kit/tokens.css` holds the same values as CSS variables, and the two must agree. The frontmatter is what Impeccable reads (`/impeccable doctor` checks it); the prose is what a person or an agent reads before touching the product.

## Overview

One paragraph on what the product is for and how the interface serves that. Name the creative north star in a phrase, then the two or three characteristics that follow from it (one typeface and why; where saturated colour is allowed; how edges are drawn). Say whether light and dark are equal citizens.

## Shell

Every project has a shell: a product's sidebar, top bar and content, or a website's header and footer, with a pre-footer when the design treats one as a global. Record the answer `miles-design-hub` collected so it is built once and never asked again:

- **Kind:** product or website.
- **Paper frames:** the link to each frame that holds the shell (header, sidebar, footer, pre-footer). Empty when the design has no shell and prototypes stand in the Space.
- **Where it is built:** `kit/shell.ts` (brand, navigation, people) and `AppShell.tsx` or `SiteShell.tsx`. A prototype never rebuilds the shell inside its own folder.

## Colors

Group by role: primary, neutral, status, any utility family. For each colour, its name, hex, token, what it is for and its dark value. Then the named rules, each a bold name and a paragraph that says the rule and why it holds.

### Named Rules

**The Labelled Hue Rule.** Colour never carries meaning alone. A status gets a dot or a word, a chart series a legend entry, a tier its name. Why: a reviewer in grayscale, a printout and a screen reader all lose the hue.

**The Hover Rule.** A hovered row or menu item lifts on `--bg-primary_hover`, never on a brand tint. Why: a brand tint on hover reads as selection, and the two states must stay distinct.

## Typography

The faces, the weights, and the hierarchy as a ladder: display, headline, title, body, label, caption, each with size, line height, weight and where it appears. Then the named rules.

### Named Rules

**The Weight Ladder Rule.** Hierarchy climbs 400 to 500 to 600 before it climbs in size. Two sizes apart with the same weight is a mistake. Why: weight separates levels at the same measure; size alone makes every level a new line length.

## Layout

The shell's dimensions, the content measure, the breakpoints, the spacing steps observed and which to prefer.

## Elevation & Depth

How edges are drawn (hairline first, shadow second), the shadow vocabulary by name, and what dark mode does instead.

### Named Rules

**The Hairline First Rule.** An edge is a 1px border in `--border-primary` or `--border-secondary`; a shadow may reinforce it but never replaces it. Why: dark mode draws no shadows, and the border has to be enough on its own.

**The Hit Area Rule.** Nothing clickable is smaller than 40px on a side on desktop, 44px on touch. A small glyph gets padding or a pseudo-element, never a smaller target. Why: a target that is hard to hit is a defect the reviewer blames on the design.

## Shapes

Radii by element, border placement, icon size and set.

## Components

Buttons, badges, cards, inputs, navigation, tables: the shape, the states, the motion, in that order. Rules decided in a prototype land here as named rules the day they are decided, with the date and the prototype that decided them.

## Do's and Don'ts

### Do:
- **Do** take every value from `kit/tokens.css` and keep this file in step with it.
- **Do** design every screen in light and dark and preview both before calling it done.

### Don't:
- **Don't** use raw hex in a prototype. A raw value is a decision: name it in the README or add a token and note it here.
- **Don't** restyle the shell inside a prototype. Change `kit/shell.ts` and say so here.
