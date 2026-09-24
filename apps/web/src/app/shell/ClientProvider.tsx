import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createHttpClient } from "../../api/http/httpClient";
import type { OwnwordsClient } from "../../api/client";

const ClientContext = createContext<OwnwordsClient | null>(null);

/**
 * A preview built on purpose in Vite's `demo` mode (`npm run dev:demo`,
 * `npm run build:demo`) answers from sample data and keeps nothing. Every
 * other build talks to the Ownwords API and never falls back to the sample
 * data, even when the API cannot be reached: a screen then says so and
 * offers to try again.
 */
export const DEMO_BUILD = import.meta.env.MODE === "demo";

export interface ClientProviderProps {
  /** Tests pass their own; the app builds its client from how it was built. */
  client?: OwnwordsClient;
  children: ReactNode;
}

export function ClientProvider({ client, children }: ClientProviderProps) {
  const [built, setBuilt] = useState<OwnwordsClient | null>(() =>
    client || DEMO_BUILD ? null : createHttpClient(),
  );

  useEffect(() => {
    if (client || !DEMO_BUILD) return;
    let live = true;
    // Only a demo build ever loads the sample data.
    void import("../../api/demo/demoClient").then(({ createDemoClient }) => {
      if (live) setBuilt(createDemoClient());
    });
    return () => {
      live = false;
    };
  }, [client]);

  const value = client ?? built;
  if (!value) return null;
  return (
    <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
  );
}

export function useClient(): OwnwordsClient {
  const client = useContext(ClientContext);
  if (!client)
    throw new Error("useClient must be used inside a ClientProvider.");
  return client;
}
