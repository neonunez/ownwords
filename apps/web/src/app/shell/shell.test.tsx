import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  RouterProvider,
  createMemoryRouter,
} from "react-router-dom";
import { routeTree } from "../routes";
import { ClientProvider } from "./ClientProvider";
import { SidePanel } from "./SidePanel";
import { ThemeProvider } from "./ThemeProvider";
import { createDemoClient } from "../../api/demo/demoClient";
import { OwnwordsError } from "../../api/client";
import { activeTabKey, modeFromPath } from "../navigation";

function renderApp(initial = "/maintain/progress") {
  const router = createMemoryRouter(routeTree, { initialEntries: [initial] });
  return render(
    <ThemeProvider>
      <ClientProvider client={createDemoClient({ suggestionDelaysMs: {} })}>
        <RouterProvider router={router} />
      </ClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("the tab bars", () => {
  it("gives Maintain its four daily actions", async () => {
    renderApp();
    const bar = await screen.findByRole("navigation", { name: "Maintain" });
    expect(
      within(bar)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Progress", "Lexicon", "Practice", "Flashcards"]);
  });

  it("gives Learn its own four, and never crosses modes", async () => {
    renderApp("/learn/course");
    const bar = await screen.findByRole("navigation", { name: "Learn" });
    expect(
      within(bar)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Course", "Practice", "Alphabet", "Reference"]);
    expect(
      screen.queryByRole("link", { name: "Lexicon" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the tab bar on a pushed screen, so no screen is a dead end", async () => {
    renderApp("/maintain/lexicon/e1");
    expect(
      await screen.findByRole("navigation", { name: "Maintain" }),
    ).toBeInTheDocument();
  });

  it("keeps the owning tab lit on a pushed screen", () => {
    expect(activeTabKey("/maintain/lexicon/e1")).toBe("lexicon");
    expect(activeTabKey("/maintain/add")).toBe("lexicon");
    expect(activeTabKey("/learn/course/u3")).toBe("course");
    // Settings is reached from the side panel, so no tab owns it.
    expect(activeTabKey("/maintain/settings")).toBe("");
    expect(activeTabKey("/learn/languages")).toBe("");
    expect(modeFromPath("/learn/alphabet")).toBe("learn");
  });
});

describe("navigating", () => {
  it("moves between tabs", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "Progress", level: 1 });
    await userEvent.click(screen.getByRole("link", { name: "Lexicon" }));
    expect(
      await screen.findByRole("heading", { name: "Lexicon", level: 1 }),
    ).toBeInTheDocument();
  });

  it("opens an entry from the Lexicon and comes back", async () => {
    renderApp("/maintain/lexicon");
    await userEvent.click(
      await screen.findByRole("button", { name: /to make do with/ }),
    );
    expect(
      await screen.findByText("manage with what is available"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Back to your Lexicon" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Lexicon", level: 1 }),
    ).toBeInTheDocument();
  });

  it("sends an unknown address back to the first screen", async () => {
    renderApp("/nowhere");
    expect(
      await screen.findByRole("heading", { name: "Progress", level: 1 }),
    ).toBeInTheDocument();
  });
});

describe("the side panel", () => {
  it("holds mode, what is up next and the languages, and closes on Escape", async () => {
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "Open the side panel" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Ownwórds" });
    expect(
      within(panel).getByRole("button", { name: /Maintain/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(
        within(panel).getByRole("list", { name: "Your languages" }),
      ).getByText("Русский"),
    ).toBeInTheDocument();
    expect(
      await within(panel).findByRole("button", { name: /Carry on · Unit 3/ }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: /Practice is due/ }),
    ).toBeInTheDocument();
    // The course ships no recordings, so there is no audio preference to set.
    expect(within(panel).queryByText(/audio/i)).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("leaves settings and account actions to the Settings page", async () => {
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "Open the side panel" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Ownwórds" });
    for (const name of [
      "Change languages",
      "Export my data",
      "Add a passkey on this device",
      "Sign out",
    ]) {
      expect(
        within(panel).queryByRole("button", { name }),
      ).not.toBeInTheDocument();
    }
    expect(within(panel).queryByRole("switch")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("radiogroup")).not.toBeInTheDocument();

    await userEvent.click(
      within(panel).getByRole("button", { name: /Settings/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "Settings", level: 1 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("navigation", { name: "Maintain" }),
    ).toBeInTheDocument();
  });

  it("says in words when what is waiting cannot be read and nothing is learned", async () => {
    const client = {
      ...createDemoClient({ suggestionDelaysMs: {} }),
      getProgress: () =>
        Promise.reject(new OwnwordsError("network", "Offline.")),
    };
    render(
      <ThemeProvider>
        <ClientProvider client={client}>
          <MemoryRouter>
            <SidePanel
              open
              onClose={() => {}}
              mode="maintain"
              onModeChange={() => {}}
              languages={[
                {
                  code: "en",
                  name: "English",
                  role: "native",
                  level: "native",
                },
              ]}
            />
          </MemoryRouter>
        </ClientProvider>
      </ThemeProvider>,
    );
    const panel = await screen.findByRole("dialog", { name: "Ownwórds" });
    expect(
      await within(panel).findByText(
        "What is waiting could not be read. Open the panel again to retry.",
      ),
    ).toBeInTheDocument();
  });

  it("goes straight to the next course step, across modes", async () => {
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "Open the side panel" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Ownwórds" });
    await userEvent.click(
      await within(panel).findByRole("button", { name: /Carry on · Unit 3/ }),
    );
    expect(
      await screen.findByRole("navigation", { name: "Learn" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { level: 1, name: /Unit 3/ }),
    ).toBeInTheDocument();
  });

  it("seals off the screen behind it while it is open", async () => {
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "Open the side panel" }),
    );
    await screen.findByRole("dialog", { name: "Ownwórds" });
    expect(document.querySelector("main")).toHaveAttribute("inert");
  });

  it("is the only way across to the other mode", async () => {
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "Open the side panel" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Ownwórds" });
    await userEvent.click(
      within(panel).getByRole("button", { name: /^Learn/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "Course", level: 1 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("navigation", { name: "Learn" }),
    ).toBeInTheDocument();
  });
});
