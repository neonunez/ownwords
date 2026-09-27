import { useEffect, useState, type ReactNode } from "react";
import { Button, Card, Mascot } from "../../design-system";
import { Screen } from "../layout";
import { useCountedLoader } from "../reveal";

/**
 * How long a read may take before the screen says it is reading. A quicker
 * answer replaces the empty body directly, so nothing flashes on the way.
 */
export const LOADING_DELAY_MS = 300;

/**
 * What a screen shows while its first read is in flight: Kip reading inside a
 * turning ring, and the words for what is being read. The ring never fills,
 * because nothing measures how far the read has got.
 */
export function Loading({ label }: { label: string }) {
  return (
    <Screen>
      <LoadingCard label={label} />
    </Screen>
  );
}

/**
 * The same, for a read inside a screen whose other controls stay usable.
 *
 * The status region is there from the first render and stays empty for the
 * delay, so the words are announced once when they arrive, and a quick read
 * announces nothing.
 */
export function LoadingCard({ label }: { label: string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShown(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  useCountedLoader(shown);

  return (
    <div role="status">
      {shown && (
        <Card
          tone="sunken"
          padding={24}
          className="ow-loading"
          style={{ textAlign: "center" }}
        >
          <div className="ow-loading-ring">
            <svg
              className="ow-loading-circle"
              viewBox="0 0 88 88"
              aria-hidden="true"
              focusable="false"
            >
              <circle className="ow-loading-track" cx="44" cy="44" r="41" />
              <circle className="ow-loading-arc" cx="44" cy="44" r="41" />
            </svg>
            <Mascot expression="reading" size={52} eye="var(--bg-sunken)" />
          </div>
          <p
            style={{
              margin: 0,
              font: "var(--type-body)",
              color: "var(--fg-2)",
            }}
          >
            {label}
          </p>
        </Card>
      )}
    </div>
  );
}

/** What a screen shows when a read failed. Nothing is lost, and retry is offered. */
export function Failed({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Screen>
      <Card tone="sunken" padding={24} style={{ textAlign: "center" }}>
        <Mascot
          expression="thinking"
          size={56}
          color="var(--fg-3)"
          style={{ margin: "0 auto 10px" }}
        />
        <p
          style={{
            margin: "0 0 14px",
            font: "var(--type-body)",
            color: "var(--fg-2)",
          }}
        >
          {message}
        </p>
        <Button variant="secondary" icon="rotate-ccw" onClick={onRetry}>
          Try again
        </Button>
      </Card>
    </Screen>
  );
}

/** One line of explanation, and one action. */
export function Empty({
  message,
  children,
  thinking = true,
}: {
  message: string;
  children?: ReactNode;
  thinking?: boolean;
}) {
  return (
    <Card tone="sunken" padding={24} style={{ textAlign: "center" }}>
      {thinking && (
        <Mascot
          expression="thinking"
          size={56}
          color="var(--fg-3)"
          style={{ margin: "0 auto 10px" }}
        />
      )}
      <p style={{ margin: 0, font: "var(--type-body)", color: "var(--fg-2)" }}>
        {message}
      </p>
      {children && (
        <div
          style={{ marginTop: 14, display: "grid", justifyContent: "center" }}
        >
          {children}
        </div>
      )}
    </Card>
  );
}
