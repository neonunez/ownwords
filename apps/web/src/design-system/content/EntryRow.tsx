import type { CSSProperties } from "react";
import { Icon } from "../core/Icon";
import { StateLabel, type StateKind } from "../core/StateLabel";
import { MasteryMeter, type MasteryValue } from "./MasteryMeter";

export interface EntryRowLanguage {
  code: string;
  /** The language's own name, for the meter's written label. */
  name: string;
  recognise: MasteryValue;
  produce: MasteryValue;
}

export interface EntryRowProps {
  headword: string;
  /** The entry's own language tag, so the headword is announced correctly. */
  lang: string;
  note?: string | undefined;
  languages?: readonly EntryRowLanguage[];
  state?: StateKind | undefined;
  onClick: () => void;
  last?: boolean;
  style?: CSSProperties;
}

export function EntryRow({
  headword,
  lang,
  note,
  languages = [],
  state,
  onClick,
  last,
  style,
}: EntryRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ow-row"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "center",
        width: "100%",
        minHeight: "var(--list-row-h)",
        padding: "12px 16px",
        border: 0,
        borderBottom: last ? 0 : "1px solid var(--border-1)",
        background: "transparent",
        color: "inherit",
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        ...style,
      }}
    >
      <span style={{ minWidth: 0, display: "block" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            lang={lang}
            style={{
              font: "var(--type-headword)",
              fontSize: "1.125rem",
              letterSpacing: "var(--tracking-display)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {headword}
          </span>
          {state && <StateLabel state={state} icon={false} />}
        </span>
        {note && (
          <span
            style={{
              display: "block",
              font: "var(--type-caption)",
              color: "var(--fg-3)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {note}
          </span>
        )}
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {languages.map((language) => (
          <span
            key={language.code}
            style={{ display: "grid", gap: 3, justifyItems: "center" }}
          >
            <span
              style={{
                font: "var(--type-overline)",
                fontSize: ".625rem",
                letterSpacing: ".06em",
                color: "var(--fg-3)",
              }}
            >
              {language.code.toUpperCase()}
            </span>
            <MasteryMeter
              recognise={language.recognise}
              produce={language.produce}
              width={22}
              label={`Mastery in ${language.name}`}
            />
          </span>
        ))}
        <Icon name="chevron-right" size={18} color="var(--fg-3)" />
      </span>
    </button>
  );
}
