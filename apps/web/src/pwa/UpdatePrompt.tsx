import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useToast } from '../app/shell/ToastProvider';

/** How often a running app looks for a newer build: once an hour. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Keeps an installed copy of Ownwords from sitting on a stale shell.
 *
 * A new build never takes over silently in the middle of a practice session.
 * Instead the app says a new version is ready and offers to reload, and it
 * asks the service worker again every hour so the offer cannot be missed for
 * long. Accepting activates the waiting worker and reloads once.
 */
export function UpdatePrompt() {
  const { showToast } = useToast();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        void registration.update();
      }, CHECK_INTERVAL_MS);
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    showToast('A new version of Ownwords is ready.', {
      icon: 'sparkles',
      action: 'Reload',
      persistent: true,
      onAction: () => {
        setNeedRefresh(false);
        void updateServiceWorker(true);
      },
    });
  }, [needRefresh, showToast, setNeedRefresh, updateServiceWorker]);

  return null;
}
