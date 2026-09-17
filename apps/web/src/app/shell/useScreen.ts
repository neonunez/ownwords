import { useOutletContext } from 'react-router-dom';

export interface ScreenContext {
  /** Opens the side panel from a root screen's top bar. */
  openPanel: () => void;
}

export function useScreen(): ScreenContext {
  return useOutletContext<ScreenContext>();
}
