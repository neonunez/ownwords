import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
  icon?: IconName;
  size?: 'sm' | 'md';
  /** Renders the chip's text in the display face, for words rather than UI. */
  display?: boolean;
  children: ReactNode;
}

/**
 * A filter or choice chip. The visible pill is 28 or 36px tall; the button
 * around it keeps the 44px target the product requires. Selection inverts to
 * ink, because the accent is reserved for the one primary action on a screen.
 */
export function Chip({
  selected,
  icon,
  size = 'md',
  display,
  children,
  style,
  className,
  type = 'button',
  ...rest
}: ChipProps) {
  const pillHeight = size === 'sm' ? 28 : 36;
  return (
    <button
      type={type}
      aria-pressed={selected ?? false}
      className={['ow-press-chip', className].filter(Boolean).join(' ')}
      style={{
        minHeight: 44,
        height: 44,
        padding: 0,
        border: 0,
        background: 'transparent',
        color: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        cursor: 'pointer',
        flex: 'none',
        borderRadius: 'var(--radius-pill)',
        ...style,
      }}
      {...rest}
    >
      <span
        style={{
          height: pillHeight,
          padding: size === 'sm' ? '0 12px' : '0 14px',
          borderRadius: 'var(--radius-pill)',
          border: `1px solid ${selected ? 'transparent' : 'var(--border-1)'}`,
          background: selected ? 'var(--fg-1)' : 'var(--bg-surface)',
          color: selected ? 'var(--fg-inverse)' : 'var(--fg-1)',
          font: 'var(--type-label)',
          fontSize: display ? '1rem' : size === 'sm' ? '.8125rem' : '.8125rem',
          fontFamily: display ? 'var(--font-display)' : undefined,
          fontWeight: display ? 500 : undefined,
          letterSpacing: display ? 'var(--tracking-display)' : undefined,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
          transition: 'background var(--motion-fast), color var(--motion-fast)',
        }}
      >
        {icon && <Icon name={icon} size={14} />}
        {children}
      </span>
    </button>
  );
}
