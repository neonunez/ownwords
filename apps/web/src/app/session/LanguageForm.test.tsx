import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageForm } from "./LanguageForm";
import type { Onboarding } from "../../api/types";
import { MAINTAINABLE, MOST_LANGUAGES } from "../../lib/languages";

const preferences: Onboarding["preferences"] = {
  explanationsIn: "en",
  audioInCourse: true,
  suggestTranslations: true,
};

function renderForm(props: Partial<Parameters<typeof LanguageForm>[0]> = {}) {
  const onSubmit = vi.fn(async (_next: Onboarding) => {});
  render(<LanguageForm submitLabel="Start" onSubmit={onSubmit} {...props} />);
  return { onSubmit };
}

const addSelect = () =>
  screen.getByRole("combobox", { name: "Add a language you speak" });
const learnSelect = () =>
  screen.getByRole("combobox", { name: "Language to learn" });
const optionNames = (select: HTMLElement) =>
  within(select)
    .getAllByRole("option")
    .map((option) => option.textContent);

async function addSpoken(code: string) {
  await userEvent.selectOptions(addSelect(), code);
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
}

describe("the language form", () => {
  it("asks for the two kinds of language apart, and says what each is for", () => {
    renderForm();
    const maintain = screen.getByRole("region", {
      name: "Languages you already speak",
    });
    expect(within(maintain).getByText("Maintain")).toBeInTheDocument();
    expect(within(maintain).getByText(/Maintain starts at B1/)).toBeVisible();
    const learn = screen.getByRole("region", {
      name: "A new language, from zero",
    });
    expect(within(learn).getByText("Learn")).toBeInTheDocument();
    expect(within(learn).getByText(/Start at the alphabet/)).toBeVisible();
  });

  it("adds a spoken language from the selector and asks its level before saving", async () => {
    const { onSubmit } = renderForm();
    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeDisabled();
    expect(
      screen.getByText("Add at least one language you speak."),
    ).toBeInTheDocument();

    await addSpoken("es");
    const levels = screen.getByRole("group", {
      name: "How well you speak Español",
    });
    // Nothing is chosen for the person, and saving waits until they say.
    expect(within(levels).getByRole("radio", { name: "B2" })).not.toBeChecked();
    expect(start).toBeDisabled();
    expect(
      screen.getByText("Choose how well you speak Español."),
    ).toBeInTheDocument();

    await userEvent.click(within(levels).getByRole("radio", { name: "B2" }));
    expect(levels).toHaveAccessibleDescription(
      "At ease in most conversations.",
    );
    await userEvent.click(start);
    expect(onSubmit).toHaveBeenCalledWith({
      languages: [{ code: "es", kind: "maintain", level: "b2" }],
      preferences,
    });
  });

  it("offers languages the app can draw, and none already chosen", async () => {
    renderForm();
    const offered = optionNames(addSelect());
    expect(offered[0]).toBe("Choose a language");
    expect(offered).toContain("Deutsch · German");
    expect(offered).toContain("Українська · Ukrainian");
    expect(offered).toContain("English");
    // Scripts outside the app's typeface are not offered.
    expect(
      offered.some((name) => /Japanese|Arabic|Chinese/.test(name ?? "")),
    ).toBe(false);

    await addSpoken("en");
    expect(optionNames(addSelect())).not.toContain("English");
  });

  it("moves the keyboard to a new language's level, and back when one is removed", async () => {
    renderForm();
    await addSpoken("de");
    const levels = screen.getByRole("group", {
      name: "How well you speak Deutsch",
    });
    expect(within(levels).getByRole("radio", { name: "Native" })).toHaveFocus();

    await userEvent.click(
      screen.getByRole("button", { name: "Remove Deutsch" }),
    );
    expect(
      screen.queryByRole("group", { name: "How well you speak Deutsch" }),
    ).not.toBeInTheDocument();
    expect(addSelect()).toHaveFocus();
  });

  it("offers the one course there is to learn from zero, and sends it at A0", async () => {
    const { onSubmit } = renderForm();
    expect(optionNames(learnSelect())).toEqual([
      "Not now",
      "Русский · Russian",
    ]);
    expect(learnSelect()).toHaveValue("");
    expect(learnSelect()).toHaveAccessibleDescription(
      "One course so far: Русский, from the alphabet to the first half of A1.",
    );

    await addSpoken("en");
    await userEvent.click(screen.getByRole("radio", { name: "Native" }));
    await userEvent.selectOptions(learnSelect(), "ru");
    expect(screen.getByText(/starts at A0/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onSubmit).toHaveBeenCalledWith({
      languages: [
        { code: "en", kind: "maintain", level: "native" },
        { code: "ru", kind: "learn", level: "a0" },
      ],
      preferences,
    });
  });

  it("never lets one language be kept up and learned at once", async () => {
    renderForm();
    await userEvent.selectOptions(learnSelect(), "ru");
    const russian = within(addSelect()).getByRole("option", {
      name: "Русский · Russian — you are learning it",
    });
    expect(russian).toBeDisabled();

    await userEvent.selectOptions(learnSelect(), "");
    await addSpoken("ru");
    expect(optionNames(learnSelect())).toEqual(["Not now"]);
    expect(learnSelect()).toHaveAccessibleDescription(
      "You already speak Русский, and there is no other course yet.",
    );
  });

  it("drops a pending language to add once it is chosen to learn", async () => {
    const { onSubmit } = renderForm();
    await addSpoken("en");
    await userEvent.click(screen.getByRole("radio", { name: "Native" }));

    await userEvent.selectOptions(addSelect(), "ru");
    await userEvent.selectOptions(learnSelect(), "ru");
    expect(addSelect()).toHaveValue("");
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();
    await userEvent.click(add);

    expect(
      screen.queryByRole("group", { name: "How well you speak Русский" }),
    ).not.toBeInTheDocument();
    expect(learnSelect()).toHaveValue("ru");
    expect(screen.getByText(/starts at A0/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onSubmit).toHaveBeenCalledWith({
      languages: [
        { code: "en", kind: "maintain", level: "native" },
        { code: "ru", kind: "learn", level: "a0" },
      ],
      preferences,
    });
  });

  it("keeps a saved profile's languages and levels as they were", async () => {
    const initial: Onboarding = {
      languages: [
        { code: "en", kind: "maintain", level: "native" },
        // Outside the list offered now, and a level below the usual range:
        // both were stored before and survive a save untouched.
        { code: "ja", kind: "maintain", level: "c1" },
        { code: "it", kind: "maintain", level: "a2" },
        { code: "ru", kind: "learn", level: "a0" },
      ],
      preferences: { ...preferences, explanationsIn: "es" },
    };
    const { onSubmit } = renderForm({ initial, submitLabel: "Save languages" });
    expect(
      within(
        screen.getByRole("group", { name: "How well you speak Italiano" }),
      ).getByRole("radio", { name: "A2" }),
    ).toBeChecked();
    expect(learnSelect()).toHaveValue("ru");

    await userEvent.click(
      screen.getByRole("button", { name: "Save languages" }),
    );
    expect(onSubmit).toHaveBeenCalledWith(initial);
  });

  it("carries the preferences through unchanged when Settings holds them", async () => {
    const initial: Onboarding = {
      languages: [{ code: "en", kind: "maintain", level: "native" }],
      preferences: { ...preferences, suggestTranslations: false },
    };
    const { onSubmit } = renderForm({ initial, askPreferences: false });
    expect(
      screen.queryByRole("switch", { name: "Suggest translations" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onSubmit).toHaveBeenCalledWith(initial);
  });

  it("offers no course to learn once the profile is full, and says why", async () => {
    const { onSubmit } = renderForm({
      initial: {
        languages: MAINTAINABLE.filter((code) => code !== "ru")
          .slice(0, MOST_LANGUAGES)
          .map((code) => ({ code, kind: "maintain", level: "b2" })),
        preferences,
      },
    });
    expect(learnSelect()).toBeDisabled();
    expect(
      within(
        screen.getByRole("region", { name: "A new language, from zero" }),
      ).getByText(/A profile holds up to 12 languages\. Remove one/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(onSubmit.mock.calls[0]?.[0].languages).toHaveLength(MOST_LANGUAGES);
  });

  it("keeps a course already chosen changeable when the profile is full", async () => {
    const { onSubmit } = renderForm({
      initial: {
        languages: [
          ...MAINTAINABLE.filter((code) => code !== "ru")
            .slice(0, MOST_LANGUAGES - 1)
            .map((code) => ({
              code,
              kind: "maintain" as const,
              level: "b2" as const,
            })),
          { code: "ru", kind: "learn", level: "a0" },
        ],
        preferences,
      },
    });
    expect(learnSelect()).toBeEnabled();
    await userEvent.selectOptions(learnSelect(), "");
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(
      onSubmit.mock.calls[0]?.[0].languages.some(
        (language) => language.kind === "learn",
      ),
    ).toBe(false);
  });

  it("says in words when the languages were not saved", async () => {
    renderForm({
      initial: {
        languages: [{ code: "en", kind: "maintain", level: "native" }],
        preferences,
      },
      onSubmit: async () => {
        throw new Error("Ownwords could not be reached.");
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ownwords could not be reached.",
    );
  });
});
