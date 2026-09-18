import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderScreen } from '../../test/utils';
import { createDemoClient } from '../../api/demo/demoClient';
import { LexiconScreen } from './maintain/LexiconScreen';
import { EntryScreen } from './maintain/EntryScreen';
import { AddEntryScreen } from './maintain/AddEntryScreen';
import { ProgressScreen } from './maintain/ProgressScreen';
import { PracticeScreen } from './PracticeScreen';
import { AlphabetScreen } from './learn/AlphabetScreen';
import { CourseScreen } from './learn/CourseScreen';

describe('the Lexicon', () => {
  it('lists the collection and says how much of it is shown', async () => {
    renderScreen(<LexiconScreen />, { route: '/maintain/lexicon' });
    expect(await screen.findByRole('button', { name: /to make do with/ })).toBeInTheDocument();
    expect(screen.getByText('6 entries')).toBeInTheDocument();
  });

  it('marks an entry carrying an unreviewed suggestion', async () => {
    renderScreen(<LexiconScreen />, { route: '/maintain/lexicon' });
    const row = await screen.findByRole('button', { name: /to make do with/ });
    expect(within(row).getByText('unverified')).toBeInTheDocument();
  });

  it('searches without the stress mark', async () => {
    renderScreen(<LexiconScreen />, { route: '/maintain/lexicon' });
    await screen.findByRole('button', { name: /to make do with/ });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your Lexicon' }), 'молоко');
    await waitFor(() => expect(screen.getByText('1 of 6 entries')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /молоко/ })).toBeInTheDocument();
  });

  it('offers one action when nothing matches', async () => {
    renderScreen(<LexiconScreen />, { route: '/maintain/lexicon' });
    await screen.findByRole('button', { name: /to make do with/ });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search your Lexicon' }), 'zzz');
    expect(await screen.findByText(/Nothing in your Lexicon matches/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add “zzz”/ })).toBeInTheDocument();
  });

  it('filters to words, and by mastery', async () => {
    renderScreen(<LexiconScreen />, { route: '/maintain/lexicon' });
    await screen.findByRole('button', { name: /ni de coña/ });
    await userEvent.click(screen.getByRole('button', { name: 'Words' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /ni de coña/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /sobremesa/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Well known' }));
    await waitFor(() => expect(screen.getByText('1 of 6 entries')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /sobremesa/ })).toBeInTheDocument();
  });

  it('offers three one-tap starter expressions when it is empty', async () => {
    renderScreen(<LexiconScreen />, { route: '/maintain/lexicon', demo: { entries: [] } });
    expect(await screen.findByText(/Your Lexicon is empty\./)).toBeInTheDocument();
    for (const headword of ['no way', 'it depends', 'to let it slide']) {
      expect(await screen.findByRole('button', { name: headword })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: 'no way' }));
    expect(await screen.findByText('1 entry')).toBeInTheDocument();
    expect(screen.queryByText(/Your Lexicon is empty\./)).not.toBeInTheDocument();
  });

  it('filters to the entries nobody has reviewed', async () => {
    renderScreen(<LexiconScreen />, { route: '/maintain/lexicon' });
    await screen.findByRole('button', { name: /ni de coña/ });
    await userEvent.click(screen.getByRole('button', { name: 'Unverified' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /ni de coña/ })).not.toBeInTheDocument(),
    );
  });
});

describe('an entry', () => {
  const at = { route: '/maintain/lexicon/e3', path: '/maintain/lexicon/:entryId' };

  it('shows each sense with its equivalents, fit and state', async () => {
    // The fit sheet stays in the tree while closed, so the screen's own
    // container is what these assertions look at.
    const { container } = renderScreen(<EntryScreen />, at);
    expect(await screen.findByText('actually')).toBeInTheDocument();
    expect(within(container).getByText('Sense 1 · in fact')).toBeInTheDocument();
    expect(within(container).getByText('false friend')).toBeInTheDocument();
    expect(within(container).getByText('waiting')).toBeInTheDocument();
  });

  it('keeps the closed fit sheet out of reach', async () => {
    renderScreen(<EntryScreen />, at);
    await screen.findByText('actually');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('[role="dialog"]')?.closest('[inert]')).not.toBeNull();
  });

  it('records a fit chosen in the sheet', async () => {
    renderScreen(<EntryScreen />, at);
    await screen.findByText('actually');
    await userEvent.click(screen.getAllByRole('button', { name: /Fix the .* equivalent/ })[0]!);
    const sheet = await screen.findByRole('dialog', { name: 'How well does it fit?' });
    await userEvent.click(within(sheet).getByRole('button', { name: /narrower/i }));
    expect(await screen.findByText('Marked as narrower.')).toBeInTheDocument();
  });

  it('closes the sheet on Escape', async () => {
    renderScreen(<EntryScreen />, at);
    await screen.findByText('actually');
    await userEvent.click(screen.getAllByRole('button', { name: /Fix the .* equivalent/ })[0]!);
    await screen.findByRole('dialog', { name: 'How well does it fit?' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('adds another sense only once it has a gloss', async () => {
    const { container } = renderScreen(<EntryScreen />, at);
    await screen.findByText('actually');
    await userEvent.click(screen.getByRole('button', { name: 'Add another sense' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add another sense' });
    const save = within(sheet).getByRole('button', { name: 'Add this sense' });
    expect(save).toBeDisabled();
    await userEvent.type(within(sheet).getByRole('textbox', { name: /What does it mean/ }), '   ');
    expect(save).toBeDisabled();

    await userEvent.type(within(sheet).getByRole('textbox', { name: /What does it mean/ }), 'as it happens');
    await userEvent.click(save);
    expect(await within(container).findByText('Sense 3 · as it happens')).toBeInTheDocument();
  });

  it('offers a retry when a translation failed, and says nothing was dropped', async () => {
    renderScreen(<EntryScreen />, { route: '/maintain/lexicon/e4', path: '/maintain/lexicon/:entryId' });
    expect(await screen.findByText('Translation failed. Nothing was dropped.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.queryByText('Translation failed. Nothing was dropped.')).not.toBeInTheDocument(),
    );
  });
});

describe('adding an entry', () => {
  it('will not translate an empty capture', async () => {
    renderScreen(<AddEntryScreen />, { route: '/maintain/add' });
    expect(await screen.findByRole('button', { name: /Translate/ })).toBeDisabled();
  });

  it('moves each candidate from waiting to suggested, then confirms it', async () => {
    renderScreen(<AddEntryScreen />, { route: '/maintain/add' });
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Word or expression' }),
      'to let it slide',
    );
    await userEvent.click(screen.getByRole('button', { name: /Translate/ }));
    expect(await screen.findByText('dejar pasar')).toBeInTheDocument();
    expect(screen.getAllByText('suggested').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: /Confirm the Español equivalent/ }));
    expect(await screen.findByText('confirmed')).toBeInTheDocument();
  });

  it('says a suggestion stays out of practice until it is confirmed', async () => {
    renderScreen(<AddEntryScreen />, { route: '/maintain/add' });
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Word or expression' }),
      'to let it slide',
    );
    await userEvent.click(screen.getByRole('button', { name: /Translate/ }));
    expect(
      await screen.findByText(/stays out of practice until you confirm it/),
    ).toBeInTheDocument();
  });
});

describe('practice', () => {
  const props = {
    format: 'cloze' as const,
    title: 'Practice',
    mode: 'maintain' as const,
    modeLabel: 'Maintain',
  };

  it('gives a prompt before the answer when the answer is wrong', async () => {
    renderScreen(<PracticeScreen {...props} />, { route: '/maintain/practice' });
    const field = await screen.findByRole('textbox', { name: /Your answer/ });
    await userEvent.type(field, 'nope{Enter}');
    expect(await screen.findByText(/Not quite\./)).toBeInTheDocument();
    expect(screen.queryByText(/The answer is/)).not.toBeInTheDocument();

    await userEvent.clear(screen.getByRole('textbox', { name: /Your answer/ }));
    await userEvent.type(screen.getByRole('textbox', { name: /Your answer/ }), 'still no{Enter}');
    expect(await screen.findByText(/It comes back later this session\./)).toBeInTheDocument();
  });

  it('accepts a right answer and moves on', async () => {
    renderScreen(<PracticeScreen {...props} />, { route: '/maintain/practice' });
    const field = await screen.findByRole('textbox', { name: /Your answer/ });
    await userEvent.type(field, 'made do with{Enter}');
    expect(await screen.findByText(/Right —/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('2 of 3 due')).toBeInTheDocument();
  });

  it('brings a card that was missed back later in the same session', async () => {
    renderScreen(<PracticeScreen {...props} />, { route: '/maintain/practice' });
    const prompt = await screen.findByText(/We didn’t have flour/);
    expect(prompt).toBeInTheDocument();

    await userEvent.type(await screen.findByRole('textbox', { name: /Your answer/ }), 'wrong{Enter}');
    await userEvent.type(screen.getByRole('textbox', { name: /Your answer/ }), 'wrong again{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));

    expect(screen.queryByText(/We didn’t have flour/)).not.toBeInTheDocument();
    expect(await screen.findByText('ni de coña')).toBeInTheDocument();
  });

  it('offers what is coming when the queue empties', async () => {
    renderScreen(<PracticeScreen {...props} />, { route: '/maintain/practice' });
    for (const answer of ['made do with', 'no way', 'dar por sentado']) {
      const field = await screen.findByRole('textbox', { name: /Your answer/ });
      await userEvent.type(field, `${answer}{Enter}`);
      await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    }
    expect(await screen.findByText('That is everything due.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Practise what is coming' }));
    expect(await screen.findByText('after-dinner conversation')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 ahead of time')).toBeInTheDocument();
  });

  it('lets the Flashcards tab keep its format', async () => {
    renderScreen(
      <PracticeScreen format="flashcard" allowFormatChange={false} title="Flashcards" mode="maintain" modeLabel="Maintain" />,
      { route: '/maintain/flashcards' },
    );
    await screen.findByText('1 of 3 due');
    expect(screen.queryByRole('radiogroup', { name: 'Practice format' })).not.toBeInTheDocument();
  });
});

describe('progress', () => {
  it('says practice is due in words, never as a count', async () => {
    renderScreen(<ProgressScreen />, { route: '/maintain/progress' });
    expect(await screen.findByText('Practice is due')).toBeInTheDocument();
    expect(screen.queryByText(/\d+ due/)).not.toBeInTheDocument();
  });

  it('says nothing is due once Maintain practice is done, whatever Learn holds', async () => {
    const client = createDemoClient({ suggestionDelaysMs: {} });
    for (const card of (await client.getDueQueue({ mode: 'maintain' })).cards) {
      await client.submitReview({ cardId: card.cardId, rating: 'good', format: 'cloze', submissionId: card.cardId });
    }
    renderScreen(<ProgressScreen />, { route: '/maintain/progress', client });
    expect(await screen.findByText(/Nothing is due\./)).toBeInTheDocument();
  });

  it('reports retention and never a streak or a point', async () => {
    renderScreen(<ProgressScreen />, { route: '/maintain/progress' });
    expect(await screen.findByRole('heading', { name: 'Progress' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Retention in Русский: recognise 22%, produce not practised yet/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/streak/i)).toHaveTextContent(/There are no streaks/);
  });
});

describe('learn', () => {
  it('shows all 33 letters and filters to the Latin lookalikes', async () => {
    renderScreen(<AlphabetScreen />, { route: '/learn/alphabet' });
    const list = await screen.findByRole('list', { name: 'The Russian alphabet' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(33);
    await userEvent.click(screen.getByRole('button', { name: 'Look Latin, are not' }));
    await waitFor(() =>
      expect(within(screen.getByRole('list', { name: 'The Russian alphabet' })).getAllByRole('listitem')
        .length).toBeLessThan(33),
    );
    expect(screen.getByRole('button', { name: /looks like B/ })).toBeInTheDocument();
  });

  it('shows the resume card, the units and the can-do milestones', async () => {
    renderScreen(<CourseScreen />, { route: '/learn/course' });
    expect(await screen.findByRole('button', { name: /Continue · Unit 3/ })).toBeInTheDocument();
    expect(screen.getByText('Can-do milestones')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ско́лько сто́ит\?/ })).toBeDisabled();
  });
});
