import { useId, useState } from "react";
import {
  Button,
  Card,
  Chip,
  SegmentedControl,
  Switch,
} from "../../design-system";
import { Note, Section } from "../layout";
import { ownName } from "../../lib/languages";
import type {
  ExplanationLanguage,
  LanguageLevel,
  Onboarding,
} from "../../api/types";

/** Languages offered to maintain. Any language already on the profile is kept too. */
const OFFERED = ["en", "es", "fr", "de", "it", "pt", "ru"];

/** The course is Russian; the backend has no other course to learn yet. */
const LEARNABLE = ["ru"];

/** Maintain is for languages already spoken at an intermediate level or above. */
const SPOKEN_LEVELS: { value: LanguageLevel; label: string }[] = [
  { value: "native", label: "Native" },
  { value: "b1", label: "B1" },
  { value: "b2", label: "B2" },
  { value: "c1", label: "C1" },
  { value: "c2", label: "C2" },
];

const EXPLANATIONS: { value: ExplanationLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

const DEFAULTS: Onboarding = {
  languages: [],
  preferences: {
    explanationsIn: "en",
    // The backend still carries the preference; the course ships no
    // recordings, so the form never asks and never changes it.
    audioInCourse: true,
    suggestTranslations: true,
  },
};

/**
 * What the first run asks, and only that: the languages and their levels,
 * then the two preferences the course can honour — the language of
 * explanations, and whether translations are suggested. It never asks for a
 * daily time budget or for notification permission.
 */
export function LanguageForm({
  initial = DEFAULTS,
  submitLabel,
  onSubmit,
}: {
  initial?: Onboarding;
  submitLabel: string;
  /** Rejects with a written error, which the form shows. */
  onSubmit: (next: Onboarding) => Promise<void>;
}) {
  const suggestId = useId();
  const [spoken, setSpoken] = useState<Record<string, LanguageLevel>>(() =>
    Object.fromEntries(
      initial.languages
        .filter((language) => language.kind === "maintain")
        .map((language) => [language.code, language.level]),
    ),
  );
  const [learn, setLearn] = useState<string | null>(
    () =>
      initial.languages.find((language) => language.kind === "learn")?.code ??
      null,
  );
  const [preferences, setPreferences] = useState(initial.preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offered = [
    ...OFFERED,
    ...Object.keys(spoken).filter((code) => !OFFERED.includes(code)),
  ];
  const learnable = LEARNABLE.filter((code) => !(code in spoken));
  const ready = Object.keys(spoken).length > 0;

  const choose = (code: string, level: LanguageLevel) => {
    setSpoken((current) => {
      const next = { ...current };
      // Tapping the chosen level again takes the language off.
      if (next[code] === level) delete next[code];
      else next[code] = level;
      return next;
    });
    if (code === learn) setLearn(null);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        languages: [
          ...Object.entries(spoken).map(([code, level]) => ({
            code,
            kind: "maintain" as const,
            level,
          })),
          ...(learn && !(learn in spoken)
            ? [{ code: learn, kind: "learn" as const, level: "a0" as const }]
            : []),
        ],
        preferences,
      });
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Your languages were not saved. Try again.",
      );
      setSaving(false);
    }
  };

  return (
    <>
      <Section title="The languages you speak">
        <Card padding={0}>
          {offered.map((code, index) => (
            <div
              key={code}
              role="group"
              aria-label={`${ownName(code)}: how well you speak it`}
              style={{
                display: "grid",
                gap: 8,
                padding: "12px 16px",
                borderBottom:
                  index < offered.length - 1 ? "1px solid var(--border-1)" : 0,
              }}
            >
              <span
                lang={code}
                style={{
                  font: "var(--type-headword)",
                  fontSize: "1.0625rem",
                }}
              >
                {ownName(code)}
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SPOKEN_LEVELS.map((level) => (
                  <Chip
                    key={level.value}
                    size="sm"
                    selected={spoken[code] === level.value}
                    onClick={() => choose(code, level.value)}
                  >
                    {level.label}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
        </Card>
        <Note>
          Pick a level for each language you already speak. Tap it again to take
          the language off.
        </Note>
      </Section>

      {learnable.length > 0 && (
        <Section title="Learn from zero">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {learnable.map((code) => (
              <Chip
                key={code}
                lang={code}
                selected={learn === code}
                onClick={() => setLearn(learn === code ? null : code)}
              >
                {ownName(code)}
              </Chip>
            ))}
          </div>
          <Note>
            The course starts at the alphabet. Leave it off to only keep your
            own words.
          </Note>
        </Section>
      )}

      <Section title="Preferences">
        <Card padding={0}>
          <div
            style={{
              display: "grid",
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--border-1)",
            }}
          >
            <span style={{ font: "var(--type-body)" }}>Explanations in</span>
            <SegmentedControl
              label="Explanations in"
              options={EXPLANATIONS}
              value={preferences.explanationsIn}
              onChange={(explanationsIn) =>
                setPreferences((current) => ({ ...current, explanationsIn }))
              }
            />
          </div>
          <div style={{ ...row, borderBottom: 0 }}>
            <span id={suggestId}>Suggest translations</span>
            <Switch
              checked={preferences.suggestTranslations}
              labelledBy={suggestId}
              label="Suggest translations"
              onChange={(suggestTranslations) =>
                setPreferences((current) => ({
                  ...current,
                  suggestTranslations,
                }))
              }
            />
          </div>
        </Card>
      </Section>

      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            background: "var(--state-failed-soft)",
            font: "var(--type-body)",
            fontSize: ".9375rem",
          }}
        >
          {error}
        </p>
      )}

      <Button
        size="lg"
        full
        icon="check"
        disabled={!ready || saving}
        onClick={() => void submit()}
      >
        {submitLabel}
      </Button>
      {!ready && <Note>Choose at least one language you speak.</Note>}
    </>
  );
}

const row = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 10,
  alignItems: "center",
  padding: "6px 16px",
  minHeight: 52,
  borderBottom: "1px solid var(--border-1)",
  font: "var(--type-body)",
} as const;
