import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { afterTransition, trapTab } from './layer';
import './ui.css';

type Action = {
  label: string;
  value: unknown;
  kind?: 'primary' | 'secondary' | 'tertiary' | 'primary-error';
};

type DialogEntry = {
  kind: 'dialog';
  id: number;
  title: string;
  body: ReactNode;
  actions: Action[];
  danger: boolean;
  width: number;
  resolve: (value: unknown) => void;
};

export type SheetHandle = { close: () => void };

type SheetEntry = {
  kind: 'sheet';
  id: number;
  title: string;
  width: number;
  content: (close: () => void) => ReactNode;
  handle: SheetHandle;
};

type Entry = DialogEntry | SheetEntry;

let layers: Entry[] = [];
let seq = 0;
const closing = new Set<number>();
const listeners = new Set<() => void>();

function setLayers(next: Entry[]) {
  layers = next;
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const syncBody = () =>
  document.body.classList.toggle(
    'has-overlay',
    layers.some((l) => !closing.has(l.id)),
  );

const isTop = (id: number) => layers.filter((l) => !closing.has(l.id)).at(-1)?.id === id;

export function openDialog({
  title,
  body,
  actions,
  danger = false,
  width = 440,
}: {
  title: string;
  body: ReactNode;
  actions: Action[];
  danger?: boolean;
  width?: number;
}) {
  return new Promise<unknown>((resolve) => {
    setLayers([...layers, { kind: 'dialog', id: ++seq, title, body, actions, danger, width, resolve }]);
  });
}

// Both verbs are named by the caller: the confirm is the outcome (Delete
// report, Cancel the run), and the dismiss says what it keeps doing when
// Cancel would be ambiguous (Keep running).
export function confirmDialog(
  title: string,
  body: ReactNode,
  {
    confirmLabel,
    dismissLabel = 'Cancel',
    danger = true,
  }: { confirmLabel: string; dismissLabel?: string; danger?: boolean },
) {
  return openDialog({
    title,
    body,
    danger,
    actions: [
      { label: dismissLabel, value: false },
      { label: confirmLabel, value: true, kind: danger ? 'primary-error' : 'primary' },
    ],
  }).then((v) => v === true);
}

// content renders <SheetBody> and, optionally, <SheetFoot>.
export function openSheet({
  title,
  width = 520,
  content,
}: {
  title: string;
  width?: number;
  content: (close: () => void) => ReactNode;
}) {
  const handle: SheetHandle = { close: () => {} };
  setLayers([...layers, { kind: 'sheet', id: ++seq, title, width, content, handle }]);
  return handle;
}

export function SheetBody({ children }: { children: ReactNode }) {
  return <div className="sheet-body">{children}</div>;
}

export function SheetFoot({ children }: { children?: ReactNode }) {
  return <div className="sheet-foot">{children}</div>;
}

export function OverlayHost() {
  const list = useSyncExternalStore(subscribe, () => layers);
  return createPortal(
    list.map((entry) =>
      entry.kind === 'dialog' ? (
        <DialogLayer key={entry.id} entry={entry} />
      ) : (
        <SheetLayer key={entry.id} entry={entry} />
      ),
    ),
    document.body,
  );
}

function useLayer(id: number, panel: RefObject<HTMLDivElement | null>, exitMs: number) {
  const overlay = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  const done = useRef(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    prev.current ??= document.activeElement;
    void overlay.current?.offsetWidth;
    setOpen(true);
    syncBody();
  }, []);

  const close = useCallback(() => {
    if (done.current) return false;
    done.current = true;
    closing.add(id);
    setOpen(false);
    syncBody();
    afterTransition(panel.current, exitMs).then(() => {
      closing.delete(id);
      setLayers(layers.filter((l) => l.id !== id));
    });
    (prev.current as HTMLElement | null)?.focus?.();
    return true;
  }, [id, panel, exitMs]);

  useEffect(() => {
    const el = overlay.current;
    const onDown = (e: PointerEvent) => {
      if (e.target === el) close();
    };
    el?.addEventListener('pointerdown', onDown);
    return () => el?.removeEventListener('pointerdown', onDown);
  }, [close]);

  return { overlay, open, close };
}

function useLayerKeys(id: number, panel: RefObject<HTMLDivElement | null>, onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isTop(id) || document.querySelector('.menu.is-open')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape();
      } else if (panel.current) trapTab(e, panel.current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, panel, onEscape]);
}

function DialogLayer({ entry }: { entry: DialogEntry }) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { overlay, open, close } = useLayer(entry.id, dialog, 150);
  const finish = useCallback(
    (value: unknown) => {
      if (close()) entry.resolve(value);
    },
    [close, entry],
  );
  const onEscape = useCallback(() => finish(null), [finish]);
  useLayerKeys(entry.id, dialog, onEscape);

  useEffect(() => {
    const t = setTimeout(() => {
      const buttons = [...(dialog.current?.querySelectorAll<HTMLElement>('button') ?? [])];
      (
        dialog.current?.querySelector<HTMLElement>('[data-autofocus]') ?? buttons.at(entry.danger ? 0 : -1)
      )?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [entry.danger]);

  return (
    <div ref={overlay} className={open ? 'overlay is-open' : 'overlay'} role="presentation">
      <div
        ref={dialog}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width: entry.width }}
      >
        <div className="dialog-body">
          <h2 id={titleId} className="dialog-title">
            {entry.title}
          </h2>
          <div className="dialog-text">{entry.body}</div>
        </div>
        <div className="dialog-actions">
          {entry.actions.map((a) => (
            <Button
              key={a.label}
              kind={a.kind ?? 'secondary'}
              label={a.label}
              onClick={() => finish(a.value)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SheetLayer({ entry }: { entry: SheetEntry }) {
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const { overlay, open, close } = useLayer(entry.id, sheet, 320);
  const dismiss = useCallback(() => {
    close();
  }, [close]);
  entry.handle.close = dismiss;
  useLayerKeys(entry.id, sheet, dismiss);

  useEffect(() => {
    const t = setTimeout(() => {
      const root = sheet.current;
      (
        root?.querySelector<HTMLElement>('[data-autofocus]') ??
        root?.querySelector<HTMLElement>('.sheet-body :is(input, button)')
      )?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      ref={overlay}
      className={open ? 'overlay overlay-sheet is-open' : 'overlay overlay-sheet'}
      role="presentation"
    >
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width: entry.width }}
      >
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {entry.title}
          </h2>
          <Button kind="tertiary" size={null} icon="x-close" aria-label="Close" onClick={dismiss} />
        </div>
        {entry.content(dismiss)}
      </div>
    </div>
  );
}
