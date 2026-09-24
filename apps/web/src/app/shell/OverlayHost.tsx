import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Sheet, type SheetProps } from "../../design-system";

interface OverlayValue {
  host: HTMLDivElement | null;
  /** True while any overlay is open, so the shell can seal off what is behind. */
  locked: boolean;
  lock: () => void;
  unlock: () => void;
}

const OverlayContext = createContext<OverlayValue | null>(null);

export function useOverlayHost(): OverlayValue {
  const value = useContext(OverlayContext);
  if (!value)
    throw new Error("Overlays must be rendered inside the app shell.");
  return value;
}

export function OverlayProvider({
  host,
  children,
}: {
  host: HTMLDivElement | null;
  children: ReactNode;
}) {
  const [count, setCount] = useState(0);
  const lock = useCallback(() => setCount((value) => value + 1), []);
  const unlock = useCallback(
    () => setCount((value) => Math.max(0, value - 1)),
    [],
  );
  const value = useMemo(
    () => ({ host, locked: count > 0, lock, unlock }),
    [host, count, lock, unlock],
  );
  return (
    <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>
  );
}

/**
 * A sheet raised above the whole app frame rather than inside the scrolling
 * screen, so everything behind it is unreachable while it is open.
 */
export function AppSheet(props: SheetProps) {
  const { host, lock, unlock } = useOverlayHost();
  const { open } = props;

  useEffect(() => {
    if (!open) return;
    lock();
    return unlock;
  }, [open, lock, unlock]);

  if (!host) return null;
  return createPortal(<Sheet {...props} />, host);
}

/**
 * Renders at the app-frame level rather than inside the scrolling screen, for
 * things that must stay put while the screen moves under them. It does not
 * seal off the screen: use `AppSheet` for anything modal.
 */
export function FrameLayer({ children }: { children: ReactNode }) {
  const { host } = useOverlayHost();
  if (!host) return null;
  return createPortal(children, host);
}
