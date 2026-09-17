import { expect, test } from '@playwright/test';

test.describe('the core flows', () => {
  test('captures an entry, reviews its translations and saves it', async ({ page }) => {
    await page.goto('/maintain/lexicon');
    await page.getByRole('button', { name: 'Add an entry' }).click();

    await page.getByRole('textbox', { name: 'Word or expression' }).fill('to let it slide');
    await page
      .getByRole('textbox', { name: 'What do you mean by it?' })
      .fill('when it is not worth the argument');
    await page.getByRole('button', { name: /Translate/ }).click();

    await expect(page.getByText('waiting').first()).toBeVisible();
    await expect(page.getByText('dejar pasar')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/stays out of practice until you confirm it/)).toBeVisible();

    await page.getByRole('button', { name: /Confirm the Español equivalent/ }).click();
    await expect(page.getByText('confirmed')).toBeVisible();

    await page.getByRole('button', { name: 'Save entry' }).click();
    await expect(page.getByText('Saved to your Lexicon.')).toBeVisible();
    await expect(page.getByRole('button', { name: /to let it slide/ })).toBeVisible();
  });

  test('searches the Lexicon without the stress mark', async ({ page }) => {
    await page.goto('/maintain/lexicon');
    await page.getByRole('searchbox', { name: 'Search your Lexicon' }).fill('молоко');
    await expect(page.getByRole('button', { name: /молоко/ })).toBeVisible();
    await expect(page.getByText('1 of 6 entries')).toBeVisible();
  });

  test('fixes a translation from the entry sheet', async ({ page }) => {
    await page.goto('/maintain/lexicon/e1');
    await page.getByRole('button', { name: /Fix the Русский equivalent/ }).click();

    const sheet = page.getByRole('dialog', { name: 'How well does it fit?' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: /false friend/i }).click();

    await expect(page.getByText('Marked as false friend.')).toBeVisible();
    await expect(page.locator('#ow-main').getByText('false friend')).toBeVisible();
  });

  test('gives the prompt before the answer in practice', async ({ page }) => {
    await page.goto('/maintain/practice');
    const answer = page.getByRole('textbox', { name: /Your answer/ });

    await answer.fill('nope');
    await page.getByRole('button', { name: 'Check your answer' }).click();
    await expect(page.getByText(/Not quite\./)).toBeVisible();
    await expect(page.getByText(/The answer is/)).toHaveCount(0);

    await answer.fill('still nope');
    await page.getByRole('button', { name: 'Check your answer' }).click();
    await expect(page.getByText(/It comes back later this session\./)).toBeVisible();
  });

  test('turns a flashcard over and rates it', async ({ page }) => {
    await page.goto('/maintain/flashcards');
    await expect(page.getByRole('radiogroup', { name: 'Practice format' })).toHaveCount(0);

    await page.getByRole('button', { name: /Tap to turn it over/ }).click();
    await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('2 of 3 due')).toBeVisible();
  });

  test('walks a lesson from hearing it to the perception drill', async ({ page }) => {
    await page.goto('/learn/course');
    await page.getByRole('button', { name: /Continue · Unit 3/ }).click();

    await expect(page.getByRole('heading', { name: /Hear it first/ })).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/Stress falls on one syllable/)).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'пожа́луйста' }).click();
    await expect(page.getByText(/Right\. That is “coffee, please”\./)).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('button', { name: 'Play the recording' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish step' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Course' })).toBeVisible();
  });

  test('filters the alphabet to the letters that look Latin but are not', async ({ page }) => {
    await page.goto('/learn/alphabet');
    await page.getByRole('button', { name: 'Look Latin, are not' }).click();

    const letters = page.getByRole('list', { name: 'The Russian alphabet' }).getByRole('listitem');
    await expect(letters).toHaveCount(8);
    await expect(page.getByRole('button', { name: /looks like B/ })).toBeVisible();
  });

  test('says which unit introduced each reference topic', async ({ page }) => {
    await page.goto('/learn/reference');
    await expect(page.getByRole('button', { name: /Grammar and verbs/ })).toContainText('Unit 3');
    await expect(page.getByRole('button', { name: /Numbers/ })).toBeDisabled();
  });
});
