import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { routeTree } from "../routes";
import { ClientProvider } from "../shell/ClientProvider";
import { ThemeProvider } from "../shell/ThemeProvider";
import { SessionGate } from "../session/SessionGate";
import { createDemoClient } from "../../api/demo/demoClient";
import type { OwnwordsClient } from "../../api/client";

/** A signed-in client that behaves like the connected app, not the demo. */
function connectedClient(): OwnwordsClient {
  const demo = createDemoClient({ suggestionDelaysMs: {} });
  return {
    ...demo,
    kind: "http",
    addPasskey: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    savePreferences: vi.fn(demo.savePreferences),
    saveOnboarding: vi.fn(demo.saveOnboarding),
  };
}

function renderApp(client: OwnwordsClient, entries: string[]) {
  const router = createMemoryRouter(routeTree, { initialEntries: entries });
  render(
    <ThemeProvider>
      <ClientProvider client={client}>
        <SessionGate>
          <RouterProvider router={router} />
        </SessionGate>
      </ClientProvider>
    </ThemeProvider>,
  );
  return router;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Settings", () => {
  it("gathers the languages, preferences, data and sign-in on one page", async () => {
    renderApp(connectedClient(), ["/maintain/settings"]);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByText("demo@ownwords.invalid")).toBeInTheDocument();

    const languages = await screen.findByRole("list", {
      name: "Your languages",
    });
    expect(within(languages).getByText("Русский")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change languages" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("switch", { name: "Suggest translations" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Explanations in" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radiogroup", { name: "Appearance" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export my data" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add a passkey on this device" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    // The course ships no recordings, so there is no audio preference to set.
    expect(screen.queryByText(/audio/i)).not.toBeInTheDocument();
  });

  it("keeps the tab bar it was opened from, with no tab lit", async () => {
    renderApp(connectedClient(), ["/learn/settings"]);
    const bar = await screen.findByRole("navigation", { name: "Learn" });
    expect(
      within(bar)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current")),
    ).toEqual([]);
  });

  it("saves a changed preference", async () => {
    const client = connectedClient();
    renderApp(client, ["/maintain/settings"]);
    const suggest = await screen.findByRole("switch", {
      name: "Suggest translations",
    });
    await waitFor(() => expect(suggest).toBeEnabled());
    await userEvent.click(suggest);
    await waitFor(() =>
      expect(client.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ suggestTranslations: false }),
      ),
    );

    await userEvent.click(screen.getByRole("radio", { name: "Español" }));
    await waitFor(() =>
      expect(client.savePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          explanationsIn: "es",
          suggestTranslations: false,
        }),
      ),
    );
    expect(screen.getByRole("radio", { name: "Español" })).toBeChecked();
  });

  it("follows the system until an appearance is chosen, then remembers it", async () => {
    renderApp(connectedClient(), ["/maintain/settings"]);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await userEvent.click(await screen.findByRole("radio", { name: "Dark" }));
    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );
    expect(localStorage.getItem("ownwords.appearance")).toBe("dark");
  });

  it("exports the account as a file", async () => {
    const create = vi.fn(() => "blob:export");
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    renderApp(connectedClient(), ["/maintain/settings"]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Export my data" }),
    );
    expect(
      await screen.findByText("Your data is saved as a file."),
    ).toBeInTheDocument();
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
  });

  it("adds a passkey, and signs out to the sign-in screen", async () => {
    const client = connectedClient();
    const router = renderApp(client, ["/maintain/progress", "/learn/settings"]);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Add a passkey on this device",
      }),
    );
    expect(
      await screen.findByText("Passkey added. Next time, sign in with it."),
    ).toBeInTheDocument();
    expect(client.addPasskey).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeInTheDocument();
    expect(client.signOut).toHaveBeenCalledOnce();
    // The next sign-in opens on the mode's home, not on Settings.
    expect(router.state.location.pathname).toBe("/learn/course");
  });

  it("opens the languages form on its own, without the preferences", async () => {
    renderApp(connectedClient(), ["/maintain/settings"]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Change languages" }),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Languages" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "How well you speak English" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: "Suggest translations" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a preference changed in Settings when the languages are saved after it", async () => {
    const client = connectedClient();
    renderApp(client, ["/maintain/progress", "/maintain/settings"]);
    const spanish = await screen.findByRole("radio", { name: "Español" });
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Suggest translations" }),
      ).toBeEnabled(),
    );
    await userEvent.click(spanish);
    await waitFor(() => expect(client.savePreferences).toHaveBeenCalled());

    await userEvent.click(
      screen.getByRole("button", { name: "Change languages" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Save languages" }),
    );
    // The languages form does not show the preferences, so it must not
    // write back the ones it opened with.
    await waitFor(() =>
      expect(client.saveOnboarding).toHaveBeenCalledWith(
        expect.objectContaining({
          preferences: expect.objectContaining({ explanationsIn: "es" }),
        }),
      ),
    );
  });

  it("returns to Settings after saving languages opened directly", async () => {
    const router = renderApp(connectedClient(), ["/learn/languages"]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Save languages" }),
    );
    // With nothing beneath it in the app, going back would leave the app.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/learn/settings"),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
  });

  it("goes back to the screen beneath, or home when opened directly", async () => {
    const router = renderApp(connectedClient(), [
      "/maintain/lexicon",
      "/maintain/settings",
    ]);
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/maintain/lexicon"),
    );
  });

  it("goes home when there is nothing beneath it", async () => {
    const router = renderApp(connectedClient(), ["/learn/settings"]);
    await userEvent.click(await screen.findByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/learn/course"),
    );
  });

  it("says in the demo that nothing is kept, and offers no sign-in actions", async () => {
    renderApp(createDemoClient({ suggestionDelaysMs: {} }), [
      "/maintain/settings",
    ]);
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    // The closed side panel says it too; this is the page's own line.
    expect(
      within(screen.getByRole("main")).getByText(
        /This is a demo with sample data/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export my data" }),
    ).toBeInTheDocument();
  });
});
