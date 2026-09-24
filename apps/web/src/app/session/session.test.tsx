import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClientProvider } from "../shell/ClientProvider";
import { SessionGate } from "./SessionGate";
import { createDemoClient } from "../../api/demo/demoClient";
import { OwnwordsError, type OwnwordsClient } from "../../api/client";

function renderGate(client: OwnwordsClient) {
  return render(
    <ClientProvider client={client}>
      <SessionGate>
        <p>Inside the app</p>
      </SessionGate>
    </ClientProvider>,
  );
}

describe("the session gate", () => {
  it("asks a signed-out visitor to sign in, and renders nothing behind it", async () => {
    renderGate(createDemoClient({ session: { status: "signed-out" } }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Inside the app")).not.toBeInTheDocument();
  });

  it("runs the first run before the app, then lets the person in", async () => {
    const client = createDemoClient({
      session: {
        status: "signed-in",
        account: { name: "Ana", email: "ana@example.com" },
        onboarding: null,
      },
    });
    renderGate(client);
    expect(
      await screen.findByRole("heading", { level: 1, name: "Your languages" }),
    ).toBeInTheDocument();
    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeDisabled();

    await userEvent.click(
      screen
        .getByRole("group", { name: "English: how well you speak it" })
        .querySelector("button")!,
    );
    await userEvent.click(start);
    expect(await screen.findByText("Inside the app")).toBeInTheDocument();
  });

  it("says the backend could not be reached, and tries again on request", async () => {
    const demo = createDemoClient();
    let attempts = 0;
    const client: OwnwordsClient = {
      ...demo,
      getSession: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new OwnwordsError("offline", "Ownwords could not be reached.");
        }
        return demo.getSession();
      },
    };
    renderGate(client);
    expect(
      await screen.findByText(/Ownwords could not be reached/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Inside the app")).toBeInTheDocument();
  });

  it("brings the person back to sign in when a session ends mid-use", async () => {
    const demo = createDemoClient();
    let ended = () => {};
    const client: OwnwordsClient = {
      ...demo,
      onSignedOut: (listener) => {
        ended = listener;
        return () => {};
      },
    };
    renderGate(client);
    expect(await screen.findByText("Inside the app")).toBeInTheDocument();
    act(() => ended());
    expect(
      await screen.findByText(/You have been signed out/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Inside the app")).not.toBeInTheDocument();
  });
});
