export interface SwitchProps {
  checked: boolean;
  onChange?: (next: boolean) => void;
  /** The control's name, read out with its on or off state. */
  label: string;
  disabled?: boolean;
  /** Connects the switch to text that already names it on screen. */
  labelledBy?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  labelledBy,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      {...(labelledBy
        ? { "aria-labelledby": labelledBy }
        : { "aria-label": label })}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      style={{
        width: 58,
        height: 44,
        minHeight: 44,
        padding: "6px 3px",
        border: 0,
        borderRadius: "var(--radius-pill)",
        background: "transparent",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "block",
        flex: "none",
      }}
    >
      <span
        style={{
          display: "block",
          width: 52,
          height: 32,
          padding: 3,
          borderRadius: 99,
          background: checked ? "var(--accent)" : "var(--neutral-300)",
          transition: "background var(--motion-base) var(--ease-out)",
        }}
      >
        <span
          style={{
            display: "block",
            width: 26,
            height: 26,
            borderRadius: 99,
            background: "#fff",
            boxShadow: "0 1px 3px oklch(0 0 0/.25)",
            transform: checked ? "translateX(20px)" : "none",
            transition: "transform var(--motion-base) var(--ease-spring)",
          }}
        />
      </span>
    </button>
  );
}
