import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  useLayoutEffect,
  useRef,
} from 'react';
import { Icon, type IconName } from '../Icon';
import './ui.css';

type Kind = 'primary' | 'secondary' | 'tertiary' | 'primary-error' | 'secondary-error';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  kind?: Kind;
  size?: 'md' | 'sm' | null;
  icon?: IconName;
  iconSize?: number;
  trailing?: ReactNode;
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
} & ({ label: ReactNode } | { label?: undefined; 'aria-label': string });

const buttonClass = (kind: string, size: string | null, iconOnly: boolean, busy?: boolean, extra?: string) =>
  ['btn', `btn-${kind}`, size && `btn-${size}`, iconOnly && 'btn-icon', busy && 'is-busy', extra]
    .filter(Boolean)
    .join(' ');

export function Button({
  label,
  kind = 'secondary',
  size = 'md',
  icon,
  iconSize = 20,
  trailing,
  busy,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  const cls = buttonClass(kind, size, label == null, busy, className);
  const content = (
    <>
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {label != null ? <span className="btn-label">{label}</span> : null}
      {trailing}
    </>
  );
  return (
    <button
      type={type}
      className={cls}
      aria-busy={busy || undefined}
      aria-disabled={busy || undefined}
      {...rest}
    >
      {busy === undefined ? content : <span className="btn-content">{content}</span>}
    </button>
  );
}

export function Chevron({ className = 'btn-chevron' }: { className?: string }) {
  return <Icon name="chevron-down" size={20} className={className} />;
}

type SegOption<T extends string> = T | { value: T; label: string };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  style,
}: {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own border and padding
    <div
      className={className ? `segmented ${className}` : 'segmented'}
      role="group"
      aria-label={label}
      style={style}
    >
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        return (
          <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
            {typeof o === 'string' ? o : o.label}
          </button>
        );
      })}
    </div>
  );
}

type Tone = 'success' | 'error' | 'warning' | 'brand';

export function Badge({
  tone,
  dot,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const cls = ['badge', tone ? `badge-${tone}` : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      {dot ? <i className="dot" /> : null}
      {children}
    </span>
  );
}

export function Checkbox({
  indeterminate,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { indeterminate?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return <input ref={ref} type="checkbox" className="checkbox" {...rest} />;
}
