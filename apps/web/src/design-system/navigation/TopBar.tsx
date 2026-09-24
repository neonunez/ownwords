import type { ReactNode } from "react";
import { IconButton } from "../core/IconButton";

export interface TopBarProps {
  title: string;
  /** A root screen sets its title large, below the bar. */
  large?: boolean;
  /** Written above or below the title: "Maintain", "Learn · Русский". */
  mode?: string;
  onMenu?: () => void;
  onBack?: () => void;
  backLabel?: string;
  trailing?: ReactNode;
}

/**
 * The bar at the head of every screen. It carries the screen's only h1, so a
 * pushed screen and a root screen both announce themselves once.
 */
export function TopBar({
  title,
  large,
  mode,
  onMenu,
  onBack,
  backLabel = "Back",
  trailing,
}: TopBarProps) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        paddingTop: "var(--safe-top)",
        background: "var(--topbar-bg)",
        backdropFilter: "var(--blur-bar)",
        WebkitBackdropFilter: "var(--blur-bar)",
      }}
    >
      <div
        style={{
          height: "var(--topbar-h)",
          display: "grid",
          gridTemplateColumns: "44px 1fr 44px",
          alignItems: "center",
          padding: "0 8px",
        }}
      >
        {onBack ? (
          <IconButton name="chevron-left" label={backLabel} onClick={onBack} />
        ) : onMenu ? (
          <IconButton
            name="menu"
            label="Open the side panel"
            onClick={onMenu}
          />
        ) : (
          <span />
        )}
        <div style={{ textAlign: "center", minWidth: 0 }}>
          {!large && (
            <h1
              style={{
                margin: 0,
                font: "var(--type-label)",
                fontSize: "1rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </h1>
          )}
          {mode && (
            <p
              style={{
                margin: large ? 0 : "2px 0 0",
                font: "var(--type-overline)",
                letterSpacing: "var(--tracking-wide)",
                textTransform: "uppercase",
                color: "var(--fg-3)",
              }}
            >
              {mode}
            </p>
          )}
        </div>
        {trailing ?? <span />}
      </div>
      {large && (
        <h1
          style={{
            margin: 0,
            padding: "2px var(--gutter) 10px",
            font: "var(--type-title)",
            color: "var(--fg-1)",
          }}
        >
          {title}
        </h1>
      )}
    </header>
  );
}
