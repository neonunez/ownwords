import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  ChoiceGroup,
  Icon,
  IconButton,
  SegmentedControl,
  Select,
  Switch,
  type IconName,
} from "../../design-system";
import { Note, Section } from "../layout";
import {
  LEARNABLE,
  MAINTAINABLE,
  MOST_LANGUAGES,
  byOwnName,
  englishName,
  ownName,
} from "../../lib/languages";
import type {
  ExplanationLanguage,
  LanguageLevel,
  Onboarding,
} from "../../api/types";

/** Maintain is for languages already spoken at an intermediate level or above. */
const SPOKEN_LEVELS: { value: LanguageLevel; label: string }[] = [
  { value: "native", label: "Native" },
  { value: "b1", label: "B1" },
  { value: "b2", label: "B2" },
  { value: "c1", label: "C1" },
  { value: "c2", label: "C2" },
];

/** What each level means, in the words a person would use about themselves. */
const LEVEL_MEANING: Record<LanguageLevel, string> = {
  native: "You grew up with it.",
  c2: "Precise and effortless, even on hard topics.",
  c1: "Fluent and flexible, at work and in study.",
  b2: "At ease in most conversations.",
  b1: "You get by on familiar topics.",
  a2: "Simple, everyday exchanges.",
  a1: "Your first words and phrases.",
  a0: "Starting from zero.",
};

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

interface Spoken {
  code: string;
  /** `null` until the person says how well they speak it. */
  level: LanguageLevel | null;
}

/** "Deutsch · German": the name a speaker looks for, then the app's own. */
function listName(code: string): string {
  const own = ownName(code);
  const english = englishName(code);
  return own.toLocaleLowerCase() === english.toLocaleLowerCase()
    ? own
    : `${own} · ${english}`;
}

/** "English", "English and Español", "English, Español and Deutsch". */
function joined(names: readonly string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What the first run asks, and only that: the languages and their levels,
 * then the two preferences the course can honour — the language of
 * explanations, and whether translations are suggested. It never asks for a
 * daily time budget or for notification permission.
 *
 * The two kinds of language are asked for apart, because they do different
 * things: a language already spoken is kept up, at the level the person says
 * they have; a language learned starts from zero, in the course.
 */
export function LanguageForm({
  initial = DEFAULTS,
  submitLabel,
  askPreferences = true,
  onSubmit,
}: {
  initial?: Onboarding;
  submitLabel: string;
  /** The first run asks the preferences too; Settings keeps them apart. */
  askPreferences?: boolean;
  /** Rejects with a written error, which the form shows. */
  onSubmit: (next: Onboarding) => Promise<void>;
}) {
  const suggestId = useId();
  const levelIds = useId();
  const [spoken, setSpoken] = useState<Spoken[]>(() =>
    initial.languages
      .filter((language) => language.kind === "maintain")
      .map((language) => ({ code: language.code, level: language.level })),
  );
  const [learn, setLearn] = useState<string | null>(
    () =>
      initial.languages.find((language) => language.kind === "learn")?.code ??
      null,
  );
  const [adding, setAdding] = useState("");
  const [preferences, setPreferences] = useState(initial.preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adding a language moves the keyboard to its level, the next thing to say;
  // taking one off returns it to the selector, so focus is never lost.
  const focusNext = useRef<string | null>(null);
  const firstLevel = useRef(new Map<string, HTMLInputElement>());
  const addSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    if (target === "add") addSelect.current?.focus();
    else firstLevel.current.get(target)?.focus();
  });

  const chosen = new Set(spoken.map((language) => language.code));
  const count = spoken.length + (learn ? 1 : 0);
  const full = count >= MOST_LANGUAGES;
  const addable = byOwnName(MAINTAINABLE.filter((code) => !chosen.has(code)));
  // The course languages, less any the person already speaks. A language kept
  // on the profile from before stays choosable, so saving never drops it.
  const learnable = [
    ...LEARNABLE,
    ...(learn && !LEARNABLE.includes(learn) ? [learn] : []),
  ].filter((code) => !chosen.has(code));
  const spokenCourses = LEARNABLE.filter((code) => chosen.has(code));

  const unrated = spoken.filter((language) => language.level === null);
  const ready = spoken.length > 0 && unrated.length === 0;

  const add = () => {
    if (!adding || full) return;
    setSpoken((current) => [...current, { code: adding, level: null }]);
    focusNext.current = adding;
    setAdding("");
  };

  const remove = (code: string) => {
    setSpoken((current) =>
      current.filter((language) => language.code !== code),
    );
    focusNext.current = "add";
  };

  const rate = (code: string, level: LanguageLevel) =>
    setSpoken((current) =>
      current.map((language) =>
        language.code === code ? { ...language, level } : language,
      ),
    );

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        languages: [
          ...spoken.flatMap((language) =>
            language.level
              ? [
                  {
                    code: language.code,
                    kind: "maintain" as const,
                    level: language.level,
                  },
                ]
              : [],
          ),
          ...(learn
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
      <Part
        icon="repeat"
        mode="Maintain"
        title="Languages you already speak"
        lead="Keep up the words and expressions you actually use, in every language you speak. Say how well you speak each one now; Maintain starts at B1."
      >
        {spoken.length > 0 ? (
          <Card padding={0}>
            <ul
              aria-label="Languages you speak"
              style={{ listStyle: "none", margin: 0, padding: 0 }}
            >
              {spoken.map((language, index) => {
                const name = ownName(language.code);
                const meaningId = `${levelIds}-${language.code}`;
                const levels = SPOKEN_LEVELS.some(
                  (level) => level.value === language.level,
                )
                  ? SPOKEN_LEVELS
                  : // A level stored before, outside the usual range, stays
                    // on offer so the profile saves unchanged.
                    [
                      ...SPOKEN_LEVELS,
                      ...(language.level
                        ? [
                            {
                              value: language.level,
                              label: language.level.toUpperCase(),
                            },
                          ]
                        : []),
                    ];
                return (
                  <li
                    key={language.code}
                    style={{
                      display: "grid",
                      gap: 6,
                      padding: "10px 8px 12px 16px",
                      borderBottom:
                        index < spoken.length - 1
                          ? "1px solid var(--border-1)"
                          : 0,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <span style={{ minWidth: 0 }}>
                        <span
                          lang={language.code}
                          style={{
                            font: "var(--type-headword)",
                            fontSize: "1.125rem",
                          }}
                        >
                          {name}
                        </span>
                        {englishName(language.code) !== name && (
                          <span
                            style={{
                              marginLeft: 8,
                              font: "var(--type-caption)",
                              color: "var(--fg-3)",
                            }}
                          >
                            {englishName(language.code)}
                          </span>
                        )}
                      </span>
                      <IconButton
                        name="x"
                        label={`Remove ${name}`}
                        onClick={() => remove(language.code)}
                      />
                    </div>
                    <ChoiceGroup
                      label={`How well you speak ${name}`}
                      options={levels}
                      value={language.level}
                      onChange={(level) => rate(language.code, level)}
                      describedBy={meaningId}
                      firstRef={(node) => {
                        if (node) firstLevel.current.set(language.code, node);
                        else firstLevel.current.delete(language.code);
                      }}
                    />
                    <p
                      id={meaningId}
                      style={{
                        margin: 0,
                        font: "var(--type-caption)",
                        color:
                          language.level === null
                            ? "var(--accent-soft-fg)"
                            : "var(--fg-2)",
                      }}
                    >
                      {language.level === null
                        ? "Choose the level you have now."
                        : LEVEL_MEANING[language.level]}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <Card tone="sunken" padding={16}>
            <p
              style={{
                margin: 0,
                font: "var(--type-body)",
                color: "var(--fg-2)",
              }}
            >
              No languages yet. Add each one you already speak, starting with
              your own.
            </p>
          </Card>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
            alignItems: "end",
            gap: 8,
          }}
        >
          <Select
            ref={addSelect}
            label="Add a language you speak"
            value={adding}
            disabled={full}
            onChange={setAdding}
          >
            <option value="">Choose a language</option>
            {addable.map((code) =>
              // The language being learned cannot be kept up as well: it is
              // shown, so its absence is not a mystery, but not offered.
              code === learn ? (
                <option key={code} value={code} disabled>
                  {`${listName(code)} — you are learning it`}
                </option>
              ) : (
                <option key={code} value={code}>
                  {listName(code)}
                </option>
              ),
            )}
          </Select>
          <Button
            variant="secondary"
            icon="plus"
            disabled={!adding || full}
            onClick={add}
          >
            Add
          </Button>
        </div>
        {full && (
          <Note>
            A profile holds up to {MOST_LANGUAGES} languages. Remove one to add
            another.
          </Note>
        )}
      </Part>

      <Part
        icon="graduation-cap"
        mode="Learn"
        title="A new language, from zero"
        lead="Start at the alphabet, with nothing assumed. Short units each end in something you can say, and what you learn joins your Lexicon."
      >
        <Select
          label="Language to learn"
          value={learn ?? ""}
          disabled={full && !learn}
          onChange={(code) => setLearn(code || null)}
          hint={
            learnable.length === 0
              ? `You already speak ${joined(spokenCourses.map(ownName))}, and there is no other course yet.`
              : learnable.length === 1 && learnable[0]
                ? `One course so far: ${ownName(learnable[0])}, from the alphabet to the first half of A1.`
                : undefined
          }
        >
          <option value="">Not now</option>
          {learnable.map((code) => (
            <option key={code} value={code}>
              {listName(code)}
            </option>
          ))}
        </Select>
        {learn ? (
          <Card tone="soft" padding={14}>
            <p style={{ margin: 0, font: "var(--type-body)" }}>
              <span lang={learn} style={{ font: "var(--type-label)" }}>
                {ownName(learn)}
              </span>{" "}
              starts at A0. The Learn tabs open on its course, with practice,
              the alphabet and a reference beside it.
            </p>
          </Card>
        ) : full ? (
          <Note>
            A profile holds up to {MOST_LANGUAGES} languages. Remove one to add
            another.
          </Note>
        ) : (
          <Note>
            Leave it at “Not now” to keep up only the languages you speak. You
            can start the course later, in Settings.
          </Note>
        )}
      </Part>

      {askPreferences && (
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
      )}

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
      {!ready && (
        <Note>
          {spoken.length === 0
            ? "Add at least one language you speak."
            : `Choose how well you speak ${joined(
                unrated.map((language) => ownName(language.code)),
              )}.`}
        </Note>
      )}
    </>
  );
}

/**
 * One of the two kinds of language: its mode, what it does, then its choices.
 * The heading names the kind, so a screen reader's heading list reads the
 * form's shape.
 */
function Part({
  icon,
  mode,
  title,
  lead,
  children,
}: {
  icon: IconName;
  mode: string;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: 12,
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "40px minmax(0, 1fr)",
          gap: 12,
          alignItems: "start",
          padding: "0 4px",
        }}
      >
        <span
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-md)",
            background: "var(--accent-soft)",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon name={icon} size={20} color="var(--accent-soft-fg)" />
        </span>
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              font: "var(--type-overline)",
              letterSpacing: "var(--tracking-wide)",
              textTransform: "uppercase",
              color: "var(--accent-soft-fg)",
            }}
          >
            {mode}
          </p>
          <h2
            id={headingId}
            style={{
              margin: "2px 0 4px",
              font: "var(--type-title)",
              fontSize: "1.25rem",
            }}
          >
            {title}
          </h2>
          <p
            style={{
              margin: 0,
              font: "var(--type-body)",
              fontSize: ".9375rem",
              color: "var(--fg-2)",
            }}
          >
            {lead}
          </p>
        </div>
      </div>
      {children}
    </section>
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
