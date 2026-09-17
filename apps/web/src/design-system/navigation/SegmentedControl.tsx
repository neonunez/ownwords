import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Names the group, so the choice is announced with what it is choosing. */
  label: string;
  style?: CSSProperties;
}

/**
 * A choice between formats or settings. Built as a radio group: arrow keys
 * move between options, the selected one is the only tab stop, and the thumb
 * follows the selection rather than carrying it.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  style,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const step = keys[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    onChange(option.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, 1fr)`,
        height: 44,
        minHeight: 44,
        borderRadius: 'var(--radius-pill)',
        background: 'var(--bg-sunken)',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 3,
          bottom: 3,
          left: 3,
          width: `calc((100% - 6px) / ${options.length})`,
          borderRadius: 99,
          background: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-1)',
          transform: `translateX(${index * 100}%)`,
          transition: 'transform var(--motion-base) var(--ease-spring)',
        }}
      />
      {options.map((option, position) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            id={`${groupId}-${option.value}`}
            ref={(node) => {
              refs.current[position] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={move}
            style={{
              position: 'relative',
              border: 0,
              background: 'transparent',
              borderRadius: 99,
              font: 'var(--type-label)',
              color: selected ? 'var(--fg-1)' : 'var(--fg-2)',
              cursor: 'pointer',
              transition: 'color var(--motion-fast)',
              minHeight: 44,
              padding: '0 6px',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
