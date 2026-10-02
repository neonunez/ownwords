import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "../../test/utils";
import { createDemoClient } from "../../api/demo/demoClient";
import { OwnwordsError } from "../../api/client";
import { LessonScreen } from "./learn/LessonScreen";
import { EntryScreen } from "./maintain/EntryScreen";
import { AddEntryScreen } from "./maintain/AddEntryScreen";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("truthful action feedback", () => {
  it("shows Saving progress immediately and advances only after both ordered acknowledgements", async () => {
    const demo = createDemoClient();
    const first = deferred<void>();
    const second = deferred<void>();
    const writes: string[] = [];
    const client = {
      ...demo,
      getLesson: async (id: string) => ({
        ...(await demo.getLesson(id)),
        status: "not_started" as const,
      }),
      completeLessonStep: vi.fn(async (_id: string, step: string) => {
        writes.push(step);
        await (writes.length === 1 ? first.promise : second.promise);
      }),
    };
    renderScreen(<LessonScreen />, {
      route: "/learn/course/u3",
      path: "/learn/course/:lessonId",
      client,
    });
    const next = await screen.findByRole("button", { name: "Next" });
    await userEvent.click(next);
    expect(
      screen.getByRole("button", { name: "Saving progress…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("list", { name: "Step 1 of 4" }),
    ).toBeInTheDocument();
    expect(writes).toEqual(["u3s1"]);
    // Same-frame extra activations cannot start another sequence.
    act(() => {
      next.click();
      next.click();
    });
    expect(writes).toHaveLength(1);
    await act(async () => first.resolve());
    await waitFor(() => expect(writes).toEqual(["u3s1", "u3s2"]));
    expect(
      screen.getByRole("list", { name: "Step 1 of 4" }),
    ).toBeInTheDocument();
    await act(async () => second.resolve());
    expect(
      await screen.findByRole("list", { name: "Step 2 of 4" }),
    ).toBeInTheDocument();
  });

  it("retains an acknowledged earlier step on partial failure and retries only the next write", async () => {
    const demo = createDemoClient();
    const writes: string[] = [];
    let fail = true;
    const client = {
      ...demo,
      getLesson: async (id: string) => ({
        ...(await demo.getLesson(id)),
        status: "not_started" as const,
      }),
      completeLessonStep: async (_id: string, step: string) => {
        writes.push(step);
        if (step === "u3s2" && fail) throw new Error("Retry this step.");
      },
    };
    renderScreen(<LessonScreen />, {
      route: "/learn/course/u3",
      path: "/learn/course/:lessonId",
      client,
    });
    await userEvent.click(await screen.findByRole("button", { name: "Next" }));
    expect(
      await screen.findByText(/Your place was not saved/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Step 1 of 4" }),
    ).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      await screen.findByRole("list", { name: "Step 2 of 4" }),
    ).toBeInTheDocument();
    expect(writes).toEqual(["u3s1", "u3s2", "u3s2"]);
  });

  it("keeps Finish pending, allows retry on failure, and never claims completion early", async () => {
    const demo = createDemoClient();
    let finishing = deferred<{ lexicon: "synced" }>();
    const client = {
      ...demo,
      getLesson: async (id: string) => ({
        ...(await demo.getLesson(id)),
        currentStepId: "u3s4",
      }),
      completeLesson: () => finishing.promise,
    };
    renderScreen(<LessonScreen />, {
      route: "/learn/course/u3",
      path: "/learn/course/:lessonId",
      client,
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Finish lesson" }),
    );
    expect(
      screen.getByRole("button", { name: "Finishing lesson…" }),
    ).toBeDisabled();
    expect(screen.queryByText(/Lesson finished/)).not.toBeInTheDocument();
    await act(async () => finishing.reject(new Error("offline")));
    expect(
      await screen.findByRole("button", { name: "Finish lesson" }),
    ).toBeEnabled();
    expect(screen.queryByText(/Lesson finished/)).not.toBeInTheDocument();
    finishing = deferred();
    await userEvent.click(
      screen.getByRole("button", { name: "Finish lesson" }),
    );
    await act(async () => finishing.resolve({ lexicon: "synced" }));
    expect(
      await screen.findByText(
        "Lesson finished. Its words are in your Lexicon.",
      ),
    ).toBeInTheDocument();
  });

  it("shows an entry's pending edit without changing its wording, and reports conflict only after refusal", async () => {
    const demo = createDemoClient({ suggestionDelaysMs: {} });
    const ack = deferred<Awaited<ReturnType<typeof demo.updateEntry>>>();
    const client = { ...demo, updateEntry: () => ack.promise };
    renderScreen(<EntryScreen />, {
      route: "/maintain/lexicon/e3",
      path: "/maintain/lexicon/:entryId",
      client,
    });
    await screen.findByText("actually");
    await userEvent.click(
      screen.getByRole("button", { name: "Edit this entry" }),
    );
    const sheet = await screen.findByRole("dialog", {
      name: "Edit this entry",
    });
    const field = within(sheet).getByRole("textbox", {
      name: /What do you mean/,
    });
    await userEvent.clear(field);
    await userEvent.type(field, "pending new note");
    await userEvent.click(within(sheet).getByRole("button", { name: /Save/ }));
    expect(await screen.findByText("Saving changes…")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.queryByText("Entry saved.")).not.toBeInTheDocument();
    expect(screen.queryByText("“pending new note”")).not.toBeInTheDocument();
    await act(async () =>
      ack.reject(
        new OwnwordsError(
          "VERSION_CONFLICT",
          "Changed somewhere else; retry.",
          409,
        ),
      ),
    );
    expect(
      await screen.findByText("Changed somewhere else; retry."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Saving changes…")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Edit this entry" }),
    ).toBeEnabled();
    expect(screen.queryByText("Entry saved.")).not.toBeInTheDocument();
  });

  it("keeps capture and equivalent Save pending until acknowledged, and describes partial success on failure", async () => {
    const demo = createDemoClient({ suggestionDelaysMs: {} });
    const capture = deferred<void>();
    const save = deferred<Awaited<ReturnType<typeof demo.addEquivalents>>>();
    const client = {
      ...demo,
      createEntry: async (...args: Parameters<typeof demo.createEntry>) => {
        await capture.promise;
        return demo.createEntry(...args);
      },
      addEquivalents: () => save.promise,
    };
    renderScreen(<AddEntryScreen />, { route: "/maintain/add", client });
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Word or expression" }),
      "a pending word",
    );
    await userEvent.click(
      screen.getByRole("switch", { name: "Suggest translations" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(
      screen.getByRole("button", { name: "Saving entry…" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Save entry" }),
    ).not.toBeInTheDocument();
    await act(async () => capture.resolve());
    await screen.findByRole("button", { name: "Save entry" });
    await userEvent.click(
      screen.getAllByRole("button", {
        name: /Type the .* equivalent yourself/,
      })[0]!,
    );
    const sheet = await screen.findByRole("dialog");
    await userEvent.type(
      within(sheet).getByRole("textbox", {
        name: /^Type the equivalent yourself/,
      }),
      "palabra",
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Use this wording" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save entry" }));
    expect(
      screen.getByRole("button", { name: "Saving entry…" }),
    ).toBeDisabled();
    expect(
      screen.queryByText("Saved to your Lexicon."),
    ).not.toBeInTheDocument();
    await act(async () => save.reject(new Error("Try again.")));
    expect(
      await screen.findByText(/The entry is saved, but not every translation/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Saved to your Lexicon."),
    ).not.toBeInTheDocument();
  });
});
