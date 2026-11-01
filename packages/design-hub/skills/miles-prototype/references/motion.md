# Motion

Binding for every prototype. Curves and durations live in `kit/tokens.css` (`--ease-*`, `--dur-*`) and, for JS, `@kit/motion`.

## Decide before you animate

1. **How often is it seen?** A hundred times a day (keyboard shortcuts, command palette, list navigation): no animation. Tens of times (hover, tabs): barely any. Occasional (menus, dialogs, toasts, sheets): standard. Rare (first run, a celebration): room for delight.
2. **What is it for?** Spatial consistency, a state change, feedback, or softening a jump. "It looks nice" is not a purpose for something seen often.
3. **Which curve?** Entering or leaving: ease-out. Moving on screen: ease-in-out. Color and fill: `--ease-hover`. Constant motion: linear. Never `ease-in` on UI.
4. **How long?** Press 100-160ms. Tooltip 125-200ms. Menu, select 150-250ms. Dialog, drawer 200-320ms. UI stays under 300ms; exits are faster than entrances.

## Rules

- Animate `transform` and `opacity`. Anything else (height, width, top, padding, filter on large areas) needs a reason written in the README.
- Name exact properties: `transition: transform 180ms var(--ease-out)`, never `transition: all`.
- Keyboard-initiated opens, closes and arrow moves are instant. Pointer-initiated ones may animate.
- Press feedback on anything pressable: `:active { transform: scale(0.97) }`, 0.95 to 0.98.
- Never enter from `scale(0)`. Start at 0.95 or higher with `opacity: 0`.
- Popovers and menus grow from their trigger (`transform-origin` at the trigger edge). Modals scale from center.
- Hover motion only under `@media (hover: hover) and (pointer: fine)`.
- Stagger lists by 30-80ms, never block input while it plays.
- Blur under 20px, and only to bridge a crossfade.

## CSS first

| Situation | Use |
| --- | --- |
| State that can flip mid-animation (open/close, toasts, toggles) | `transition`: it retargets from where it is |
| Element entering the DOM | `@starting-style` with a transition |
| Element leaving the DOM | keep it mounted with a closing state until `transitionend`, or `motion`'s `AnimatePresence` |
| Loops, spinners, one-shot sequences nobody interrupts | `@keyframes` |
| Values computed at runtime (measured heights, pointer positions) | WAAPI `element.animate()` |
| Crossfading a whole view | View Transitions (`document.startViewTransition`) with a fallback |

## When `motion` earns its place

Reach for `motion/react` only for: springs that must keep velocity when interrupted, drag and gestures with momentum, layout animations (FLIP) between changing positions, exit animations in a list (`AnimatePresence`), shared-element transitions. Then:

- Import from `motion/react`. Use `ease.*` and `spring.*` from `@kit/motion` so JS matches the CSS tokens.
- Animate a `transform` string (`animate={{ transform: 'translateY(8px)' }}`) when the main thread may be busy; the `x`/`y` shorthands run on the main thread.
- Springs: `{ type: 'spring', duration: 0.3, bounce: 0 }` by default; bounce 0.1-0.3 only for drag release and playful moments.
- Drive per-frame values with motion values, not React state.

## Reduced motion

`[data-motion="reduce"]` on `<html>` is the one switch. The shell sets it from the OS setting, `?motion=reduce`, or the Space dial. Write reduced-motion CSS against it, not the media query:

```css
.menu { transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out); }
:root[data-motion="reduce"] .menu { transition: opacity 120ms linear; transform: none; }
```

In JS, `useReducedMotion()` from `@kit/prefs`. Keep fades and color changes, drop movement and scale.

## Tuning and review

- Every number you are unsure of goes on a dial (`DialVars` for CSS, `useDials` for JS). The decision is the number the user settles on; copy it from DialKit into the README.
- Watch at 0.25x with the Space speed dial, or `?lapse` for frame-by-frame takes, scrubbing and a jank report when the project has `@aiforui/lapse` installed.
- Test the interruption: open, then close mid-open. It should reverse from where it is.
