import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  IconButton,
  MasteryMeter,
  StateLabel,
  TextField,
  TopBar,
} from '../../../design-system';
import { Screen, Section } from '../../layout';
import { Failed, Loading } from '../ScreenState';
import { AppSheet } from '../../shell/OverlayHost';
import { useAsync } from '../../shell/useAsync';
import { useClient } from '../../shell/ClientProvider';
import { useToast } from '../../shell/ToastProvider';
import type { Entry, Equivalent, Fit, Language, Sense } from '../../../api/types';

const fits: { value: Fit; label: string; description: string }[] = [
  { value: 'exact', label: 'Exact', description: 'It means the same, in the same situations.' },
  { value: 'broader', label: 'Broader', description: 'It covers more than I mean.' },
  { value: 'narrower', label: 'Narrower', description: 'It covers less than I mean.' },
  { value: 'context-only', label: 'Context-only', description: 'It works only in some situations.' },
  {
    value: 'false-friend',
    label: 'False friend',
    description: 'It looks right and is wrong. Kept, and marked “not this”.',
  },
];

interface SheetTarget {
  sense: Sense;
  equivalent: Equivalent;
}

export function EntryScreen() {
  const { entryId = '' } = useParams();
  const client = useClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [typed, setTyped] = useState('');

  const state = useAsync(
    async () => ({
      entry: await client.getEntry(entryId),
      languages: await client.listLanguages(),
    }),
    [client, entryId],
  );

  const back = () => navigate('/maintain/lexicon');

  if (state.loading && !state.data) {
    return (
      <>
        <TopBar title="Entry" onBack={back} backLabel="Back to your Lexicon" />
        <Loading label="Reading the entry." />
      </>
    );
  }

  if (state.error || !state.data) {
    return (
      <>
        <TopBar title="Entry" onBack={back} backLabel="Back to your Lexicon" />
        <Failed
          message="That entry could not be read. Nothing was lost."
          onRetry={state.reload}
        />
      </>
    );
  }

  const { entry, languages } = state.data;
  const nameOf = (code: string) =>
    languages.find((language: Language) => language.code === code)?.name ?? code.toUpperCase();

  const apply = async (next: Promise<Entry>, message: string) => {
    const updated = await next;
    state.set({ entry: updated, languages });
    showToast(message, { icon: 'check' });
  };

  const closeSheet = () => {
    setTarget(null);
    setTyped('');
  };

  return (
    <>
      <TopBar
        title="Entry"
        onBack={back}
        backLabel="Back to your Lexicon"
        trailing={
          <IconButton
            name="pencil"
            label="Edit this entry"
            onClick={() => showToast('Editing an entry arrives with the collection backend.')}
          />
        }
      />
      <Screen>
        <div style={{ padding: '4px 4px 0' }}>
          <p
            style={{
              margin: 0,
              font: 'var(--type-overline)',
              letterSpacing: 'var(--tracking-wide)',
              textTransform: 'uppercase',
              color: 'var(--fg-3)',
            }}
          >
            {nameOf(entry.language)} · {entry.kind}
          </p>
          <p
            lang={entry.language}
            style={{
              margin: '6px 0 0',
              font: 'var(--type-hero)',
              fontSize: '2.25rem',
              letterSpacing: 'var(--tracking-display)',
            }}
          >
            {entry.headword}
          </p>
          {entry.note && (
            <p style={{ margin: '8px 0 0', font: 'var(--type-body)', color: 'var(--fg-2)' }}>
              “{entry.note}”
            </p>
          )}
        </div>

        {entry.senses.map((sense, index) => (
          <Section
            key={sense.id}
            title={entry.senses.length > 1 ? `Sense ${index + 1} · ${sense.gloss}` : sense.gloss}
          >
            <Card padding={0}>
              {sense.equivalents.length === 0 && (
                <p style={{ margin: 0, padding: '16px', font: 'var(--type-body)', color: 'var(--fg-3)' }}>
                  No equivalents on this sense yet.
                </p>
              )}
              {sense.equivalents.map((equivalent, position) => (
                <div
                  key={equivalent.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px minmax(0, 1fr) auto',
                    gap: 12,
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderBottom:
                      position < sense.equivalents.length - 1 ? '1px solid var(--border-1)' : 0,
                  }}
                >
                  <span
                    style={{
                      font: 'var(--type-overline)',
                      letterSpacing: '.06em',
                      color: 'var(--fg-3)',
                    }}
                  >
                    {equivalent.language.toUpperCase()}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    {equivalent.text ? (
                      <div
                        lang={equivalent.language}
                        style={{
                          font: 'var(--type-headword)',
                          fontSize: '1.125rem',
                          letterSpacing: 'var(--tracking-display)',
                          textDecoration: equivalent.fit === 'false-friend' ? 'line-through' : 'none',
                          color: equivalent.fit === 'false-friend' ? 'var(--fg-3)' : 'var(--fg-1)',
                        }}
                      >
                        {equivalent.text}
                      </div>
                    ) : (
                      <div style={{ font: 'var(--type-body)', color: 'var(--fg-3)' }}>
                        {equivalent.state === 'failed'
                          ? 'Translation failed. Nothing was dropped.'
                          : 'Waiting for a translation.'}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {equivalent.fit && <StateLabel state={equivalent.fit} />}
                      <StateLabel state={equivalent.state} />
                    </div>
                  </div>
                  {equivalent.state === 'failed' ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void apply(
                          client.retryTranslation(entry.id, sense.id, equivalent.id),
                          `Translated into ${nameOf(equivalent.language)}.`,
                        )
                      }
                    >
                      Retry
                    </Button>
                  ) : (
                    <IconButton
                      name="more-horizontal"
                      label={`Fix the ${nameOf(equivalent.language)} equivalent`}
                      onClick={() => setTarget({ sense, equivalent })}
                    />
                  )}
                </div>
              ))}
            </Card>
          </Section>
        ))}

        <Section title="Mastery">
          <Card padding={14}>
            <div style={{ display: 'grid', gap: 12 }}>
              {Object.entries(entry.mastery).length === 0 && (
                <p style={{ margin: 0, font: 'var(--type-body)', color: 'var(--fg-3)' }}>
                  Not practised yet. It joins the queue once an equivalent is confirmed.
                </p>
              )}
              {Object.entries(entry.mastery).map(([code, mastery]) => (
                <div key={code} style={{ display: 'grid', gap: 8 }}>
                  <span style={{ font: 'var(--type-label)' }}>{nameOf(code)}</span>
                  <MasteryMeter
                    recognise={mastery.recognise}
                    produce={mastery.produce}
                    labels
                    label={`Mastery in ${nameOf(code)}`}
                  />
                </div>
              ))}
            </div>
          </Card>
        </Section>

        <Button
          variant="ghost"
          icon="plus"
          full
          onClick={() => void apply(client.addSense(entry.id, 'A new sense'), 'Sense added.')}
        >
          Add another sense
        </Button>
      </Screen>

      <AppSheet
        open={target !== null}
        title="How well does it fit?"
        onClose={closeSheet}
        footer={
          <Button variant="ghost" full onClick={closeSheet}>
            Cancel
          </Button>
        }
      >
        <div style={{ display: 'grid', gap: 8 }}>
          {fits.map((option) => (
            <button
              key={option.value}
              type="button"
              className="ow-press-card"
              onClick={() => {
                if (!target) return;
                const { sense, equivalent } = target;
                closeSheet();
                void apply(
                  client.updateEquivalent(entry.id, sense.id, equivalent.id, {
                    fit: option.value,
                    state: 'confirmed',
                  }),
                  `Marked as ${option.label.toLowerCase()}.`,
                );
              }}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr)',
                gap: 12,
                alignItems: 'center',
                textAlign: 'left',
                padding: '12px 14px',
                minHeight: 52,
                border: '1px solid var(--border-1)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-surface)',
                cursor: 'pointer',
                font: 'inherit',
                color: 'inherit',
              }}
            >
              <StateLabel state={option.value} />
              <span style={{ font: 'var(--type-caption)', color: 'var(--fg-2)', fontSize: '.8125rem' }}>
                {option.description}
              </span>
            </button>
          ))}
          <TextField
            label="Or type the equivalent yourself"
            name="equivalent"
            display
            value={typed}
            onChange={setTyped}
            placeholder="Your own wording"
            hint="Typed by hand always wins over a suggestion."
            lang={target?.equivalent.language}
          />
          <Button
            full
            disabled={!typed.trim()}
            icon="check"
            onClick={() => {
              if (!target || !typed.trim()) return;
              const { sense, equivalent } = target;
              const text = typed.trim();
              closeSheet();
              void apply(
                client.updateEquivalent(entry.id, sense.id, equivalent.id, { text }),
                'Saved, typed by hand.',
              );
            }}
          >
            Save this wording
          </Button>
        </div>
      </AppSheet>
    </>
  );
}
