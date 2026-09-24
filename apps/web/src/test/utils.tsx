import type { ReactElement, ReactNode } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { ClientProvider } from "../app/shell/ClientProvider";
import { ThemeProvider } from "../app/shell/ThemeProvider";
import { ToastProvider } from "../app/shell/ToastProvider";
import { OverlayProvider } from "../app/shell/OverlayHost";
import {
  createDemoClient,
  type DemoClientOptions,
} from "../api/demo/demoClient";
import type { OwnwordsClient } from "../api/client";

export interface RenderOptions {
  /** The location the screen is rendered at, so route params resolve. */
  route?: string;
  /** The path pattern the screen is mounted on. Defaults to `route`. */
  path?: string;
  client?: OwnwordsClient;
  demo?: DemoClientOptions;
}

function Providers({
  client,
  children,
}: {
  client: OwnwordsClient;
  children: ReactNode;
}) {
  return (
    <ThemeProvider>
      <ClientProvider client={client}>
        <OverlayProvider host={document.body as HTMLDivElement}>
          <ToastProvider>{children}</ToastProvider>
        </OverlayProvider>
      </ClientProvider>
    </ThemeProvider>
  );
}

/** Renders one screen inside the shell's providers and a router. */
export function renderScreen(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult {
  const route = options.route ?? "/";
  const path = options.path ?? route;
  const client =
    options.client ??
    createDemoClient({ suggestionDelaysMs: {}, ...options.demo });
  return render(
    <Providers client={client}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route element={<Outlet context={{ openPanel: () => {} }} />}>
            <Route path={path} element={ui} />
            <Route path="*" element={<p>Somewhere else</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </Providers>,
  );
}

/** Renders a design-system component with nothing around it but the providers. */
export function renderComponent(ui: ReactElement): RenderResult {
  return render(ui);
}
