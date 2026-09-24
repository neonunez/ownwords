import { Icon, type IconName } from "../core/Icon";

export interface ToastProps {
  text: string;
  icon?: IconName | undefined;
  action?: string | undefined;
  onAction?: (() => void) | undefined;
  tone?: "inverse" | "accent";
}

/**
 * A short written confirmation. It is a live region, so what happened is
 * announced without moving focus away from what the person was doing.
 */
export function Toast({
  text,
  icon,
  action,
  onAction,
  tone = "inverse",
}: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        minHeight: 48,
        padding: "8px 10px 8px 16px",
        borderRadius: "var(--radius-pill)",
        background: tone === "accent" ? "var(--accent)" : "var(--bg-inverse)",
        color: tone === "accent" ? "var(--fg-on-accent)" : "var(--fg-inverse)",
        boxShadow: "var(--shadow-2)",
        font: "var(--type-body)",
        fontSize: ".9375rem",
        maxWidth: 360,
        pointerEvents: "auto",
      }}
    >
      {icon && <Icon name={icon} size={18} />}
      <span style={{ flex: 1 }}>{text}</span>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="ow-press"
          style={{
            border: 0,
            background: "oklch(100% 0 0/.14)",
            color: "inherit",
            font: "var(--type-label)",
            minHeight: 44,
            padding: "0 14px",
            borderRadius: 99,
            cursor: "pointer",
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}
