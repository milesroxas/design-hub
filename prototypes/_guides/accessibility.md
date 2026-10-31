# Accessibility

The floor for every prototype, WCAG 2.2 AA. A prototype that only works with a mouse answers the wrong question.

## Structure

- Native elements first: `<button>` for actions, `<a href>` for navigation, `<label>` for every input, `<fieldset>`/`<legend>` for groups, `<table>` for tabular data, `<dialog>` or the kit dialog for modals.
- One `<main>` and one `<h1>` per page; headings in order. `Space` and `AppShell` already provide the landmarks.
- Every control has an accessible name. Icon-only buttons take `aria-label`; `<Icon label="…">` only when the icon itself carries meaning.
- `aria-*` only where HTML has no equivalent, and then follow the [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/) pattern exactly (menu button, listbox, dialog, tabs, combobox).

## Keyboard

- Everything a pointer can do, the keyboard can do, in a sensible tab order. No positive `tabindex`.
- Focus is always visible: the kit's focus ring comes from `--focus-ring`; never remove it without a replacement.
- Esc closes the topmost menu, popover, sheet or dialog, and focus returns to what opened it.
- Dialogs and sheets trap focus while open and make the page behind inert.
- Menus: arrows move, Home/End jump, typeahead finds, Enter/Space choose, Tab leaves.
- A keyboard open never animates (see `motion.md`).

## Perception

- Text and icons meet AA contrast against their background in light and dark. Tokens do this; one-off colors must be checked.
- Color is never the only signal: pair it with text, an icon or a pattern.
- Status that changes without a page load (a run finishing, a toast, a save) goes through a live region: `role="status"` for polite, `role="alert"` only for errors that need action.
- Respect `[data-motion="reduce"]` (see `motion.md`).
- Works at 200% zoom and at 320px wide without horizontal scrolling of the page.
- `forced-colors` keeps working: focus rings use a transparent outline under the shadow (kit base does this), borders stay borders.

## Pointer and touch

- Targets at least 24×24px, 40px or more for primary touch targets. Extend small hit areas with padding or a pseudo-element.
- Hover-only affordances need a focus and touch equivalent.
- Inputs use a 16px font on touch so iOS does not zoom.

## Forms

- Labels are visible; placeholders are examples, not labels.
- Errors sit next to the field, name the fix, and link with `aria-describedby`; `aria-invalid` on the field.
- Disabled actions are rare; prefer an enabled action that explains what is missing. If something is absent for a role (a Viewer), hide it, do not disable it.

## How to check

1. Watch the console: the shell runs axe in dev and logs `[a11y]` warnings with the failing selectors. Zero is the bar.
2. `pnpm check`: Biome's a11y rules catch missing labels, wrong roles and click handlers without keys.
3. Unplug the mouse: tab through the main path, open and close every popup, confirm focus lands somewhere sensible.
4. Load with `?motion=reduce` and `?theme=dark`.
5. For a new interaction pattern, a VoiceOver pass (⌘F5) on the main path.
