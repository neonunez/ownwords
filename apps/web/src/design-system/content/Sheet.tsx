import { useId, useRef, type ReactNode } from 'react';
import { useDialogBehaviour } from '../../lib/useDialogBehaviour';

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * A sheet that rises from the bottom of the app frame.
 *
 * It stays in the tree so it can animate both ways, and is `inert` while
 * closed, which keeps it out of the tab order and out of the accessibility
 * tree. `visibility` changes only once the exit has played, so the sheet is
 * hidden rather than merely moved off the bottom of the screen. While it is
 * open, Escape and the scrim both close it and focus stays inside it.
 */
export function Sheet({ open, title, onClose, children, footer }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useDialogBehaviour(panelRef, open, onClose);

  return (
    <div
      inert={!open}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        visibility: open ? 'visible' : 'hidden',
        transition: `visibility 0s linear ${open ? '0s' : 'var(--motion-screen)'}`,
      }}
    >
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          border: 0,
          padding: 0,
          background: 'var(--bg-scrim)',
          opacity: open ? 1 : 0,
          transition: 'opacity var(--motion-base) var(--ease-out)',
          cursor: 'default',
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          boxShadow: 'var(--shadow-3)',
          paddingBottom: 'var(--safe-bottom)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform var(--motion-screen) var(--ease-out)',
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 36,
            height: 5,
            borderRadius: 99,
            background: 'var(--border-2)',
            margin: '10px auto 0',
          }}
        />
        <h2
          id={titleId}
          style={{
            margin: 0,
            font: 'var(--type-title)',
            fontSize: '1.375rem',
            padding: '14px var(--gutter) 4px',
          }}
        >
          {title}
        </h2>
        <div className="ow-scroll" style={{ padding: '12px var(--gutter)', overflow: 'auto', flex: 1 }}>
          {children}
        </div>
        {footer && <div style={{ padding: '8px var(--gutter) 16px', display: 'grid', gap: 8 }}>{footer}</div>}
      </div>
    </div>
  );
}
