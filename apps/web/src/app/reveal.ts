import { createContext, useContext, useEffect, useState } from "react";

/**
 * The loading cards showing in one screen frame right now. A frame is one
 * route's screen (or the gate's), so a new route starts with none.
 */
export class Loaders {
  private count = 0;

  /** Counts one card in; the returned function counts it out. */
  show(): () => void {
    this.count += 1;
    return () => {
      this.count -= 1;
    };
  }

  get showing(): boolean {
    return this.count > 0;
  }
}

export const LoadersContext = createContext<Loaders | null>(null);

/** Counts a loading card in its frame for as long as it is `shown`. */
export function useCountedLoader(shown: boolean): void {
  const loaders = useContext(LoadersContext);
  useEffect(() => {
    if (!shown || !loaders) return;
    return loaders.show();
  }, [shown, loaders]);
}

/**
 * `ow-reveal` for content that mounts in place of a loading card the person
 * has seen, so what was read eases in the way a screen does when it opens.
 *
 * Decided once, when the content mounts: the card it replaces goes in the same
 * commit, so its count is still there to read. Anything mounting later, a
 * quick read, and every update after the first are left alone.
 */
export function useRevealClass(): string | undefined {
  const loaders = useContext(LoadersContext);
  const [reveal] = useState(() => loaders?.showing ?? false);
  return reveal ? "ow-reveal" : undefined;
}
