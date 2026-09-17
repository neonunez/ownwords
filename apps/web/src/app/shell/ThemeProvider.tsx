import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Appearance = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'ownwords.appearance';

interface ThemeValue {
  appearance: Appearance;
  theme: ResolvedTheme;
  setAppearance: (next: Appearance) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function readStored(): Appearance {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // Private browsing can refuse storage; the system setting still applies.
  }
  return 'system';
}

function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
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
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystem(query.matches ? 'dark' : 'light');
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const theme: ResolvedTheme = appearance === 'system' ? system : appearance;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'dark' ? '#0a0a0a' : '#f8f8f8';
  }, [theme]);

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

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside a ThemeProvider.');
  return value;
}
