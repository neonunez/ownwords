import type { CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";
import type { Fit, TranslationState } from "../../api/types";

/** Every state the collection can show, always written in words. */
export type StateKind = Fit | TranslationState | "unverified";

const text: Record<StateKind, [label: string, icon: IconName]> = {
  confirmed: ["confirmed", "check"],
  exact: ["exact", "check"],
  broader: ["broader", "maximize-2"],
  narrower: ["narrower", "minimize-2"],
  "context-only": ["context-only", "info"],
  "false-friend": ["false friend", "ban"],
  waiting: ["waiting", "loader"],
  failed: ["failed", "alert-circle"],
  suggested: ["suggested", "sparkles"],
  unverified: ["unverified", "circle-dashed"],
  manual: ["typed by hand", "pencil"],
};

const tone: Record<StateKind, string> = {
  confirmed: "confirmed",
  exact: "confirmed",
  broader: "waiting",
  narrower: "waiting",
  "context-only": "suggested",
  "false-friend": "false-friend",
  waiting: "waiting",
  failed: "failed",
  suggested: "suggested",
  unverified: "suggested",
  manual: "confirmed",
};

export interface StateLabelProps {
  state: StateKind;
  /** Overrides the written label; the words are never dropped. */
  text?: string;
  icon?: boolean;
  style?: CSSProperties;
}

/**
 * Colour reinforces the state; it never carries it alone. The label always
 * renders its words, so the meaning survives greyscale and screen readers.
 */
export function StateLabel({
  state,
  text: override,
  icon = true,
  style,
}: StateLabelProps) {
  const [label, iconName] = text[state] ?? [state, "circle"];
  const kind = tone[state] ?? "suggested";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        minHeight: 22,
        padding: "2px 8px",
        borderRadius: "var(--radius-pill)",
        background: `var(--state-${kind}-soft)`,
        color: `var(--state-${kind})`,
        font: "var(--type-caption)",
        fontWeight: 600,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {icon && <Icon name={iconName} size={12} strokeWidth={2.2} />}
      {override ?? label}
    </span>
  );
}
