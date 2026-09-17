import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Toast } from '../../design-system';
import type { IconName } from '../../design-system';

export interface ToastOptions {
  icon?: IconName;
  action?: string;
  onAction?: () => void;
  /** A message that needs a decision stays until it is acted on. */
  persistent?: boolean;
}

interface ToastValue {
  showToast: (text: string, options?: ToastOptions) => void;
  dismissToast: () => void;
}

const ToastContext = createContext<ToastValue | null>(null);

interface ActiveToast extends ToastOptions {
  text: string;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ActiveToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback(
    (text: string, options: ToastOptions = {}) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ text, ...options });
      if (!options.persistent) {
        timer.current = setTimeout(() => setToast(null), 3600);
      }
    },
    [],
  );

  const value = useMemo(() => ({ showToast, dismissToast }), [showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          // Clear of the floating action, which sits in the corner just above
          // the tab bar: a toast that waits for an answer must not cover it.
          bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 84px)',
          display: 'grid',
          justifyContent: 'center',
          padding: '0 var(--gutter)',
          pointerEvents: 'none',
          zIndex: 35,
          transform: toast ? 'none' : 'translateY(16px)',
          opacity: toast ? 1 : 0,
          transition: 'transform var(--motion-base) var(--ease-spring), opacity var(--motion-base)',
        }}
      >
        {toast && (
          <Toast
            text={toast.text}
            icon={toast.icon}
            action={toast.action}
            onAction={() => {
              toast.onAction?.();
              dismissToast();
            }}
          />
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside a ToastProvider.');
  return value;
}
