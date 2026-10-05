import { useId, useRef, useState, type ReactNode } from "react";
import { useDialogBehaviour } from "../../lib/useDialogBehaviour";
import { settle, useDrag } from "../../lib/gestures";

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
 * open, Escape and the scrim both close it and focus stays inside it, and its
 * head (the grabber and the title) can be dragged down to put it away.
 */
export function Sheet({ open, title, onClose, children, footer }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useDialogBehaviour(panelRef, open, onClose);

  // Dragged down far enough, or flicked, the sheet goes; otherwise it settles
  // back. Only the head drags, so the body below still scrolls and its words
  // can still be selected.
  const [height, setHeight] = useState(0);
  const { offset, dragging, bind } = useDrag({
    axis: "y",
    direction: 1,
    enabled: open,
    onRelease: (release) => {
      // Unmeasured (nothing laid out), it asks for the longest pull.
      const distance = height > 0 ? Math.min(160, height * 0.3) : 160;
      if (settle(release, distance) === 1) onClose();
    },
  });

  return (
    <div
      inert={!open}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 20,
        visibility: open ? "visible" : "hidden",
        transition: `visibility 0s linear ${open ? "0s" : "var(--motion-screen)"}`,
      }}
    >
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: 0,
          padding: 0,
          background: "var(--bg-scrim)",
          opacity: open ? 1 : 0,
          transition: "opacity var(--motion-base) var(--ease-out)",
          cursor: "default",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          background: "var(--bg-elevated)",
          borderRadius: "var(--radius-xl) var(--radius-xl) 0 0",
          boxShadow: "var(--shadow-3)",
          paddingBottom: "var(--safe-bottom)",
          paddingLeft: "var(--safe-left)",
          paddingRight: "var(--safe-right)",
          // Never lifted off the bottom edge: only downward drags move it.
          transform: open
            ? `translateY(${Math.max(0, offset)}px)`
            : "translateY(100%)",
          transition: dragging
            ? "none"
            : "transform var(--motion-screen) var(--ease-out)",
          maxHeight: "90%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          {...bind}
          onPointerDown={(event) => {
            setHeight(panelRef.current?.offsetHeight ?? 0);
            bind.onPointerDown(event);
          }}
          style={{
            // The head owns the vertical drag; it never scrolls.
            touchAction: "none",
            cursor: "grab",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: "block",
              width: 36,
              height: 5,
              borderRadius: 99,
              background: "var(--border-2)",
              margin: "10px auto 0",
            }}
          />
          <h2
            id={titleId}
            style={{
              margin: 0,
              font: "var(--type-title)",
              fontSize: "1.375rem",
              padding: "14px var(--gutter) 4px",
            }}
          >
            {title}
          </h2>
        </div>
        <div
          className="ow-scroll"
          style={{ padding: "12px var(--gutter)", overflow: "auto", flex: 1 }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: "8px var(--gutter) 16px",
              display: "grid",
              gap: 8,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
