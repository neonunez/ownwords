import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  Chip,
  Icon,
  IconButton,
  StateLabel,
  Switch,
  TextField,
  TopBar,
} from '../../../design-system';
import { Note, Screen, Spacer } from '../../layout';
import { useAsync } from '../../shell/useAsync';
import { useClient } from '../../shell/ClientProvider';
import { useToast } from '../../shell/ToastProvider';
import type { EntryKind, LanguageTag, SuggestionResult } from '../../../api/types';

type Step = 'capture' | 'review';
type Candidate = { state: 'waiting' | 'suggested' | 'confirmed' | 'failed'; text: string };

/**
 * Capture, then optional auto-translation, then review each candidate, then
 * save. The note is what keeps false friends out, so it is asked for here and
 * never afterwards.
 */
export function AddEntryScreen() {
  const client = useClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const prefilled = (location.state as { headword?: string } | null)?.headword ?? '';

  const [step, setStep] = useState<Step>('capture');
  const [headword, setHeadword] = useState(prefilled);
  const [note, setNote] = useState('');
  const [language, setLanguage] = useState<LanguageTag>('en');
  const [kind, setKind] = useState<EntryKind>('expression');
  const [suggest, setSuggest] = useState(true);
  // Every language starts out waiting; each answer replaces its own row.
  const [candidates, setCandidates] = useState<Record<string, Candidate>>({});

  const languages = useAsync(() => client.listLanguages(), [client]);
  const others = (languages.data ?? [])
    .map((entry) => entry.code)
    .filter((code) => code !== language);

  useEffect(() => {
    if (step !== 'review' || !suggest || others.length === 0) return;
    const controller = new AbortController();
    void client.requestSuggestions(
      { headword, language, note },
      others,
      (result: SuggestionResult) => {
        setCandidates((current) => ({
          ...current,
          [result.language]: { state: result.state, text: result.text },
        }));
      },
      controller.signal,
    );
    return () => controller.abort();
    // The review step runs one round of suggestions when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const nameOf = (code: string) =>
    languages.data?.find((entry) => entry.code === code)?.name ?? code.toUpperCase();

  const save = async () => {
    await client.createEntry({
      headword,
      note,
      kind,
      language,
      suggestInto: suggest ? others : [],
    });
    navigate('/maintain/lexicon');
    showToast('Saved to your Lexicon.', { icon: 'check' });
  };

  if (step === 'capture') {
    return (
      <>
        <TopBar title="New entry" onBack={() => navigate('/maintain/lexicon')} backLabel="Back to your Lexicon" />
        <Screen>
          <div role="group" aria-label="The language you are writing in" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(languages.data ?? []).map((option) => (
              <Chip
                key={option.code}
                size="sm"
                lang={option.code}
                selected={language === option.code}
                onClick={() => setLanguage(option.code)}
              >
                {option.name}
              </Chip>
            ))}
          </div>

          <TextField
            label="Word or expression"
            name="headword"
            display
            size="lg"
            lang={language}
            value={headword}
            onChange={setHeadword}
            placeholder="Whatever you keep saying"
          />

          <div role="group" aria-label="What you stored" style={{ display: 'flex', gap: 8 }}>
            <Chip size="sm" selected={kind === 'expression'} onClick={() => setKind('expression')}>
              An expression
            </Chip>
            <Chip size="sm" selected={kind === 'word'} onClick={() => setKind('word')}>
              A word
            </Chip>
          </div>

          <TextField
            label="What do you mean by it?"
            name="note"
            multiline
            value={note}
            onChange={setNote}
            placeholder="A situation, a tone, a person you say it to"
            hint="Optional. This note is what keeps false friends out."
          />

          <Card tone="sunken" padding={14}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div id="suggest-label" style={{ font: 'var(--type-label)' }}>
                  Suggest translations
                </div>
                <div style={{ font: 'var(--type-caption)', color: 'var(--fg-3)' }}>
                  Into {others.map(nameOf).join(' and ')}. You review each one.
                </div>
              </div>
              <Switch
                checked={suggest}
                labelledBy="suggest-label"
                label="Suggest translations"
                onChange={setSuggest}
              />
            </div>
          </Card>

          <Spacer />
          <Button
            size="lg"
            full
            disabled={!headword.trim()}
            iconRight="arrow-right"
            onClick={() => (suggest ? setStep('review') : void save())}
          >
            {suggest ? 'Translate' : 'Save entry'}
          </Button>
        </Screen>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Review translations"
        onBack={() => {
          setCandidates({});
          setStep('capture');
        }}
        backLabel="Back to the entry"
      />
      <Screen>
        <div style={{ padding: '0 4px' }}>
          <p
            style={{
              margin: 0,
              font: 'var(--type-overline)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
              color: 'var(--fg-3)',
            }}
          >
            {nameOf(language)}
          </p>
          <p
            lang={language}
            style={{ margin: '4px 0 0', font: 'var(--type-title)', letterSpacing: 'var(--tracking-display)' }}
          >
            {headword}
          </p>
          {note && (
            <p style={{ margin: '4px 0 0', font: 'var(--type-caption)', color: 'var(--fg-2)' }}>“{note}”</p>
          )}
        </div>

        <Card padding={0}>
          {others.map((code, index) => {
            const candidate = candidates[code] ?? { state: 'waiting' as const, text: '' };
            return (
              <div
                key={code}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '32px minmax(0, 1fr) auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '14px 16px',
                  minHeight: 72,
                  borderBottom: index < others.length - 1 ? '1px solid var(--border-1)' : 0,
                }}
              >
                <span
                  style={{ font: 'var(--type-overline)', letterSpacing: '.06em', color: 'var(--fg-3)' }}
                >
                  {code.toUpperCase()}
                </span>

                {candidate.state === 'waiting' ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 99,
                          background: 'var(--state-waiting)',
                          animation: 'ow-pulse 1s var(--ease-in-out) infinite',
                        }}
                      />
                      <span style={{ font: 'var(--type-body)', color: 'var(--fg-3)' }}>
                        Translating into {nameOf(code)}.
                      </span>
                    </div>
                    <StateLabel state="waiting" />
                  </>
                ) : candidate.state === 'failed' ? (
                  <>
                    <div>
                      <div style={{ font: 'var(--type-body)', color: 'var(--fg-2)' }}>
                        Translation failed. Nothing was dropped.
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <StateLabel state="failed" />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setCandidates((current) => ({
                          ...current,
                          [code]: { state: 'suggested', text: headword },
                        }))
                      }
                    >
                      Retry
                    </Button>
                  </>
                ) : (
                  <>
                    <div>
                      <div
                        lang={code}
                        style={{
                          font: 'var(--type-headword)',
                          fontSize: '1.125rem',
                          letterSpacing: 'var(--tracking-display)',
                        }}
                      >
                        {candidate.text}
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <StateLabel state={candidate.state === 'confirmed' ? 'confirmed' : 'suggested'} />
                      </div>
                    </div>
                    {candidate.state === 'confirmed' ? (
                      <Icon name="check" size={20} color="var(--state-confirmed)" />
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <IconButton
                          name="check"
                          label={`Confirm the ${nameOf(code)} equivalent`}
                          variant="tonal"
                          onClick={() =>
                            setCandidates((current) => ({
                              ...current,
                              [code]: { state: 'confirmed', text: candidate.text },
                            }))
                          }
                        />
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </Card>

        <Note>
          A suggestion stays out of practice until you confirm it, and nothing is dropped if one fails.
        </Note>

        <Spacer />
        <Button size="lg" full icon="check" onClick={() => void save()}>
          Save entry
        </Button>
      </Screen>
    </>
  );
}
