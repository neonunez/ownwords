import {
  useId,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
} from "react";
import { Icon } from "./Icon";

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "value" | "children"
> {
  /** Shown above the field. Without it, `ariaLabel` names the field. */
  label?: string;
  ariaLabel?: string;
  hint?: string | undefined;
  value: string;
  onChange: (next: string) => void;
  /** `<option>` and `<optgroup>` elements. */
  children: ReactNode;
  ref?: Ref<HTMLSelectElement>;
}

/**
 * A choice from a list, drawn as a field. It is the platform's own select, so
 * a phone opens its native picker, the keyboard and screen readers get the
 * behaviour they already know, and a long list costs no screen space.
 */
export function Select({
  label,
  ariaLabel,
  hint,
  value,
  onChange,
  children,
  style,
  disabled,
  ref,
  ...rest
}: SelectProps) {
  const selectId = useId();
  const hintId = useId();
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0, ...style }}>
      {/* Named by its label alone: a wrapping label would add the chosen
          option to the name, and a screen reader would read it twice. */}
      {label && (
        <label
          htmlFor={selectId}
          style={{
            font: "var(--type-label)",
            color: "var(--fg-2)",
            paddingLeft: 4,
          }}
        >
          {label}
        </label>
      )}
      <span
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          minWidth: 0,
        }}
      >
        <select
          ref={ref}
          id={selectId}
          className="ow-select ow-press-card"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label ? undefined : ariaLabel}
          aria-describedby={hint ? hintId : undefined}
          style={{
            appearance: "none",
            WebkitAppearance: "none",
            width: "100%",
            minWidth: 0,
            minHeight: "var(--control-h)",
            padding: "10px 44px 10px 16px",
            borderRadius: "var(--radius-pill)",
            background: "var(--bg-surface)",
            font: "var(--type-body)",
            color: "var(--fg-1)",
            textOverflow: "ellipsis",
            cursor: disabled ? "default" : "pointer",
            opacity: disabled ? 0.55 : 1,
            transition:
              "border-color var(--motion-fast), box-shadow var(--motion-fast), transform var(--motion-fast) var(--ease-out)",
          }}
          {...rest}
        >
          {children}
        </select>
        <Icon
          name="chevron-down"
          size={18}
          color="var(--fg-3)"
          style={{ position: "absolute", right: 16, pointerEvents: "none" }}
        />
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
    </div>
  );
}
