import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Card, Chip, IconButton, TopBar } from "../../../design-system";
import { Screen, Spacer } from "../../layout";
import { Failed, Loading } from "../ScreenState";
import { useAsync } from "../../shell/useAsync";
import { useClient } from "../../shell/ClientProvider";
import { useToast } from "../../shell/ToastProvider";
import type { LessonStep } from "../../../api/types";

/** Hear it first, then a rule of four lines, then use it, then a perception drill. */
export function LessonScreen() {
  const { lessonId = "" } = useParams();
  const client = useClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [index, setIndex] = useState(0);
  const [choice, setChoice] = useState<string | null>(null);

  const state = useAsync(() => client.getLesson(lessonId), [client, lessonId]);
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
          message="That lesson could not be opened. Nothing was lost."
          onRetry={state.reload}
        />
      </>
    );
  }

  const lesson = state.data;
  const step = lesson.steps[index];
  if (!step) return null;
  const last = index === lesson.steps.length - 1;

  const next = () => {
    void client.completeLessonStep(lesson.id, step.id);
    setChoice(null);
    if (last) {
      back();
      showToast("Step finished. The unit picks up where you left it.", {
        icon: "check",
      });
      return;
    }
    setIndex(index + 1);
  };

  return (
    <>
      <TopBar
        title={`Unit ${lesson.unitNumber} · ${step.title}`}
        onBack={back}
        backLabel="Back to the course"
        trailing={
          <IconButton
            name="book-open"
            label="Open the grammar for this step"
            onClick={() =>
              showToast("Grammar opens here, and returns to this step.")
            }
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
          language={"ru"}
          choice={choice}
          onChoose={setChoice}
          onPlay={() =>
            showToast(
              "Recorded human audio arrives with the course content. The device speech engine is never used.",
            )
          }
        />

        <Spacer />
        <Button
          size="lg"
          full
          iconRight={last ? "check" : "arrow-right"}
          onClick={next}
        >
          {last ? "Finish step" : "Next"}
        </Button>
      </Screen>
    </>
  );
}

function StepBody({
  step,
  language,
  choice,
  onChoose,
  onPlay,
}: {
  step: LessonStep;
  language: string;
  choice: string | null;
  onChoose: (next: string) => void;
  onPlay: () => void;
}) {
  if (step.kind === "hear") {
    const items = step.items ?? [];
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
            <IconButton
              name="volume-2"
              label={`Play ${item.meaning}`}
              variant="tonal"
              onClick={onPlay}
            />
          </div>
        ))}
      </Card>
    );
  }

  if (step.kind === "rule") {
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
          {(step.lines ?? []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </Card>
    );
  }

  const options = step.options ?? [];
  const response = choice ? step.responses?.[choice] : undefined;
  const right = choice !== null && choice === step.answer;

  if (step.kind === "use") {
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
      <IconButton
        name="volume-2"
        label="Play the recording"
        variant="filled"
        size={64}
        style={{ margin: "0 auto" }}
        onClick={onPlay}
      />
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
