import { useId, type CSSProperties, type Ref } from "react";

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

export interface ChoiceGroupProps<T extends string> {
  /** Names the group for assistive technology: "How well you speak Español". */
  label: string;
  options: readonly ChoiceOption<T>[];
  /** `null` until the person has chosen; nothing is chosen for them. */
  value: T | null;
  onChange: (next: T) => void;
  /** Written help for the group, read after its name. */
  describedBy?: string;
  /** The first option's input, for moving focus into the group. */
  firstRef?: Ref<HTMLInputElement>;
  style?: CSSProperties;
}

/**
 * One choice among a few short options, drawn as pills that wrap onto a new
 * line rather than shrink. Underneath it is a fieldset of real radio inputs,
 * so arrow keys move the choice, the group announces its name, and it can
 * start with nothing chosen. Each input covers its whole 44px pill.
 * Selection inverts to ink, as a chip's does.
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  describedBy,
  firstRef,
  style,
}: ChoiceGroupProps<T>) {
  const name = useId();
  return (
    <fieldset
      aria-describedby={describedBy}
      style={{ border: 0, margin: 0, padding: 0, minWidth: 0, ...style }}
    >
      <legend className="ow-visually-hidden">{label}</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map((option, index) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              className="ow-choice ow-press-chip"
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                minWidth: 44,
                minHeight: 44,
                cursor: "pointer",
              }}
            >
              <input
                ref={index === 0 ? firstRef : undefined}
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  margin: 0,
                  opacity: 0,
                  cursor: "pointer",
                }}
              />
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 32,
                  padding: "0 14px",
                  borderRadius: "var(--radius-pill)",
                  border: `1px solid ${checked ? "transparent" : "var(--border-1)"}`,
                  background: checked ? "var(--fg-1)" : "var(--bg-surface)",
                  color: checked ? "var(--fg-inverse)" : "var(--fg-1)",
                  font: "var(--type-label)",
                  fontSize: ".875rem",
                  whiteSpace: "nowrap",
                  pointerEvents: "none",
                  transition:
                    "background var(--motion-fast), color var(--motion-fast)",
                }}
              >
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
