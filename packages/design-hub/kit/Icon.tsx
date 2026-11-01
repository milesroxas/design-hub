import { type IconName, icons } from './icons';

export type { IconName };

type Props = { name: IconName; size?: number; className?: string; label?: string };

function geometry(name: IconName, size: number) {
  const icon = icons[name];
  const [, , w, h] = icon.vb.split(' ').map(Number);
  return { icon, width: size, height: Math.round((size * h) / w), stroked: Boolean(icon.rootStroke) };
}

export function Icon({ name, size = 20, className, label }: Props) {
  const { icon, width, height, stroked } = geometry(name, size);
  const stroke = stroked ? { stroke: 'currentColor', strokeWidth: 2 } : {};
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={width}
      height={height}
      viewBox={icon.vb}
      fill="none"
      {...stroke}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, inlined from @kit/icons
      dangerouslySetInnerHTML={{ __html: icon.inner }}
    />
  );
}

// The same decorative icon as markup, for the few places the kit writes DOM outside React.
export function iconMarkup(name: IconName, size = 20) {
  const { icon, width, height, stroked } = geometry(name, size);
  const stroke = stroked ? ' stroke="currentColor" stroke-width="2"' : '';
  return `<svg class="icon" width="${width}" height="${height}" viewBox="${icon.vb}" fill="none"${stroke} aria-hidden="true" focusable="false">${icon.inner}</svg>`;
}
