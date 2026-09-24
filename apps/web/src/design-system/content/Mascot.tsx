import { useEffect, useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "../../lib/focus";
import "./Mascot.css";

const BODY =
  "M17 22c0-4.4 3.6-8 8-8h14c4.4 0 8 3.6 8 8v33.6c0 1.6-1.7 2.6-3.1 1.7L32 46l-11.9 9.3c-1.4.9-3.1-.1-3.1-1.7Z";

export type MascotExpression = "default" | "happy" | "thinking";

export interface MascotProps {
  expression?: MascotExpression;
  size?: number;
  color?: string;
  /** The knockout colour for the eyes. */
  eye?: string;
  bob?: boolean;
  /** Eye tracking follows the pointer; it is off when motion is reduced. */
  interactive?: boolean;
  style?: CSSProperties;
}

/** The brand mark, drawn rather than fetched, and always decorative. */
export function Mascot({
  expression = "default",
  size = 64,
  color = "var(--accent)",
  eye = "var(--bg-surface)",
  bob = false,
  interactive = true,
  style,
}: MascotProps) {
  const happy = expression === "happy";
  const thinking = expression === "thinking";
  const ref = useRef<SVGSVGElement>(null);
  const [look, setLook] = useState<[number, number]>([0, 0]);
  const track = interactive && !thinking;

  const tracking = track && !prefersReducedMotion();
  const offset = tracking ? look : ([0, 0] as const);

  useEffect(() => {
    if (!tracking) return;
    const clamp = (value: number, max: number) =>
      Math.max(-max, Math.min(max, value * max * 2.4));
    const onMove = (event: PointerEvent) => {
      const element = ref.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      if (!box.width) return;
      setLook([
        clamp((event.clientX - (box.left + box.width / 2)) / box.width, 2.2),
        clamp(
          (event.clientY - (box.top + box.height * 0.46)) / box.height,
          1.5,
        ),
      ]);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [tracking]);

  const className = [
    "ow-kip",
    bob ? "ow-kip-bob" : "",
    happy ? "ow-kip-happy" : "",
    thinking ? "ow-kip-think" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const eyes = happy ? (
    <g className="ow-kip-joy">
      <path
        d="M22.9 31.4c1.3-2.7 4.9-2.7 6.2 0"
        stroke={eye}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M34.9 31.4c1.3-2.7 4.9-2.7 6.2 0"
        stroke={eye}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </g>
  ) : (
    <g className="ow-kip-blink">
      <circle cx="26" cy="30" r="3.3" fill={eye} />
      <circle cx="38" cy="30" r="3.3" fill={eye} />
    </g>
  );

  return (
    <svg
      ref={ref}
      className={className}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <g className="ow-kip-body">
        <path d={BODY} fill={color} />
        <path
          className="ow-kip-acute"
          d="M32 9 41 4.2"
          stroke={color}
          strokeWidth="4.4"
          strokeLinecap="round"
        />
        <g
          className={thinking ? "ow-kip-eyes ow-kip-look" : "ow-kip-eyes"}
          style={
            thinking
              ? undefined
              : { transform: `translate(${offset[0]}px, ${offset[1]}px)` }
          }
        >
          {eyes}
        </g>
        {happy && (
          <g>
            <circle
              className="ow-kip-spark"
              cx="12.5"
              cy="19"
              r="1.9"
              fill={color}
            />
            <circle
              className="ow-kip-spark"
              cx="52"
              cy="15.5"
              r="1.4"
              fill={color}
              style={{ animationDelay: "520ms" }}
            />
            <circle
              className="ow-kip-spark"
              cx="49"
              cy="38"
              r="1.2"
              fill={color}
              style={{ animationDelay: "880ms" }}
            />
          </g>
        )}
        {thinking && (
          <g>
            <circle
              className="ow-kip-spark"
              cx="50"
              cy="16"
              r="1.5"
              fill={color}
              style={{ animationDuration: "1.8s" }}
            />
            <circle
              className="ow-kip-spark"
              cx="55"
              cy="10"
              r="1"
              fill={color}
              style={{ animationDuration: "1.8s", animationDelay: "300ms" }}
            />
          </g>
        )}
      </g>
    </svg>
  );
}
