import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Chip,
  IconButton,
  Mascot,
  TopBar,
} from "../../../design-system";
import { Screen, Spacer } from "../../layout";
import { Failed, Loading } from "../ScreenState";
import { useAsync } from "../../shell/useAsync";
import { useClient } from "../../shell/ClientProvider";
import { useToast } from "../../shell/ToastProvider";
import { OwnwordsError } from "../../../api/client";
import type {
  Lesson,
  LessonCompletion,
  LessonItem,
  LessonStep,
} from "../../../api/types";

/** Where a lesson opens: the step recorded last time, or the first. */
function openingIndex(lesson: Lesson): number {
  if (lesson.status !== "in_progress") return 0;
  const index = lesson.steps.findIndex(
    (step) => step.id === lesson.currentStepId,
  );
  return Math.max(0, index);
}

/** "1 word", "5 words": the app counts in words, so the noun follows. */
function words(count: number): string {
  return `${count} ${count === 1 ? "word" : "words"}`;
}

/**
 * Read it first, then a rule of four lines, then use it, then a perception
 * drill. Reaching a step is recorded as the person moves on, in order, so the
 * course picks up where they left it; finishing records the lesson and puts
 * the words it introduced into Learn practice.
 *
 * A finished lesson offers to keep those words in the Lexicon, and never does
 * it unasked.
 *
 * Every step is reading, meaning and choice. The course ships no recordings,
 * so there is no playback control anywhere in it.
 */
export function LessonScreen() {
  const { lessonId = "" } = useParams();
  const client = useClient();
  const state = useAsync(() => client.getLesson(lessonId), [client, lessonId]);
  const navigate = useNavigate();
  const back = () => navigate("/learn/course");

  if (state.loading && !state.data) {
    return (
      <>
        <TopBar title="Lesson" onBack={back} backLabel="Back to the course" />
        <Loading label="Opening the lesson." />
      </>
    );
  }
  if (state.error || !state.data) {
    return (
      <>
        <TopBar title="Lesson" onBack={back} backLabel="Back to the course" />
        <Failed
          message={
            state.error instanceof OwnwordsError && state.error.status > 0
              ? `That lesson could not be opened. ${state.error.message}`
              : "That lesson could not be opened. Nothing was lost."
          }
          onRetry={state.reload}
        />
      </>
    );
  }

  return <LessonSteps key={state.data.id} lesson={state.data} onBack={back} />;
}

function LessonSteps({
  lesson,
  onBack,
}: {
  lesson: Lesson;
  onBack: () => void;
}) {
  const client = useClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [index, setIndex] = useState(() => openingIndex(lesson));
  // The furthest step the backend has recorded; a finished lesson records nothing more.
  const [recorded, setRecorded] = useState(() =>
    lesson.status === "in_progress"
      ? openingIndex(lesson)
      : lesson.status === "completed"
        ? lesson.steps.length
        : -1,
  );
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when the lesson is finished: what its words are, and what the learner
  // has chosen to keep in the Lexicon. A lesson opened after it was finished
  // opens here too.
  const [finished, setFinished] = useState<LessonCompletion | null>(() =>
    lesson.status === "completed" ? { words: lesson.words } : null,
  );
  const inFlight = useRef(false);

  const step = lesson.steps[index];
  if (!step) return null;
  const last = index === lesson.steps.length - 1;

  if (finished) {
    return (
      <FinishedLesson
        lesson={lesson}
        completion={finished}
        onReadAgain={() => setFinished(null)}
        onBack={onBack}
      />
    );
  }

  /** Records every step up to `target` that is not recorded yet, in order. */
  const recordThrough = async (target: number) => {
    for (let at = recorded + 1; at <= target; at += 1) {
      const next = lesson.steps[at];
      if (!next) break;
      await client.completeLessonStep(lesson.id, next.id);
      setRecorded(at);
    }
  };

  const next = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (last) {
        await recordThrough(index);
        const completion = await client.completeLesson(lesson.id);
        setFinished(completion);
        return;
      }
      await recordThrough(index + 1);
      setChoice(null);
      setIndex(index + 1);
    } catch (error) {
      showToast(
        error instanceof Error && error.message
          ? `Your place was not saved. ${error.message}`
          : "Your place was not saved. Try again.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar
        title={`Unit ${lesson.unitNumber} · ${step.title}`}
        onBack={onBack}
        backLabel="Back to the course"
        trailing={
          <IconButton
            name="book-open"
            label="Open the grammar for this step"
            onClick={() => navigate("/learn/reference/grammar")}
          />
        }
      />
      <Screen>
        <ol
          aria-label={`Step ${index + 1} of ${lesson.steps.length}`}
          style={{
            display: "flex",
            gap: 6,
            margin: 0,
            padding: 0,
            listStyle: "none",
          }}
        >
          {lesson.steps.map((one, position) => (
            <li
              key={one.id}
              aria-current={position === index ? "step" : undefined}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 99,
                background:
                  position <= index ? "var(--accent)" : "var(--mastery-empty)",
                transition: "background var(--motion-base)",
              }}
            >
              <span className="ow-visually-hidden">{one.title}</span>
            </li>
          ))}
        </ol>

        <StepBody
          step={step}
          language={lesson.language}
          choice={choice}
          onChoose={setChoice}
        />

        <Spacer />
        <Button
          size="lg"
          full
          disabled={busy}
          iconRight={last ? "check" : "arrow-right"}
          onClick={() => void next()}
        >
          {busy
            ? last
              ? "Finishing lesson…"
              : "Saving progress…"
            : last
              ? "Finish lesson"
              : "Next"}
        </Button>
      </Screen>
    </>
  );
}

/**
 * The lesson is finished. Its words are in Learn practice now, whatever the
 * learner decides about their Lexicon; keeping them there is one tap, and
 * asking twice never stores a word twice.
 */
function FinishedLesson({
  lesson,
  completion,
  onReadAgain,
  onBack,
}: {
  lesson: Lesson;
  completion: LessonCompletion;
  onReadAgain: () => void;
  onBack: () => void;
}) {
  const client = useClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [words_, setWords] = useState(completion.words);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const kept = words_.inLexicon >= words_.total;

  const keep = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const stored = await client.addLessonWordsToLexicon(lesson.id);
      setWords({ total: stored.total, inLexicon: stored.inLexicon });
      if (stored.pending > 0) {
        showToast(
          `${words(stored.added)} added to your Lexicon. ${words(
            stored.pending,
          )} could not be saved; try again.`,
        );
        return;
      }
      showToast(
        stored.added > 0
          ? `${words(stored.added)} added to your Lexicon.`
          : "These words are already in your Lexicon.",
        { icon: "check" },
      );
    } catch (error) {
      showToast(
        error instanceof Error && error.message
          ? `Your Lexicon was not changed. ${error.message}`
          : "Your Lexicon was not changed. Try again.",
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <TopBar
        title={`Unit ${lesson.unitNumber} · ${lesson.title}`}
        onBack={onBack}
        backLabel="Back to the course"
        trailing={
          <IconButton
            name="book-open"
            label="Open the grammar for this step"
            onClick={() => navigate("/learn/reference/grammar")}
          />
        }
      />
      <Screen>
        <Card tone="soft" padding={24} style={{ textAlign: "center" }}>
          <Mascot
            expression="happy"
            size={80}
            bob
            style={{ margin: "0 auto 12px" }}
          />
          <p style={{ margin: 0, font: "var(--type-title)" }}>
            Lesson finished.
          </p>
          <p
            style={{
              margin: "6px 0 0",
              font: "var(--type-body)",
              color: "var(--fg-2)",
            }}
          >
            {words_.total === 0
              ? "This lesson introduced no words to practise."
              : `Its ${words(words_.total)} are ready to practise in Learn.`}
          </p>
          {words_.total > 0 ? (
            <p
              style={{
                margin: "6px 0 0",
                font: "var(--type-body)",
                color: "var(--fg-2)",
              }}
            >
              {kept
                ? "They are in your Lexicon."
                : words_.inLexicon > 0
                  ? `${words(words_.inLexicon)} of them ${
                      words_.inLexicon === 1 ? "is" : "are"
                    } in your Lexicon.`
                  : "They are not in your Lexicon."}
            </p>
          ) : null}
        </Card>

        <Spacer />
        {words_.total > 0 ? (
          <>
            <Button
              size="lg"
              full
              variant="secondary"
              disabled={saving || kept}
              icon="plus"
              onClick={() => void keep()}
            >
              {saving
                ? "Adding to your Lexicon…"
                : kept
                  ? "Already in your Lexicon"
                  : "Add these words to Lexicon"}
            </Button>
            <div style={{ height: 8 }} />
          </>
        ) : null}
        <Button size="lg" full variant="outline" onClick={onBack}>
          Back to the course
        </Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" full onClick={onReadAgain}>
          Read the lesson again
        </Button>
      </Screen>
    </>
  );
}

function ItemList({
  items,
  language,
}: {
  items: readonly LessonItem[];
  language: string;
}) {
  return (
    <Card padding={0}>
      {items.map((item, index) => (
        <div
          key={item.id}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 12,
            alignItems: "center",
            padding: "14px 16px",
            minHeight: 60,
            borderBottom:
              index < items.length - 1 ? "1px solid var(--border-1)" : 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              lang={language}
              style={{
                font: "var(--type-headword)",
                fontSize: "1.375rem",
                letterSpacing: "var(--tracking-display)",
              }}
            >
              {item.text}{" "}
              {item.grammar && (
                <span
                  style={{
                    font: "var(--type-caption)",
                    color: "var(--fg-3)",
                    fontStyle: "italic",
                  }}
                >
                  {item.grammar}
                </span>
              )}
            </div>
            <div
              style={{
                font: "var(--type-body)",
                color: "var(--fg-2)",
                fontSize: ".9375rem",
              }}
            >
              {item.meaning}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <Card padding={20}>
      <p
        style={{
          margin: 0,
          font: "var(--type-overline)",
          letterSpacing: "var(--tracking-wide)",
          textTransform: "uppercase",
          color: "var(--fg-3)",
        }}
      >
        The rule
      </p>
      <ol
        style={{
          margin: "10px 0 0",
          padding: "0 0 0 20px",
          font: "var(--type-body)",
          display: "grid",
          gap: 8,
        }}
      >
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </Card>
  );
}

function StepBody({
  step,
  language,
  choice,
  onChoose,
}: {
  step: LessonStep;
  language: string;
  choice: string | null;
  onChoose: (next: string) => void;
}) {
  const items = step.items ?? [];
  const instruction = step.prompt && (
    <p style={{ margin: "0 4px", font: "var(--type-body)" }}>{step.prompt}</p>
  );

  if (step.kind === "read" || step.kind === "alphabet") {
    return (
      <>
        {instruction}
        {items.length > 0 && <ItemList items={items} language={language} />}
        {step.lines && <Lines lines={step.lines} />}
      </>
    );
  }

  if (step.kind === "rule") {
    return (
      <>
        {step.lines ? <Lines lines={step.lines} /> : instruction}
        {items.length > 0 && <ItemList items={items} language={language} />}
      </>
    );
  }

  const options = step.options ?? [];
  const response = choice ? step.responses?.[choice] : undefined;
  const right = choice !== null && choice === step.answer;

  if (step.kind === "use") {
    if (!options.length) {
      return (
        <>
          {instruction}
          {items.length > 0 && <ItemList items={items} language={language} />}
        </>
      );
    }
    return (
      <Card padding={20} style={{ display: "grid", gap: 14 }}>
        <p
          style={{
            margin: 0,
            font: "var(--type-overline)",
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase",
            color: "var(--fg-3)",
          }}
        >
          {step.title}
        </p>
        <p
          lang={language}
          style={{
            margin: 0,
            font: "var(--type-headword)",
            fontSize: "1.5rem",
            letterSpacing: "var(--tracking-display)",
          }}
        >
          {step.prompt}
        </p>
        <div
          role="group"
          aria-label="Choose the word that belongs"
          style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
        >
          {options.map((option) => (
            <Chip
              key={option}
              display
              lang={language}
              selected={choice === option}
              onClick={() => onChoose(option)}
            >
              {option}
            </Chip>
          ))}
        </div>
        {response && (
          <p
            role="status"
            style={{
              margin: 0,
              font: "var(--type-body)",
              fontSize: ".9375rem",
              color: right ? "var(--state-confirmed)" : "var(--fg-2)",
            }}
          >
            {response}
          </p>
        )}
      </Card>
    );
  }

  return (
    <Card
      padding={20}
      style={{ display: "grid", gap: 14, textAlign: "center" }}
    >
      <p
        style={{
          margin: 0,
          font: "var(--type-overline)",
          letterSpacing: "var(--tracking-wide)",
          textTransform: "uppercase",
          color: "var(--fg-3)",
        }}
      >
        {step.prompt ?? step.title}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {options.map((option) => (
          <Button
            key={option}
            variant="outline"
            size="lg"
            lang={language}
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "1.25rem",
              fontWeight: 500,
            }}
            onClick={() => onChoose(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      {response && (
        <p
          role="status"
          style={{
            margin: 0,
            font: "var(--type-body)",
            fontSize: ".9375rem",
            color: right ? "var(--state-confirmed)" : "var(--fg-2)",
          }}
        >
          {response}
        </p>
      )}
    </Card>
  );
}
