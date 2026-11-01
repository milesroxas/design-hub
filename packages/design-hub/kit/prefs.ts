import { useSyncExternalStore } from 'react';

// Theme, reduced motion and speed for the page, mirrored onto <html>
// (.dark-mode, [data-motion="reduce"]) so CSS and JS read one source.

export type Appearance = 'system' | 'light' | 'dark';

/** What the Lapse panel hands back when a project has it installed: its clock engine. */
export type LapseHandle = { engine: { setSpeed(x: number): void; getSpeed(): number } };

const root = document.documentElement;
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
const urlReduce = params.get('motion') === 'reduce';
const listeners = new Set<() => void>();

let appearance: Appearance = readAppearance();
let forceReduce = false;
let speed = 1;
let lapse: LapseHandle | null = null;

function readAppearance(): Appearance {
  const fromUrl = params.get('theme');
  if (fromUrl === 'light' || fromUrl === 'dark' || fromUrl === 'system') return fromUrl;
  try {
    const saved = localStorage.getItem('proto:appearance');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {}
  return 'light';
}

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyTheme() {
  const dark = appearance === 'dark' || (appearance === 'system' && darkQuery.matches);
  // The browser chrome and native controls follow the app's theme, not the OS: the class decides.
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c0e12' : '#ffffff');
  if (dark === root.classList.contains('dark-mode')) return;
  root.classList.add('no-tx');
  root.classList.toggle('dark-mode', dark);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-tx')));
}

function applyMotion() {
  if (motionQuery.matches || urlReduce || forceReduce) root.dataset.motion = 'reduce';
  else delete root.dataset.motion;
}

export function setAppearance(next: Appearance) {
  if (next === appearance) return;
  appearance = next;
  try {
    localStorage.setItem('proto:appearance', next);
  } catch {}
  applyTheme();
  emit();
}

export function setForceReduce(on: boolean) {
  forceReduce = on;
  applyMotion();
  emit();
}

export const isDark = () => root.classList.contains('dark-mode');
export const prefersReducedMotion = () => root.dataset.motion === 'reduce';

export const useAppearance = () => useSyncExternalStore(subscribe, () => appearance);
export const useDark = () => useSyncExternalStore(subscribe, isDark);
export const useReducedMotion = () => useSyncExternalStore(subscribe, prefersReducedMotion);

/** Lapse owns the clocks once attached; the speed dial drives it instead of retiming animations itself. */
export function attachLapse(handle: LapseHandle) {
  lapse = handle;
}

export function setSpeed(x: number) {
  speed = x;
  if (lapse) lapse.engine.setSpeed(x);
  emit();
}

export const getSpeed = () => (lapse ? lapse.engine.getSpeed() : speed);
export const useSpeed = () => useSyncExternalStore(subscribe, getSpeed);

function retime(e: Event) {
  if (lapse || speed === 1) return;
  for (const a of (e.target as Element).getAnimations?.() ?? []) {
    if (a.playbackRate === 1) a.playbackRate = speed;
  }
}

darkQuery.addEventListener('change', () => {
  applyTheme();
  emit();
});
motionQuery.addEventListener('change', () => {
  applyMotion();
  emit();
});
document.addEventListener('transitionrun', retime);
document.addEventListener('animationstart', retime);
applyTheme();
applyMotion();
