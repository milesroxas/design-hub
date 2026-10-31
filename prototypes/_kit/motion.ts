// tokens.css curves as arrays, for motion/react and WAAPI.
// Keep both in step: a curve changed here changes there.

export const ease = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
  drawer: [0.32, 0.72, 0, 1],
  press: [0.33, 1, 0.68, 1],
  morph: [0.45, 0, 0.55, 1],
  hover: [0.25, 0.46, 0.45, 0.94],
} as const;

export const spring = {
  snappy: { type: 'spring', duration: 0.3, bounce: 0 },
  gentle: { type: 'spring', duration: 0.45, bounce: 0.15 },
} as const;

export const cssEase = (curve: readonly number[]) => `cubic-bezier(${curve.join(', ')})`;
