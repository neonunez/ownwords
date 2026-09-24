import { RouterProvider } from "react-router-dom";
import { router } from "./app/routes";
import { ClientProvider } from "./app/shell/ClientProvider";
import { ThemeProvider } from "./app/shell/ThemeProvider";
import { SessionGate } from "./app/session/SessionGate";

export function App() {
  return (
    <ThemeProvider>
      <ClientProvider>
        <SessionGate>
          <RouterProvider router={router} />
        </SessionGate>
      </ClientProvider>
    </ThemeProvider>
  );
}
