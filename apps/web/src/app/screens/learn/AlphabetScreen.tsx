import { useState } from 'react';
import { Card, Chip, StateLabel, TopBar } from '../../../design-system';
import { Note, Screen } from '../../layout';
import { Failed, Loading } from '../ScreenState';
import { useAsync } from '../../shell/useAsync';
import { useClient } from '../../shell/ClientProvider';
import { useScreen } from '../../shell/useScreen';
import type { AlphabetLetter } from '../../../api/types';

type Filter = 'all' | 'traps' | 'same';

const filters: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All 33' },
  { key: 'traps', label: 'Look Latin, are not' },
  { key: 'same', label: 'Same as Latin' },
];

/**
 * The page opened most for months, so it earns a tab. Letters that look Latin
 * but are not are marked in words as well as in plum.
 */
export function AlphabetScreen() {
  const client = useClient();
  const { openPanel } = useScreen();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<AlphabetLetter | null>(null);
  const state = useAsync(() => client.getAlphabet(), [client]);

  const header = <TopBar title="Alphabet" large mode="Learn · Русский" onMenu={openPanel} />;

  if (state.loading && !state.data) {
    return (
      <>
        {header}
        <Loading label="Reading the alphabet." />
      </>
    );
  }
  if (state.error || !state.data) {
    return (
      <>
        {header}
        <Failed message="The alphabet could not be read. Nothing was lost." onRetry={state.reload} />
      </>
    );
  }

  const letters = state.data.filter((letter) =>
    filter === 'all' ? true : filter === 'traps' ? letter.trap !== null : letter.sameAsLatin,
  );

  return (
    <>
      {header}
      <Screen style={{ gap: 14 }}>
        <div role="group" aria-label="Filter the alphabet" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {filters.map((option) => (
            <Chip key={option.key} selected={filter === option.key} onClick={() => setFilter(option.key)}>
              {option.label}
            </Chip>
          ))}
        </div>

        <ul
          aria-label="The Russian alphabet"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 8,
            margin: 0,
            padding: 0,
            listStyle: 'none',
          }}
        >
          {letters.map((letter) => (
            <li key={letter.upper}>
              <Card
                padding={10}
                onClick={() => setSelected(letter)}
                aria-label={`${letter.upper} ${letter.lower}, sounds like ${letter.sound}${
                  letter.trap ? `, ${letter.trap}` : ''
                }`}
                style={{
                  display: 'grid',
                  gap: 2,
                  textAlign: 'center',
                  minHeight: 88,
                  alignContent: 'center',
                  borderColor: letter.trap ? 'var(--state-false-friend)' : undefined,
                }}
              >
                <span
                  lang="ru"
                  aria-hidden="true"
                  style={{ font: 'var(--type-hero)', fontSize: '2rem', letterSpacing: 'var(--tracking-display)' }}
                >
                  {letter.upper}
                  <span style={{ fontSize: '1.25rem', color: 'var(--fg-3)' }}>{letter.lower}</span>
                </span>
                <span aria-hidden="true" style={{ font: 'var(--type-caption)', color: 'var(--fg-2)' }}>
                  {letter.sound}
                </span>
                {letter.trap && (
                  <span
                    aria-hidden="true"
                    style={{
                      font: 'var(--type-caption)',
                      fontSize: '.625rem',
                      color: 'var(--state-false-friend)',
                    }}
                  >
                    {letter.trap}
                  </span>
                )}
              </Card>
            </li>
          ))}
        </ul>

        {selected && (
          <Card padding={16} style={{ display: 'grid', gap: 8 }}>
            <p style={{ margin: 0, font: 'var(--type-body)' }}>
              <span lang="ru" style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem' }}>
                {selected.upper} {selected.lower}
              </span>{' '}
              sounds like “{selected.sound}”.
            </p>
            {selected.trap ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <StateLabel state="false-friend" text={selected.trap} />
                <span style={{ font: 'var(--type-caption)', color: 'var(--fg-2)' }}>
                  A Latin reader reads this one wrong first.
                </span>
              </div>
            ) : selected.sameAsLatin ? (
              <p style={{ margin: 0, font: 'var(--type-caption)', color: 'var(--fg-2)' }}>
                This one reads exactly as it looks.
              </p>
            ) : null}
          </Card>
        )}

        <Note>
          Stress is written with the combining acute in the course. You never have to type it, and search
          ignores it.
        </Note>
      </Screen>
    </>
  );
}
