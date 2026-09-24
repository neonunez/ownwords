import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
} from "react";

export type CardTone = "surface" | "sunken" | "soft" | "accent" | "inverse";

const backgrounds: Record<CardTone, string> = {
  surface: "var(--bg-surface)",
  sunken: "var(--bg-sunken)",
  soft: "var(--accent-soft)",
  accent: "var(--accent)",
  inverse: "var(--bg-inverse)",
};

const foregrounds: Record<CardTone, string> = {
  surface: "var(--fg-1)",
  sunken: "var(--fg-1)",
  soft: "var(--fg-1)",
  accent: "var(--fg-on-accent)",
  inverse: "var(--fg-inverse)",
};

interface CommonProps {
  tone?: CardTone;
  padding?: number;
  children: ReactNode;
  style?: CSSProperties;
}

type StaticCardProps = CommonProps &
  Omit<HTMLAttributes<HTMLDivElement>, "style" | "children"> & {
    onClick?: undefined;
  };

type ActionCardProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "children"> & {
    onClick: NonNullable<ButtonHTMLAttributes<HTMLButtonElement>["onClick"]>;
  };

export type CardProps = StaticCardProps | ActionCardProps;

/** A card is a real button when it does something, and a plain box when it does not. */
export function Card({
  tone = "surface",
  padding = 16,
  onClick,
  children,
  style,
  ...rest
}: CardProps) {
  const shared: CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "left",
    padding,
    borderRadius: "var(--radius-lg)",
    background: backgrounds[tone],
    color: foregrounds[tone],
    border:
      tone === "surface"
        ? "1px solid var(--border-1)"
        : "1px solid transparent",
    boxShadow: tone === "surface" ? "var(--shadow-1)" : "none",
    font: "inherit",
    ...style,
  };

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="ow-press-card"
        style={{ ...shared, cursor: "pointer" }}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }

  return (
    <div style={shared} {...(rest as HTMLAttributes<HTMLDivElement>)}>
      {children}
    </div>
  );
}
