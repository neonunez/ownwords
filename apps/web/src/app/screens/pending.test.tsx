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
    // Both activations arrive before React commits the disabled button.
    act(() => {
      next.click();
      next.click();
    });
    expect(
      screen.getByRole("button", { name: "Saving progress…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("list", { name: "Step 1 of 4" }),
    ).toBeInTheDocument();
    expect(writes).toEqual(["u3s1"]);
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
    let finishing = deferred<Awaited<ReturnType<typeof demo.completeLesson>>>();
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
    await act(async () =>
      finishing.resolve({ words: { total: 3, inLexicon: 0 } }),
    );
    expect(
      await screen.findByText("Its 3 words are ready to practise in Learn."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("They are not in your Lexicon."),
    ).toBeInTheDocument();
  });

  it("keeps a save to the Lexicon pending until it is acknowledged, and never claims it early", async () => {
    const demo = createDemoClient();
    let saving =
      deferred<Awaited<ReturnType<typeof demo.addLessonWordsToLexicon>>>();
    const client = {
      ...demo,
      getLesson: async (id: string) => ({
        ...(await demo.getLesson(id)),
        status: "completed" as const,
      }),
      addLessonWordsToLexicon: () => saving.promise,
    };
    renderScreen(<LessonScreen />, {
      route: "/learn/course/u3",
      path: "/learn/course/:lessonId",
      client,
    });
    const add = await screen.findByRole("button", {
      name: "Add these words to Lexicon",
    });
    await userEvent.click(add);
    expect(
      screen.getByRole("button", { name: "Adding to your Lexicon…" }),
    ).toBeDisabled();
    expect(screen.queryByText(/added to your Lexicon/)).not.toBeInTheDocument();
    await act(async () => saving.reject(new Error("offline")));
    expect(
      await screen.findByRole("button", {
        name: "Add these words to Lexicon",
      }),
    ).toBeEnabled();
    expect(
      await screen.findByText("Your Lexicon was not changed. offline"),
    ).toBeInTheDocument();

    saving = deferred();
    await userEvent.click(
      screen.getByRole("button", { name: "Add these words to Lexicon" }),
    );
    await act(async () =>
      saving.resolve({
        total: 3,
        inLexicon: 3,
        added: 3,
        alreadyThere: 0,
        pending: 0,
      }),
    );
    expect(
      await screen.findByText("3 words added to your Lexicon."),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Already in your Lexicon" }),
    ).toBeDisabled();
  });

  it("offers no Lexicon save for a finished lesson that introduced no words", async () => {
    const demo = createDemoClient();
    const client = {
      ...demo,
      getLesson: async (id: string) => ({
        ...(await demo.getLesson(id)),
        status: "completed" as const,
        words: { total: 0, inLexicon: 0 },
      }),
    };
    renderScreen(<LessonScreen />, {
      route: "/learn/course/u3",
      path: "/learn/course/:lessonId",
      client,
    });
    expect(
      await screen.findByText("This lesson introduced no words to practise."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Lexicon/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/in your Lexicon/)).not.toBeInTheDocument();
  });

  it("says what is still owed when only some words could be saved", async () => {
    const demo = createDemoClient();
    const client = {
      ...demo,
      getLesson: async (id: string) => ({
        ...(await demo.getLesson(id)),
        status: "completed" as const,
      }),
      addLessonWordsToLexicon: async () => ({
        total: 3,
        inLexicon: 1,
        added: 1,
        alreadyThere: 0,
        pending: 2,
      }),
    };
    renderScreen(<LessonScreen />, {
      route: "/learn/course/u3",
      path: "/learn/course/:lessonId",
      client,
    });
    await userEvent.click(
      await screen.findByRole("button", { name: "Add these words to Lexicon" }),
    );
    expect(
      await screen.findByText(
        "1 word added to your Lexicon. 2 words could not be saved; try again.",
      ),
    ).toBeInTheDocument();
    // Still offered, because the lesson is not fully kept yet.
    expect(
      screen.getByRole("button", { name: "Add these words to Lexicon" }),
    ).toBeEnabled();
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

  it("sends one capture and one equivalent save per same-frame activation, and retries capture after failure", async () => {
    const demo = createDemoClient({ suggestionDelaysMs: {} });
    let capture = deferred<void>();
    const save = deferred<Awaited<ReturnType<typeof demo.addEquivalents>>>();
    const created = vi.fn(
      async (...args: Parameters<typeof demo.createEntry>) => {
        await capture.promise;
        return demo.createEntry(...args);
      },
    );
    const saved = vi.fn(() => save.promise);
    const client = { ...demo, createEntry: created, addEquivalents: saved };
    renderScreen(<AddEntryScreen />, { route: "/maintain/add", client });
    await userEvent.type(
      await screen.findByRole("textbox", { name: "Word or expression" }),
      "a single word",
    );
    await userEvent.click(
      screen.getByRole("switch", { name: "Suggest translations" }),
    );
    const next = screen.getByRole("button", { name: "Next" });
    act(() => {
      next.click();
      next.click();
    });
    expect(created).toHaveBeenCalledTimes(1);
    await act(async () => capture.reject(new Error("Capture failed.")));
    expect(await screen.findByText("Capture failed.")).toBeInTheDocument();
    capture = deferred();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(created).toHaveBeenCalledTimes(2);
    await act(async () => capture.resolve());
    await userEvent.click(
      (
        await screen.findAllByRole("button", {
          name: /Type the .* equivalent yourself/,
        })
      )[0]!,
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
    const saveButton = screen.getByRole("button", { name: "Save entry" });
    act(() => {
      saveButton.click();
      saveButton.click();
    });
    expect(saved).toHaveBeenCalledTimes(1);
    await act(async () => save.resolve(undefined as never));
    expect(saved).toHaveBeenCalledTimes(1);
  });
});
