import type { CSSProperties } from "react";
import { asPercentage } from "../../lib/text";

export interface MasteryMeterProps {
  /** 0–1, or `null` when the direction has not been practised yet. */
  recognise: number | null;
  produce: number | null;
  /** The bar's width. Ignored when `labels` is set: the bar then fills its row. */
  width?: number;
  /** Writes "recognise" and "produce" beside each bar. */
  labels?: boolean;
  /** Names what the meter measures: "Mastery in Español". */
  label: string;
  style?: CSSProperties;
}

const colourFor = (value: number | null): string => {
  if (value === null || value <= 0) return "var(--mastery-empty)";
  if (value < 0.34) return "var(--mastery-weak)";
  if (value < 0.67) return "var(--mastery-mid)";
  return "var(--mastery-strong)";
};

const written = (value: number | null): string =>
  value === null ? "not practised yet" : asPercentage(value);

/**
 * Two bars, one per direction. The reading is written out in the accessible
 * name as well as drawn, because colour and length never carry state alone.
 */
export function MasteryMeter({
  recognise,
  produce,
  width = 28,
  labels,
  label,
  style,
}: MasteryMeterProps) {
  const bar = (value: number | null, name: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }} key={name}>
      {labels && (
        <span
          style={{
            font: "var(--type-caption)",
            color: "var(--fg-3)",
            width: 60,
            flex: "none",
          }}
        >
          {name}
        </span>
      )}
      <div
        style={{
          width: labels ? undefined : width,
          flex: labels ? 1 : undefined,
          minWidth: 0,
          height: 5,
          borderRadius: 99,
          background: "var(--mastery-empty)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round((value ?? 0) * 100)}%`,
            height: "100%",
            borderRadius: 99,
            background: colourFor(value),
            transition: "width var(--motion-slow) var(--ease-out)",
          }}
        />
      </div>
      {labels && (
        <span
          style={{
            font: "var(--type-caption)",
            color: "var(--fg-2)",
            width: 96,
            flex: "none",
            textAlign: "right",
          }}
        >
          {written(value)}
        </span>
      )}
    </div>
  );

  return (
    <div
      role="img"
      aria-label={`${label}: recognise ${written(recognise)}, produce ${written(produce)}`}
      style={{ display: "grid", gap: 3, ...style }}
    >
      {bar(recognise, "recognise")}
      {bar(produce, "produce")}
    </div>
  );
}
