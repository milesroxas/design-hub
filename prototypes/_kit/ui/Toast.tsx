import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../Icon';
import { prefersReducedMotion } from '../prefs';
import { afterTransition } from './layer';
import './ui.css';

type ToastAction = { label: string; onClick: () => void };
type ToastKind = 'default' | 'error' | 'scope';
type ToastEntry = {
  id: number;
  message: string;
  action?: ToastAction;
  kind: ToastKind;
  duration: number;
};

// default and error are the product speaking; scope is the prototype itself,
// in the harness material, for anything the sketch does not build.
const GLYPH: Record<ToastKind, IconName> = {
  default: 'check',
  error: 'alert-triangle',
  scope: 'circle-dashed',
};

let toasts: ToastEntry[] = [];
let seq = 0;
let beforeChange: (() => void) | null = null;
const listeners = new Set<() => void>();
const dismissers = new Map<number, () => void>();

function setToasts(next: ToastEntry[]) {
  beforeChange?.();
  toasts = next;
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function toast(
  message: string,
  {
    action,
    duration = 5000,
    kind = 'default',
  }: { action?: ToastAction; duration?: number; kind?: ToastKind } = {},
) {
  const id = ++seq;
  setToasts([...toasts, { id, message, action, kind, duration }]);
  return { dismiss: () => dismissers.get(id)?.() };
}

export function notInPrototype(what: string) {
  return toast(`${what} is not part of this prototype.`, { kind: 'scope' });
}

// Siblings slide to their new slot when a toast lands or leaves (FLIP, transform only).
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => toasts);
  const host = useRef<HTMLDivElement>(null);
  const before = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    beforeChange = () => {
      before.current = new Map();
      if (prefersReducedMotion()) return;
      for (const n of host.current?.querySelectorAll<HTMLElement>('.toast.is-open') ?? []) {
        before.current.set(n.dataset.id ?? '', n.getBoundingClientRect().top);
      }
    };
    return () => {
      beforeChange = null;
    };
  }, []);

  useLayoutEffect(() => {
    if (!list) return;
    for (const [id, top] of before.current) {
      const n = host.current?.querySelector<HTMLElement>(`[data-id="${id}"]`);
      if (!n) continue;
      const dy = top - n.getBoundingClientRect().top;
      if (!dy) continue;
      n.style.transition = 'none';
      n.style.transform = `translateY(${dy}px)`;
      void n.offsetWidth;
      n.style.transition = '';
      n.style.transform = '';
    }
    before.current.clear();
  }, [list]);

  return createPortal(
    <div ref={host} id="toasts" className="toasts" aria-live="polite">
      {list.map((t) => (
        <ToastItem key={t.id} entry={t} />
      ))}
    </div>,
    document.body,
  );
}

const RESUME_MS = 2500;

function ToastItem({ entry }: { entry: ToastEntry }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const [phase, setPhase] = useState<'enter' | 'open' | 'leaving'>('enter');
  const leaving = useRef(false);

  const dismiss = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    clearTimeout(timer.current);
    setPhase('leaving');
    afterTransition(ref.current, 200).then(() => setToasts(toasts.filter((t) => t.id !== entry.id)));
  }, [entry.id]);

  const hold = useCallback(() => clearTimeout(timer.current), []);
  const resume = useCallback(() => {
    if (leaving.current) return;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(dismiss, RESUME_MS);
  }, [dismiss]);

  useLayoutEffect(() => {
    void ref.current?.offsetWidth;
    setPhase((p) => (p === 'enter' ? 'open' : p));
  }, []);

  useEffect(() => {
    timer.current = window.setTimeout(dismiss, entry.duration);
    dismissers.set(entry.id, dismiss);
    // A toast the user cannot see should not run out while the tab is hidden.
    const onVisibility = () => (document.hidden ? hold() : resume());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer.current);
      dismissers.delete(entry.id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dismiss, hold, resume, entry]);

  const cls = [
    'toast',
    `toast-${entry.kind}`,
    phase === 'open' ? 'is-open' : '',
    phase === 'leaving' ? 'is-leaving' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      data-id={entry.id}
      className={cls}
      role="status"
      onPointerEnter={hold}
      onPointerLeave={resume}
      onFocus={hold}
      onBlur={resume}
    >
      <span className="toast-glyph">
        <Icon name={GLYPH[entry.kind]} size={16} />
      </span>
      <span className="toast-text">{entry.message}</span>
      {entry.action ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            entry.action?.onClick();
            dismiss();
          }}
        >
          {entry.action.label}
        </button>
      ) : null}
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={dismiss}>
        <Icon name="x-close" size={16} />
      </button>
    </div>
  );
}
