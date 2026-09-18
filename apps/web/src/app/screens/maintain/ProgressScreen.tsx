import { useNavigate } from 'react-router-dom';
import { Card, Icon, Mascot, MasteryMeter, TopBar } from '../../../design-system';
import { Note, Screen, Section } from '../../layout';
import { Failed, Loading } from '../ScreenState';
import { useAsync } from '../../shell/useAsync';
import { useClient } from '../../shell/ClientProvider';
import { useScreen } from '../../shell/useScreen';
import type { Language, LanguageProgress } from '../../../api/types';

interface Row {
  language: Language;
  recognise: number | null;
  produce: number | null;
  due: boolean;
}

function rowsFor(languages: readonly Language[], progress: readonly LanguageProgress[], now: number): Row[] {
  return languages
    .filter((language) => language.role !== 'native')
    .map((language) => {
      const forLanguage = progress.filter((entry) => entry.language === language.code);
      const direction = (which: 'recognise' | 'produce') =>
        forLanguage.find((entry) => entry.direction === which)?.retention ?? null;
      return {
        language,
        recognise: direction('recognise'),
        produce: direction('produce'),
        due: forLanguage.some((entry) => entry.nextDueAt !== null && Date.parse(entry.nextDueAt) <= now),
      };
    });
}

/** Retention and what is coming. No streaks, no points, no card counts. */
export function ProgressScreen() {
  const client = useClient();
  const navigate = useNavigate();
  const { openPanel } = useScreen();
  const state = useAsync(
    async () => {
      const [progress, languages] = await Promise.all([
        client.getProgress(),
        client.listLanguages(),
      ]);
      return { progress, languages, rows: rowsFor(languages, progress.perLanguage, Date.now()) };
    },
    [client],
  );

  if (state.loading && !state.data) {
    return (
      <>
        <TopBar title="Progress" large mode="Maintain" onMenu={openPanel} />
        <Loading label="Reading your progress." />
      </>
    );
  }

  if (state.error || !state.data) {
    return (
      <>
        <TopBar title="Progress" large mode="Maintain" onMenu={openPanel} />
        <Failed message="Your progress could not be read. Nothing was lost." onRetry={state.reload} />
      </>
    );
  }

  const { progress, rows } = state.data;

  return (
    <>
      <TopBar title="Progress" large mode="Maintain" onMenu={openPanel} />
      <Screen>
        {progress.estimate ? (
          <Card tone="accent" padding={18} onClick={() => navigate('/maintain/practice')}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Mascot size={56} color="var(--fg-on-accent)" eye="var(--accent)" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', font: 'var(--type-title)', fontSize: '1.5rem' }}>
                  Practice is due
                </span>
                <span
                  style={{
                    display: 'block',
                    font: 'var(--type-body)',
                    fontSize: '.9375rem',
                    opacity: 0.9,
                    marginTop: 2,
                  }}
                >
                  {progress.estimate} Start practice.
                </span>
              </span>
              <Icon name="arrow-right" size={22} />
            </span>
          </Card>
        ) : (
          <Card tone="soft" padding={18}>
            <p style={{ margin: 0, font: 'var(--type-body)' }}>
              Nothing is due. The scheduler will pick the next words when they are close to slipping.
            </p>
          </Card>
        )}

        <Section title="Retention per language">
          <Card padding={0}>
            {rows.map((row, index) => (
              <div
                key={row.language.code}
                style={{
                  display: 'grid',
                  gap: 10,
                  padding: '14px 16px',
                  borderBottom: index < rows.length - 1 ? '1px solid var(--border-1)' : 0,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <span
                    lang={row.language.code}
                    style={{
                      font: 'var(--type-headword)',
                      fontSize: '1.125rem',
                      letterSpacing: 'var(--tracking-display)',
                    }}
                  >
                    {row.language.name}
                  </span>
                  <span
                    style={{ font: 'var(--type-caption)', color: 'var(--fg-3)', textAlign: 'right' }}
                  >
                    {row.language.level}
                    {row.due ? ' · due now' : ''}
                  </span>
                </div>
                <MasteryMeter
                  recognise={row.recognise}
                  produce={row.produce}
                  labels
                  label={`Retention in ${row.language.name}`}
                />
              </div>
            ))}
          </Card>
        </Section>

        <Section title="Coming up next">
          <Card tone="sunken" padding={14}>
            <div style={{ display: 'grid', gap: 10 }}>
              {progress.comingUp.length === 0 && (
                <p style={{ margin: 0, font: 'var(--type-body)', fontSize: '.9375rem', color: 'var(--fg-2)' }}>
                  Nothing else is scheduled yet.
                </p>
              )}
              {progress.comingUp.map((item) => (
                <div
                  key={`${item.headword}-${item.language}-${item.direction}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    font: 'var(--type-body)',
                    fontSize: '.9375rem',
                  }}
                >
                  <span style={{ color: 'var(--fg-2)' }}>{item.when}</span>
                  <span style={{ textAlign: 'right', minWidth: 0 }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}>
                      {item.headword}
                    </span>
                    <span style={{ color: 'var(--fg-3)' }}>
                      {' '}
                      · {item.language.toUpperCase()} · {item.direction}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Note>
            Retention is the only number here. There are no streaks, no points and no card counts.
          </Note>
        </Section>
      </Screen>
    </>
  );
}
