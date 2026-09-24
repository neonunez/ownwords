import { expect, test } from "@playwright/test";
import { api, onboard, signIn } from "./helpers";

test.describe("Maintain, against the real backend", () => {
  test("stores an entry, keeps its reviewed translations, and practises it", async ({
    page,
    context,
    request,
  }) => {
    await onboard(request, "collector");
    await signIn(context, "collector");

    // An empty Lexicon offers no invented starters: the backend has none.
    await page.goto("/maintain/lexicon");
    await expect(page.getByText(/Your Lexicon is empty/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add your first entry" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Add an entry" }).click();
    await page
      .getByRole("textbox", { name: "Word or expression" })
      .fill("to make do with");
    await page
      .getByRole("textbox", { name: "What do you mean by it?" })
      .fill("when it isn’t ideal but works");
    await page.getByRole("button", { name: "Translate" }).click();

    // The translation provider is switched off on this backend, and the
    // review step says so for each language instead of pretending.
    await expect(page.getByText(/Suggestions are switched off/)).toHaveCount(2);
    await page
      .getByRole("button", { name: "Type the Español equivalent yourself" })
      .click();
    await page
      .getByRole("textbox", { name: "Type the equivalent yourself" })
      .fill("arreglárselas con");
    await page.getByRole("button", { name: "Use this wording" }).click();
    await expect(page.getByText("arreglárselas con")).toBeVisible();
    await page.getByRole("button", { name: "Save entry" }).click();

    await expect(page.getByText("Saved to your Lexicon.")).toBeVisible();
    const row = page.getByRole("button", { name: /to make do with/ });
    await expect(row).toBeVisible();

    // The failed Russian row was kept, not dropped, and can be typed by hand.
    await row.click();
    await expect(
      page.getByText("Translation failed. Nothing was dropped."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Fix the Русский equivalent" })
      .click();
    await page
      .getByRole("textbox", { name: "Or type the equivalent yourself" })
      .fill("обходи́ться");
    await page.getByRole("button", { name: "Save this wording" }).click();
    await expect(page.getByText("Saved, typed by hand.")).toBeVisible();

    // Stored, not just shown: a fresh read has both, typed by hand.
    await page.reload();
    await expect(page.getByText("arreglárselas con")).toBeVisible();
    await expect(page.getByText("обходи́ться")).toBeVisible();
    await expect(page.getByText("typed by hand", { exact: true })).toHaveCount(
      2,
    );

    // Search ignores the stress mark and finds it by its Russian equivalent.
    await page.goto("/maintain/lexicon");
    await page
      .getByRole("searchbox", { name: "Search your Lexicon" })
      .fill("обходиться");
    await expect(
      page.getByRole("button", { name: /to make do with/ }),
    ).toBeVisible();

    // No phrase with a gap exists yet; flashcards practise the same words.
    await page.getByRole("link", { name: "Practice" }).click();
    await expect(
      page.getByText("No phrases to complete are due."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Practise with flashcards" })
      .click();

    const position = page.getByText(/^1 of \d+ due$/);
    await expect(position).toBeVisible();
    const due = Number(
      /of (\d+) due/.exec((await position.textContent()) ?? "")?.[1],
    );
    expect(due).toBeGreaterThan(0);
    for (let card = 0; card < due; card += 1) {
      await page.getByRole("button", { name: /Tap to turn it over/ }).click();
      await page.getByRole("button", { name: "Got it" }).click();
    }
    await expect(page.getByText("That is everything due.")).toBeVisible();
    await expect(page.getByText(/Next up:/)).toBeVisible();
    // The scheduler does not offer cards early, so the app does not either.
    await expect(
      page.getByRole("button", { name: "Practise what is coming" }),
    ).toHaveCount(0);

    // Reviews were stored: nothing is due any more, and retention is measured.
    await page.getByRole("link", { name: "Progress" }).click();
    await expect(page.getByText(/Nothing is due\./)).toBeVisible();
    await expect(
      page.getByRole("img", { name: /Retention in Español: recognise \d+%/ }),
    ).toBeVisible();
  });

  test("keeps one account's Lexicon out of another's reach", async ({
    page,
    context,
    request,
  }) => {
    await onboard(request, "owner", false);
    await onboard(request, "stranger", false);
    const created = (await api(
      request,
      "owner",
      "POST",
      "/api/v1/lexicon/entries",
      {
        kind: "word",
        provenance: { createdBy: "ownwords-web", headwordLanguage: "es" },
        senses: [
          {
            gloss: null,
            equivalents: [
              { languageTag: "es", text: "sobremesa", status: "manual" },
              { languageTag: "en", text: "table talk", status: "manual" },
            ],
          },
        ],
      },
    )) as { data: { id: string } };

    await signIn(context, "stranger");
    await page.goto(`/maintain/lexicon/${created.data.id}`);
    await expect(
      page.getByText("That entry is no longer in your Lexicon."),
    ).toBeVisible();
    await page.goto("/maintain/lexicon");
    await expect(page.getByText(/Your Lexicon is empty/)).toBeVisible();

    await context.clearCookies();
    await signIn(context, "owner");
    await page.goto(`/maintain/lexicon/${created.data.id}`);
    await expect(page.getByText("sobremesa")).toBeVisible();
    await expect(page.getByText("table talk")).toBeVisible();
  });

  test("says in words when the backend cannot be reached, and recovers", async ({
    page,
    context,
    request,
  }) => {
    await onboard(request, "offline");
    await signIn(context, "offline");
    await page.goto("/maintain/progress");
    await expect(
      page.getByRole("heading", { level: 1, name: "Progress" }),
    ).toBeVisible();

    await page.route("**/api/v1/lexicon/**", (route) => route.abort());
    await page.getByRole("link", { name: "Lexicon" }).click();
    await expect(
      page.getByText("Your Lexicon could not be read. Nothing was lost."),
    ).toBeVisible();

    await page.unroute("**/api/v1/lexicon/**");
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText(/Your Lexicon is empty/)).toBeVisible();
  });
});
