import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createDemoClient } from "../../api/demo/demoClient";
import type { OwnwordsClient } from "../../api/client";

const ClientContext = createContext<OwnwordsClient | null>(null);

export interface ClientProviderProps {
  /** Tests and stories pass their own; the app falls back to the demo client. */
  client?: OwnwordsClient;
  children: ReactNode;
}

export function ClientProvider({ client, children }: ClientProviderProps) {
  const value = useMemo(() => client ?? createDemoClient(), [client]);
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
