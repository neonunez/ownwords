import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Chip, IconButton, TopBar } from "../../../design-system";
import { Screen, Spacer } from "../../layout";
import { Failed, Loading } from "../ScreenState";
import { useAsync } from "../../shell/useAsync";
import { useClient } from "../../shell/ClientProvider";
import { useToast } from "../../shell/ToastProvider";
import { useSession } from "../../session/SessionGate";
import { OwnwordsError } from "../../../api/client";
import type { Lesson, LessonItem, LessonStep } from "../../../api/types";

/** Where a lesson opens: the step recorded last time, or the first. */
function openingIndex(lesson: Lesson): number {
  if (lesson.status !== "in_progress") return 0;
  const index = lesson.steps.findIndex(
    (step) => step.id === lesson.currentStepId,
  );
  return Math.max(0, index);
}

/**
 * Hear it first, then a rule of four lines, then use it, then a perception
 * drill. Reaching a step is recorded as the person moves on, in order, so the
 * course picks up where they left it; finishing records the lesson and puts
 * the words it introduced into the Lexicon.
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
  const session = useSession();
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

  const step = lesson.steps[index];
  if (!step) return null;
  const last = index === lesson.steps.length - 1;
  const audio = session?.onboarding.preferences.audioInCourse ?? true;

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
    setBusy(true);
    try {
      if (last) {
        await recordThrough(index);
        const { lexicon } = await client.completeLesson(lesson.id);
        onBack();
        showToast(
          lexicon === "synced"
            ? "Lesson finished. Its words are in your Lexicon."
            : "Lesson finished. Some of its words have not reached your Lexicon yet; finishing it again retries them.",
          { icon: "check" },
        );
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
    }
    setBusy(false);
  };

  const play = (item: LessonItem | undefined) => {
    if (!item?.audioUrl) {
      showToast(
        "There is no recording for this one yet. The device speech engine is never used.",
      );
      return;
    }
    new Audio(item.audioUrl).play().catch(() => {
      showToast("That recording could not be played. Check the connection.");
    });
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
          audio={audio}
          onChoose={setChoice}
          onPlay={play}
        />

        <Spacer />
        <Button
          size="lg"
          full
          disabled={busy}
          iconRight={last ? "check" : "arrow-right"}
          onClick={() => void next()}
        >
          {last ? "Finish lesson" : "Next"}
        </Button>
      </Screen>
    </>
  );
}

function ItemList({
  items,
  language,
  audio,
  onPlay,
}: {
  items: readonly LessonItem[];
  language: string;
  audio: boolean;
  onPlay: (item: LessonItem) => void;
}) {
  return (
    <Card padding={0}>
      {items.map((item, index) => (
        <div
          key={item.id}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto",
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
          {audio && (
            <IconButton
              name="volume-2"
              label={`Play ${item.meaning}`}
              variant="tonal"
              onClick={() => onPlay(item)}
            />
          )}
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
  audio,
  onChoose,
  onPlay,
}: {
  step: LessonStep;
  language: string;
  choice: string | null;
  audio: boolean;
  onChoose: (next: string) => void;
  onPlay: (item: LessonItem | undefined) => void;
}) {
  const items = step.items ?? [];
  const instruction = step.prompt && (
    <p style={{ margin: "0 4px", font: "var(--type-body)" }}>{step.prompt}</p>
  );

  if (step.kind === "hear" || step.kind === "alphabet") {
    return (
      <>
        {instruction}
        {items.length > 0 && (
          <ItemList
            items={items}
            language={language}
            audio={audio}
            onPlay={onPlay}
          />
        )}
        {step.lines && <Lines lines={step.lines} />}
      </>
    );
  }

  if (step.kind === "rule") {
    return (
      <>
        {step.lines ? <Lines lines={step.lines} /> : instruction}
        {items.length > 0 && (
          <ItemList
            items={items}
            language={language}
            audio={audio}
            onPlay={onPlay}
          />
        )}
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
          {items.length > 0 && (
            <ItemList
              items={items}
              language={language}
              audio={audio}
              onPlay={onPlay}
            />
          )}
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
      {audio && (
        <IconButton
          name="volume-2"
          label="Play the recording"
          variant="filled"
          size={64}
          style={{ margin: "0 auto" }}
          onClick={() => onPlay(items.find((item) => item.audioUrl))}
        />
      )}
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
