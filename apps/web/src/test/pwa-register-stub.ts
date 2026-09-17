/**
 * Stands in for `virtual:pwa-register/react` under test. The virtual module
 * only exists when the PWA plugin runs, so the shell can still be rendered
 * without a service worker.
 */
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (value: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (value: boolean) => void],
    updateServiceWorker: async () => {},
  };
}
