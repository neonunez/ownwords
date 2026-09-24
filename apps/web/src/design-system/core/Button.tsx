import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant =
  "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: "var(--accent)",
    color: "var(--fg-on-accent)",
    border: "1px solid transparent",
  },
  secondary: {
    background: "var(--accent-soft)",
    color: "var(--accent-soft-fg)",
    border: "1px solid transparent",
  },
  outline: {
    background: "transparent",
    color: "var(--fg-1)",
    border: "1px solid var(--border-2)",
  },
  ghost: {
    background: "transparent",
    color: "var(--fg-1)",
    border: "1px solid transparent",
  },
  danger: {
    background: "var(--state-failed-soft)",
    color: "var(--state-failed)",
    border: "1px solid transparent",
  },
};

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  full?: boolean;
  children: ReactNode;
}

/**
 * Every button is a real button: focusable, operable from the keyboard and at
 * least 44px tall, which is the product's minimum target. Only the text and
 * padding shrink at `sm`.
 */
export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  full,
  disabled,
  children,
  style,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const height = size === "lg" ? "var(--control-h-lg)" : "var(--control-h)";
  const fontSize =
    size === "lg" ? "1.0625rem" : size === "sm" ? ".875rem" : ".9375rem";
  return (
    <button
      type={type}
      disabled={disabled}
      className={["ow-btn", "ow-press", className].filter(Boolean).join(" ")}
      data-variant={variant}
      style={{
        ...variants[variant],
        height,
        minHeight: height,
        padding: size === "sm" ? "0 14px" : "0 20px",
        boxSizing: "border-box",
        borderRadius: "var(--radius-pill)",
        font: "var(--type-label)",
        fontSize,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: full ? "100%" : undefined,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 16 : 18} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === "sm" ? 16 : 18} />}
    </button>
  );
}
