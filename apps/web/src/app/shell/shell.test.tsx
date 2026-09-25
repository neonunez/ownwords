import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { routeTree } from "../routes";
import { ClientProvider } from "./ClientProvider";
import { ThemeProvider } from "./ThemeProvider";
import { createDemoClient } from "../../api/demo/demoClient";
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
  it("holds mode, languages and preferences, and closes on Escape", async () => {
    renderApp();
    await userEvent.click(
      await screen.findByRole("button", { name: "Open the side panel" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Ownwórds" });
    expect(
      within(panel).getByRole("button", { name: /Maintain/ }),
    ).toHaveAttribute("aria-current", "true");
    expect(within(panel).getByText("Русский")).toBeInTheDocument();
    // The course ships no recordings, so there is no audio preference to set.
    expect(within(panel).queryByText(/audio/i)).not.toBeInTheDocument();
    expect(
      within(panel).getByRole("switch", { name: "Suggest translations" }),
    ).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
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
    await userEvent.click(within(panel).getByRole("button", { name: /Learn/ }));
    expect(
      await screen.findByRole("heading", { name: "Course", level: 1 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("navigation", { name: "Learn" }),
    ).toBeInTheDocument();
  });
});

describe("appearance", () => {
  it("follows the system until a choice is made, then remembers it", async () => {
    renderApp();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    await userEvent.click(
      await screen.findByRole("button", { name: "Open the side panel" }),
    );
    const panel = await screen.findByRole("dialog", { name: "Ownwórds" });
    await userEvent.click(within(panel).getByRole("radio", { name: "Dark" }));

    await waitFor(() =>
      expect(document.documentElement.getAttribute("data-theme")).toBe("dark"),
    );
    expect(localStorage.getItem("ownwords.appearance")).toBe("dark");
  });
});
