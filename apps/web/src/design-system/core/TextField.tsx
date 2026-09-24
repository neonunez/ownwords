import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement & HTMLTextAreaElement>,
  "onChange" | "size"
> {
  label?: string;
  hint?: string;
  value: string;
  onChange?: (next: string) => void;
  icon?: IconName;
  trailing?: ReactNode;
  multiline?: boolean;
  /** Words the person owns are set in the display face, not the UI face. */
  display?: boolean;
  size?: "md" | "lg";
  /** Used when no visible label is present. */
  ariaLabel?: string;
}

export function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  icon,
  trailing,
  multiline,
  display,
  size = "md",
  style,
  ariaLabel,
  ...rest
}: TextFieldProps) {
  const hintId = useId();
  const height = size === "lg" ? "var(--control-h-lg)" : "var(--control-h)";
  const Field = multiline ? "textarea" : "input";
  return (
    <label style={{ display: "grid", gap: 6, ...style }}>
      {label && (
        <span
          style={{
            font: "var(--type-label)",
            color: "var(--fg-2)",
            paddingLeft: 4,
          }}
        >
          {label}
        </span>
      )}
      <span
        className="ow-field"
        style={{
          display: "flex",
          alignItems: multiline ? "flex-start" : "center",
          gap: 10,
          minHeight: height,
          padding: multiline ? "12px 16px" : "0 16px",
          borderRadius: multiline ? "var(--radius-lg)" : "var(--radius-pill)",
          background: "var(--bg-surface)",
          border: "1px solid var(--border-1)",
          transition:
            "border-color var(--motion-fast), box-shadow var(--motion-fast)",
        }}
      >
        {icon && <Icon name={icon} size={18} color="var(--fg-3)" />}
        <Field
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
          rows={multiline ? 3 : undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-describedby={hint ? hintId : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: "none",
            background: "transparent",
            padding: multiline ? 0 : "10px 0",
            font: display
              ? "500 1.25rem/1.3 var(--font-display)"
              : "var(--type-body)",
            letterSpacing: display ? "var(--tracking-display)" : undefined,
            color: "var(--fg-1)",
            resize: "none",
          }}
          {...rest}
        />
        {trailing}
      </span>
      {hint && (
        <span
          id={hintId}
          style={{
            font: "var(--type-caption)",
            color: "var(--fg-3)",
            paddingLeft: 4,
          }}
        >
          {hint}
        </span>
      )}
    </label>
  );
}
