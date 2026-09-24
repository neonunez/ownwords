import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "./Icon";

export type IconButtonVariant = "ghost" | "tonal" | "filled";

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> {
  name: IconName;
  /** Required: an icon alone never explains itself. */
  label: string;
  variant?: IconButtonVariant;
  size?: number;
  active?: boolean;
  badge?: boolean;
}

export function IconButton({
  name,
  label,
  variant = "ghost",
  size = 44,
  active,
  badge,
  style,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  const background =
    variant === "filled"
      ? "var(--accent)"
      : variant === "tonal"
        ? "var(--bg-sunken)"
        : active
          ? "var(--accent-soft)"
          : "transparent";
  const foreground =
    variant === "filled"
      ? "var(--fg-on-accent)"
      : active
        ? "var(--accent-soft-fg)"
        : "var(--fg-1)";
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={["ow-press-icon", className].filter(Boolean).join(" ")}
      style={{
        width: size,
        height: size,
        minWidth: 44,
        minHeight: 44,
        border: 0,
        borderRadius: "var(--radius-pill)",
        background,
        color: foreground,
        display: "inline-grid",
        placeItems: "center",
        cursor: "pointer",
        position: "relative",
        ...style,
      }}
      {...rest}
    >
      <Icon name={name} size={Math.min(22, Math.round(size * 0.5))} />
      {badge && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            minWidth: 8,
            height: 8,
            borderRadius: 99,
            background: "var(--accent)",
            border: "2px solid var(--bg-app)",
          }}
        />
      )}
    </button>
  );
}
