import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../Icon';
import { afterTransition } from './layer';
import './ui.css';

export type MenuItem = {
  label: string;
  value?: string;
  desc?: string;
  icon?: IconName;
  keys?: (string | { icon: IconName; label: string })[];
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

export type MenuEntry = MenuItem | '-';

export type MenuConfig = {
  items: MenuEntry[];
  align?: 'start' | 'end';
  width?: number | ((trigger: HTMLElement) => number);
  header?: string;
  label?: string;
  selected?: string;
  checkable?: boolean;
  role?: 'menu' | 'listbox';
  onSelect?: (value: string | undefined, item: MenuItem) => void;
};

type Phase = 'closed' | 'open' | 'closing';

let closeOpen: (() => void) | null = null;

// Spread triggerProps on the trigger; render `menu` anywhere (it portals).
export function useMenu(config: MenuConfig) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>('closed');

  const quietClose = useCallback(() => setPhase((p) => (p === 'open' ? 'closing' : p)), []);

  const close = useCallback(
    (focusTrigger = false) => {
      if (closeOpen === quietClose) closeOpen = null;
      quietClose();
      if (focusTrigger) triggerRef.current?.focus();
    },
    [quietClose],
  );

  const open = useCallback(() => {
    if (closeOpen && closeOpen !== quietClose) closeOpen();
    closeOpen = quietClose;
    setPhase('open');
  }, [quietClose]);

  useEffect(
    () => () => {
      if (closeOpen === quietClose) closeOpen = null;
    },
    [quietClose],
  );

  useEffect(() => {
    if (phase !== 'open') return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popupRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    const onAway = () => close();
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    addEventListener('resize', onAway);
    addEventListener('hashchange', onAway);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
      removeEventListener('resize', onAway);
      removeEventListener('hashchange', onAway);
    };
  }, [phase, close]);

  const onExited = useCallback(() => setPhase((p) => (p === 'closing' ? 'closed' : p)), []);
  const isOpen = phase === 'open';

  const triggerProps = {
    ref: (el: HTMLElement | null) => {
      triggerRef.current = el;
    },
    onClick: () => (isOpen ? close() : open()),
    'aria-haspopup': config.role === 'listbox' ? ('listbox' as const) : ('menu' as const),
    'aria-expanded': isOpen,
  };

  const menu =
    phase === 'closed'
      ? null
      : createPortal(
          <MenuPopup
            config={config}
            phase={phase}
            triggerRef={triggerRef}
            popupRef={popupRef}
            close={close}
            onExited={onExited}
          />,
          document.body,
        );

  return { triggerProps, menu, isOpen, open, close };
}

function MenuPopup({
  config,
  phase,
  triggerRef,
  popupRef,
  close,
  onExited,
}: {
  config: MenuConfig;
  phase: Phase;
  triggerRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLDivElement | null>;
  close: (focusTrigger?: boolean) => void;
  onExited: () => void;
}) {
  const { items, align = 'end', header, selected, checkable, role = 'menu', onSelect } = config;
  const [shown, setShown] = useState(false);
  const typed = useRef({ text: '', at: 0 });

  const enabled = () => [
    ...(popupRef.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not([disabled])') ?? []),
  ];

  // biome-ignore lint/correctness/useExhaustiveDependencies: placed once, on open
  useLayoutEffect(() => {
    const menu = popupRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;
    place(menu, trigger, typeof config.width === 'function' ? config.width(trigger) : config.width, align);
    const frame = requestAnimationFrame(() => setShown(true));
    const focus = setTimeout(() => {
      const picked = selected != null ? menu.querySelector<HTMLElement>('.menu-item.is-selected') : null;
      (picked ?? enabled()[0])?.focus();
    }, 20);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(focus);
    };
  }, []);

  useEffect(() => {
    if (phase === 'closing') afterTransition(popupRef.current, 120).then(onExited);
  }, [phase, onExited, popupRef]);

  // Type to jump: letters typed within half a second build one query, matched from the item after focus.
  const typeahead = (e: KeyboardEvent<HTMLDivElement>, list: HTMLButtonElement[], i: number) => {
    const now = Date.now();
    const text = (now - typed.current.at < 500 ? typed.current.text : '') + e.key.toLowerCase();
    typed.current = { text, at: now };
    const hit = [...list.slice(i + 1), ...list.slice(0, i + 1)].find((b) =>
      b.dataset.label?.toLowerCase().startsWith(text),
    );
    if (!hit) return;
    e.preventDefault();
    hit.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = enabled();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const step = STEP[e.key];
    if (step) {
      e.preventDefault();
      list[(step(i, list.length - 1) + list.length) % list.length]?.focus();
    } else if (e.key === 'Tab') close(true);
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) typeahead(e, list, i);
  };

  const pick = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onClick?.();
    onSelect?.(item.value, item);
  };

  const cls = ['menu', shown && phase === 'open' ? 'is-open' : '', phase === 'closing' ? 'is-closing' : '']
    .filter(Boolean)
    .join(' ');

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: role is menu or listbox, both interactive
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: menu and listbox both take aria-label
    <div
      ref={popupRef}
      className={cls}
      role={role}
      tabIndex={-1}
      aria-label={config.label ?? header}
      onKeyDown={onKeyDown}
    >
      {header ? (
        <div className="menu-header" aria-hidden="true">
          {header}
        </div>
      ) : null}
      {items.map((item, n) => {
        // biome-ignore lint/a11y/useSemanticElements: an <hr> brings borders the menu rule does not want
        // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity; the list is fixed while open
        if (item === '-') return <div key={`sep-${n}`} className="menu-sep" role="separator" />;
        return (
          <MenuRow
            key={`${item.label}-${item.value ?? n}`}
            item={item}
            role={role === 'listbox' ? 'option' : checkable ? 'menuitemradio' : 'menuitem'}
            selected={selected != null && selected === item.value}
            onPick={pick}
          />
        );
      })}
    </div>
  );
}

const STEP: Record<string, (i: number, last: number) => number> = {
  ArrowDown: (i) => i + 1,
  ArrowUp: (i) => i - 1,
  Home: () => 0,
  End: (_, last) => last,
};

/**
 * Opens below the trigger when it fits, above when it does not, aligned to
 * the trigger's end or start and kept 8px inside the viewport. The origin
 * sits on the trigger, so the menu grows out of it.
 */
function place(menu: HTMLElement, trigger: HTMLElement, width: number | undefined, align: 'start' | 'end') {
  const r = trigger.getBoundingClientRect();
  if (width) menu.style.width = `${width}px`;
  const mw = width || menu.offsetWidth;
  const mh = menu.offsetHeight;
  const below = r.bottom + 4 + mh <= innerHeight - 8 || r.top - mh - 4 < 8;
  const top = below ? r.bottom + 4 : r.top - mh - 4;
  const left = Math.max(8, Math.min(align === 'end' ? r.right - mw : r.left, innerWidth - mw - 8));
  menu.dataset.side = below ? 'below' : 'above';
  menu.style.top = `${top + scrollY}px`;
  menu.style.left = `${left + scrollX}px`;
  menu.style.transformOrigin = `${below ? 'top' : 'bottom'} ${align === 'end' ? 'right' : 'left'}`;
}

function MenuKeys({ keys }: { keys: NonNullable<MenuItem['keys']> }) {
  return (
    <span className="menu-keys">
      {keys.map((k) => (
        <kbd key={typeof k === 'string' ? k : k.label} className="kbd">
          {typeof k === 'string' ? k : <Icon name={k.icon} size={12} label={k.label} />}
        </kbd>
      ))}
    </span>
  );
}

const rowClass = (item: MenuItem, selected: boolean) =>
  ['menu-item', item.danger && 'is-danger', item.disabled && 'is-disabled', selected && 'is-selected']
    .filter(Boolean)
    .join(' ');

function MenuRow({
  item,
  role,
  selected,
  onPick,
}: {
  item: MenuItem;
  role: 'option' | 'menuitemradio' | 'menuitem';
  selected: boolean;
  onPick: (item: MenuItem) => void;
}) {
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked only on menuitemradio, aria-selected only on option
    <button
      type="button"
      className={rowClass(item, selected)}
      role={role}
      aria-checked={role === 'menuitemradio' ? selected : undefined}
      aria-selected={role === 'option' ? selected : undefined}
      aria-disabled={item.disabled || undefined}
      disabled={item.disabled}
      data-label={item.label}
      onClick={() => onPick(item)}
    >
      {item.icon ? (
        <span className="menu-glyph">
          <Icon name={item.icon} size={16} />
        </span>
      ) : null}
      <span className="menu-text">
        <span className="menu-label">{item.label}</span>
        {item.desc ? <span className="menu-desc">{item.desc}</span> : null}
      </span>
      {item.keys ? <MenuKeys keys={item.keys} /> : null}
      {selected ? (
        <span className="menu-check">
          <Icon name="check" size={16} />
        </span>
      ) : null}
    </button>
  );
}

export type SelectOption = { value: string; label: string };

export function Select({
  value,
  options,
  onChange,
  width,
  className,
  placeholder = 'Select',
  labelId,
  'aria-label': ariaLabel,
}: {
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  width?: number;
  className?: string;
  placeholder?: string;
  labelId?: string;
  'aria-label'?: string;
}) {
  const valueId = useId();
  const current = options.find((o) => o.value === value);
  const menu = useMenu({
    role: 'listbox',
    align: 'start',
    items: options.map((o) => ({ label: o.label, value: o.value })),
    selected: value ?? undefined,
    label: ariaLabel,
    width: (trigger) => Math.max(trigger.offsetWidth, width || 0),
    onSelect: (v) => {
      if (v != null && v !== value) onChange(v);
    },
  });
  return (
    <>
      <button
        type="button"
        className={className ? `select ${className}` : 'select'}
        style={width ? { width } : undefined}
        aria-label={labelId ? undefined : ariaLabel}
        aria-labelledby={labelId ? `${labelId} ${valueId}` : undefined}
        {...menu.triggerProps}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          if (!menu.isOpen) menu.open();
        }}
      >
        <span id={valueId} className={current ? 'select-value' : 'select-value is-placeholder'}>
          {current ? current.label : placeholder}
        </span>
        <Icon name="chevron-down" size={20} className="select-chevron" />
      </button>
      {menu.menu}
    </>
  );
}
