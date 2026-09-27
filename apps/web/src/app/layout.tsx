import { useState, type CSSProperties, type ReactNode } from "react";
import { Loaders, LoadersContext, useRevealClass } from "./reveal";

/**
 * One screen's frame: it eases in when it opens, and keeps count of the
 * loading cards inside it, so what replaces one can ease in too.
 */
export function ScreenFrame({ children }: { children: ReactNode }) {
  const [loaders] = useState(() => new Loaders());
  return (
    <LoadersContext.Provider value={loaders}>
      <div className="ow-screen">{children}</div>
    </LoadersContext.Provider>
  );
}

/**
 * What a read inside a screen replaces its loading card with, when the screen
 * itself stays (the Lexicon under its search). It eases in like a screen body.
 */
export function Reveal({ children }: { children: ReactNode }) {
  return (
    <div
      className={useRevealClass()}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "inherit",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

/** The standard screen body: one column, screen gutter, sections stacked. */
export function Screen({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  const reveal = useRevealClass();
  return (
    <div
      className={reveal}
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        gap: 20,
        padding: "8px var(--gutter) 24px",
        flex: 1,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** A titled group. The title is a real heading, below the screen's h1. */
export function Section({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: 10,
        minWidth: 0,
      }}
    >
      {title && (
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            padding: "0 4px",
          }}
        >
          <h2
            style={{
              margin: 0,
              font: "var(--type-overline)",
              letterSpacing: "var(--tracking-wide)",
              textTransform: "uppercase",
              color: "var(--fg-3)",
            }}
          >
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Pushes the screen's final action to the bottom when there is room. */
export function Spacer() {
  return <div style={{ flex: 1, minHeight: 8 }} />;
}

/** A quiet line of explanation under a card. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "0 4px",
        font: "var(--type-caption)",
        color: "var(--fg-3)",
      }}
    >
      {children}
    </p>
  );
}
