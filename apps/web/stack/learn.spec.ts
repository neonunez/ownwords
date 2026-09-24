import { expect, test } from "@playwright/test";
import { onboard, signIn } from "./helpers";

// The backend holds the authored Russian Foundations course. These journeys
// check that a real pack is rendered, completed, and carried into the Lexicon.
test.describe("Learn, against the real backend", () => {
  test("finishes a lesson, carries on from the next, and practises what it taught", async ({
    page,
    context,
    request,
  }) => {
    await onboard(request, "learner");
    await signIn(context, "learner");

    await page.goto("/learn/course");
    const resume = page.getByRole("button", { name: /Continue · Unit 1/ });
    await expect(resume).toContainText("Letters in familiar words");
    await expect(resume).toContainText("Five familiar letters");
    await expect(page.getByText("Read the sounds")).toBeVisible();

    await resume.click();
    await expect(
      page.getByRole("heading", { name: /Unit 1 · Five familiar letters/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(
      page.getByRole("heading", { name: /Unit 1 · Hear the word/ }),
    ).toBeVisible();
    // The item as the course writes it, with its stress mark and its meaning.
    await expect(page.getByText("ма́ма")).toBeVisible();
    await expect(page.getByText("mother")).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(
      page.getByRole("heading", {
        name: /Unit 1 · A word, not a list of letters/,
      }),
    ).toBeVisible();

    // Leaving mid-lesson and coming back resumes at the step reached.
    await page.getByRole("button", { name: "Back to the course" }).click();
    await expect(resume).toContainText("A word, not a list of letters");
    await resume.click();
    await expect(
      page.getByRole("heading", {
        name: /Unit 1 · A word, not a list of letters/,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Next" }).click();
    await expect(
      page.getByRole("heading", { name: /Unit 1 · Which word is/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Finish lesson" }).click();
    await expect(
      page.getByText("Lesson finished. Its words are in your Lexicon."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Continue · Unit 1/ }),
    ).toContainText("Letters that look familiar");

    // The item the lesson introduced is in the Lexicon now, from the course.
    await page.goto("/maintain/lexicon");
    await expect(page.getByRole("button", { name: /ма́ма/ })).toBeVisible();

    // Learn practice asks only for what the course taught.
    await page.goto("/learn/practice");
    await page.getByRole("radio", { name: "Flashcards" }).click();
    await expect(page.getByText(/^1 of \d+ due$/)).toBeVisible();
    await page.getByRole("button", { name: /Tap to turn it over/ }).click();
    await expect(page.getByText(/^(мама|кот|там|как)$/).first()).toBeVisible();
  });

  test("shows the alphabet and the reference the course publishes", async ({
    page,
    context,
    request,
  }) => {
    await onboard(request, "learner");
    await signIn(context, "learner");

    await page.goto("/learn/alphabet");
    await expect(page.getByRole("button", { name: "All 33" })).toBeVisible();
    await expect(
      page
        .getByRole("list", { name: "The Russian alphabet" })
        .getByRole("listitem"),
    ).toHaveCount(33);

    await page.goto("/learn/reference");
    const grammar = page.getByRole("button", { name: /Grammar and verbs/ });
    await expect(grammar).toContainText("Unit 1");
    await grammar.click();
    await expect(page.getByText("Names without ‘am’")).toBeVisible();
  });

  test("says so plainly when the person is not learning a language", async ({
    page,
    context,
    request,
  }) => {
    await onboard(request, "keyholder", false);
    await signIn(context, "keyholder");
    await page.goto("/learn/course");
    await expect(
      page.getByText(/You are not learning a language yet/),
    ).toBeVisible();
  });
});
