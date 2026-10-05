import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Appearance = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "ownwords.appearance";

/** `--bg-app` in each theme, for the bars the browser paints around the app. */
const themeColors: Record<ResolvedTheme, string> = {
  light: "#f8f8f8",
  dark: "#0a0a0a",
};

interface ThemeValue {
  appearance: Appearance;
  theme: ResolvedTheme;
  setAppearance: (next: Appearance) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function readStored(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system")
      return stored;
  } catch {
    // Private browsing can refuse storage; the system setting still applies.
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  return typeof matchMedia === "function" &&
    matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Appearance follows the system unless the person chooses otherwise, and the
 * choice is remembered. The resolved theme drives `data-theme` on the document
 * and the `theme-color` the installed window paints its bars with.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setStoredAppearance] = useState<Appearance>(readStored);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const theme: ResolvedTheme = appearance === "system" ? system : appearance;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    // The document carries one theme-color per scheme, keyed by `media`, so
    // the bars match before this runs. Following the system, each keeps its
    // own scheme's colour; a chosen appearance paints both with that one,
    // since the system scheme no longer says which the app is showing.
    for (const meta of document.querySelectorAll<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )) {
      const scheme =
        appearance === "system"
          ? meta.media.includes("dark")
            ? "dark"
            : meta.media.includes("light")
              ? "light"
              : theme
          : theme;
      meta.content = themeColors[scheme];
    }
  }, [appearance, theme]);

  const setAppearance = useCallback((next: Appearance) => {
    setStoredAppearance(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Nothing is lost: the choice still applies for this session.
    }
  }, []);

  const value = useMemo(
    () => ({ appearance, theme, setAppearance }),
    [appearance, theme, setAppearance],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside a ThemeProvider.");
  return value;
}
