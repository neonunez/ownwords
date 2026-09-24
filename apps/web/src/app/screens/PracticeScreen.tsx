import { useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Icon,
  IconButton,
  Mascot,
  SegmentedControl,
  TextField,
  TopBar,
} from "../../design-system";
import { Screen } from "../layout";
import { Failed, Loading } from "./ScreenState";
import { useAsync } from "../shell/useAsync";
import { useClient } from "../shell/ClientProvider";
import { useScreen } from "../shell/useScreen";
import { useToast } from "../shell/ToastProvider";
import { answersMatch, firstWord } from "../../lib/text";
import { newId } from "../../lib/ids";
import type { DueQueue, PracticeCard, PracticeFormat } from "../../api/types";

type Phase = "ask" | "hint" | "shown" | "right";

export interface PracticeScreenProps {
  /** The tab chooses the format; the scheduler chooses the content. */
  format: PracticeFormat;
  /** Whether the format can be switched from this tab. */
  allowFormatChange?: boolean;
  title: string;
  mode: "maintain" | "learn";
  modeLabel: string;
}

const formats: { value: PracticeFormat; label: string }[] = [
  { value: "cloze", label: "Complete the phrase" },
  { value: "flashcard", label: "Flashcards" },
];

export function PracticeScreen({
  format: initialFormat,
  allowFormatChange = true,
  title,
  mode,
  modeLabel,
}: PracticeScreenProps) {
  const client = useClient();
  const { openPanel } = useScreen();
  const { showToast } = useToast();
  // One sitting: a card missed now comes back within it.
  const [sessionId] = useState(newId);
  const [format, setFormat] = useState<PracticeFormat>(initialFormat);
  // What is left of one queue the scheduler handed over, once the person has
  // answered something in it. A fresh read of the queue starts over.
  const [answered, setAnswered] = useState<{
    from: DueQueue;
    cards: PracticeCard[];
  } | null>(null);
  // Reviews still on their way to the scheduler.
  const submissions = useRef<Promise<unknown>[]>([]);
  // Whether anything has been answered in this sitting.
  const [practised, setPractised] = useState(false);
  const [phase, setPhase] = useState<Phase>("ask");
  const [typed, setTyped] = useState("");
  const [flipped, setFlipped] = useState(false);
  // Once the due queue is done, the person may practise what is coming next.
  const [ahead, setAhead] = useState(false);

  const state = useAsync(
    () => client.getDueQueue({ mode, format, sessionId, ahead }),
    [client, mode, format, sessionId, ahead],
  );

  const queue =
    answered && answered.from === state.data
      ? answered.cards
      : (state.data?.cards ?? []);
  const card = queue[0] ?? null;
  const remaining = queue.length;
  const total = state.data?.cards.length ?? 0;
  const position = Math.max(1, total - remaining + 1);

  const comingUp = useMemo(() => state.data?.comingUp ?? [], [state.data]);

  const advance = (rating: "again" | "good") => {
    if (!card || !state.data) return;
    submissions.current.push(
      client
        .submitReview({
          cardId: card.cardId,
          rating,
          format,
          sessionId,
          submissionId: newId(),
        })
        .catch(() =>
          showToast(
            "That answer was not saved, so the card stays due. Check the connection.",
          ),
        ),
    );
    const [head, ...rest] = queue;
    // "Again" brings the card back later in the same session.
    const left = rating === "again" && head ? [...rest, head] : rest;
    setAnswered({ from: state.data, cards: left });
    setPractised(true);
    if (left.length === 0) {
      // Once every answer is stored, ask the scheduler what comes next.
      const sent = submissions.current;
      submissions.current = [];
      void Promise.allSettled(sent).then(state.reload);
    }
    setPhase("ask");
    setTyped("");
    setFlipped(false);
  };

  const check = () => {
    if (!card || !typed.trim()) return;
    if (
      [card.answer, ...card.accepted].some((answer) =>
        answersMatch(typed, answer),
      )
    ) {
      setPhase("right");
      return;
    }
    setPhase(phase === "hint" ? "shown" : "hint");
  };

  const practiseAhead = () => {
    setAnswered(null);
    setPhase("ask");
    setTyped("");
    setFlipped(false);
    setAhead(true);
    state.reload();
  };

  const header = (
    <TopBar title={title} large mode={modeLabel} onMenu={openPanel} />
  );

  if (state.loading && !state.data) {
    return (
      <>
        {header}
        <Loading label="Picking what is due." />
      </>
    );
  }

  if (state.error || !state.data) {
    return (
      <>
        {header}
        <Failed
          message="What is due could not be read. Nothing was lost."
          onRetry={state.reload}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <Screen>
        {allowFormatChange && (
          <SegmentedControl
            label="Practice format"
            options={formats}
            value={format}
            onChange={(next) => {
              setFormat(next);
              setAnswered(null);
              setPractised(false);
              setFlipped(false);
              setPhase("ask");
              setTyped("");
            }}
          />
        )}

        {!card ? (
          <Card tone="soft" padding={24} style={{ textAlign: "center" }}>
            <Mascot
              expression="happy"
              size={80}
              bob
              style={{ margin: "0 auto 12px" }}
            />
            {format === "cloze" && allowFormatChange && !practised ? (
              <>
                <p style={{ margin: 0, font: "var(--type-title)" }}>
                  No phrases to complete are due.
                </p>
                <p
                  style={{
                    margin: "6px 0 16px",
                    font: "var(--type-body)",
                    color: "var(--fg-2)",
                  }}
                >
                  Flashcards practise the same words.
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFormat("flashcard");
                    setAnswered(null);
                    setPractised(false);
                  }}
                >
                  Practise with flashcards
                </Button>
              </>
            ) : (
              <p style={{ margin: 0, font: "var(--type-title)" }}>
                That is everything due.
              </p>
            )}
            {comingUp[0] ? (
              <>
                <p
                  style={{
                    margin: "6px 0 16px",
                    font: "var(--type-body)",
                    color: "var(--fg-2)",
                  }}
                >
                  Next up:{" "}
                  {comingUp[0].headword ? (
                    <>
                      <span
                        style={{
                          fontFamily: "var(--font-display)",
                          fontWeight: 500,
                        }}
                      >
                        {comingUp[0].headword}
                      </span>{" "}
                      in {comingUp[0].language.toUpperCase()}
                    </>
                  ) : (
                    <>{comingUp[0].language.toUpperCase()}</>
                  )}
                  , {comingUp[0].when}.
                </p>
                {state.data.aheadAvailable && (
                  <Button variant="secondary" onClick={practiseAhead}>
                    Practise what is coming
                  </Button>
                )}
              </>
            ) : (
              <p
                style={{
                  margin: "6px 0 0",
                  font: "var(--type-body)",
                  color: "var(--fg-2)",
                }}
              >
                Nothing else is coming up yet.
              </p>
            )}
          </Card>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                padding: "0 4px",
                font: "var(--type-caption)",
                color: "var(--fg-3)",
              }}
            >
              <span>
                {position} of {total} {ahead ? "ahead of time" : "due"}
              </span>
              <span>
                {card.language.toUpperCase()} · {card.direction}
              </span>
            </div>

            {format === "cloze" ? (
              <ClozeCard
                card={card}
                phase={phase}
                typed={typed}
                onTyped={setTyped}
                onCheck={check}
                onNext={() => advance(phase === "right" ? "good" : "again")}
              />
            ) : (
              <FlashCard
                card={card}
                flipped={flipped}
                onFlip={() => setFlipped((value) => !value)}
                onAgain={() => advance("again")}
                onGotIt={() => advance("good")}
              />
            )}
          </>
        )}
      </Screen>
    </>
  );
}

function ClozeCard({
  card,
  phase,
  typed,
  onTyped,
  onCheck,
  onNext,
}: {
  card: PracticeCard;
  phase: Phase;
  typed: string;
  onTyped: (next: string) => void;
  onCheck: () => void;
  onNext: () => void;
}) {
  return (
    <Card
      padding={20}
      style={{
        minHeight: 200,
        display: "grid",
        alignContent: "space-between",
        gap: 16,
      }}
    >
      <div>
        <p
          style={{
            margin: 0,
            font: "var(--type-overline)",
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase",
            color: "var(--fg-3)",
          }}
        >
          {card.direction === "produce" ? "Complete it" : "What does it mean?"}
        </p>
        <p
          lang={card.promptLanguage ?? undefined}
          style={{
            margin: "10px 0 0",
            font: "var(--type-headword)",
            fontSize: "1.5rem",
            lineHeight: 1.3,
            letterSpacing: "var(--tracking-display)",
          }}
        >
          {card.prompt}
        </p>

        {phase === "hint" && (
          <p
            role="status"
            style={{
              margin: "12px 0 0",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "var(--state-waiting-soft)",
              color: "var(--fg-1)",
              font: "var(--type-body)",
              fontSize: ".9375rem",
            }}
          >
            <b style={{ fontWeight: 600 }}>Not quite.</b>{" "}
            {card.hint ?? `It starts with “${firstWord(card.answer)}”.`} Once
            more?
          </p>
        )}

        {phase === "shown" && (
          <p
            role="status"
            style={{
              margin: "12px 0 0",
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-sunken)",
              font: "var(--type-body)",
              fontSize: ".9375rem",
            }}
          >
            The answer is{" "}
            <span
              lang={card.answerLanguage ?? undefined}
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "1.0625rem",
              }}
            >
              {card.answer}
            </span>
            . It comes back later this session.
          </p>
        )}

        {phase === "right" && (
          <p
            role="status"
            style={{
              margin: "12px 0 0",
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--state-confirmed)",
              font: "var(--type-label)",
            }}
          >
            <Icon name="check" size={18} strokeWidth={2.2} />
            Right —{" "}
            <span
              lang={card.answerLanguage ?? undefined}
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 400,
                fontSize: "1.0625rem",
                color: "var(--fg-1)",
              }}
            >
              {card.answer}
            </span>
          </p>
        )}
      </div>

      {phase === "ask" || phase === "hint" ? (
        <TextField
          display
          size="lg"
          name="practice-answer"
          ariaLabel={`Your answer in ${(card.answerLanguage ?? card.language).toUpperCase()}`}
          placeholder="Type your answer"
          value={typed}
          onChange={onTyped}
          lang={card.answerLanguage ?? undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCheck();
            }
          }}
          trailing={
            <IconButton
              name="corner-down-left"
              label="Check your answer"
              variant={typed ? "filled" : "tonal"}
              size={36}
              onClick={onCheck}
            />
          }
        />
      ) : (
        <Button size="lg" full iconRight="arrow-right" onClick={onNext}>
          Next
        </Button>
      )}
    </Card>
  );
}

function FlashCard({
  card,
  flipped,
  onFlip,
  onAgain,
  onGotIt,
}: {
  card: PracticeCard;
  flipped: boolean;
  onFlip: () => void;
  onAgain: () => void;
  onGotIt: () => void;
}) {
  return (
    <div>
      <div style={{ perspective: 1200 }}>
        <button
          type="button"
          onClick={onFlip}
          aria-pressed={flipped}
          style={{
            display: "block",
            width: "100%",
            minHeight: 240,
            border: 0,
            padding: 0,
            background: "transparent",
            cursor: "pointer",
            transformStyle: "preserve-3d",
            transition: "transform var(--motion-slow) var(--ease-spring)",
            transform: flipped ? "rotateY(180deg)" : "none",
            position: "relative",
            font: "inherit",
            color: "inherit",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              borderRadius: "var(--radius-lg)",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-1)",
              boxShadow: "var(--shadow-2)",
              display: "grid",
              placeContent: "center",
              gap: 8,
              padding: 24,
              textAlign: "center",
            }}
          >
            <span
              style={{
                font: "var(--type-overline)",
                letterSpacing: "var(--tracking-wide)",
                textTransform: "uppercase",
                color: "var(--fg-3)",
              }}
            >
              {card.promptLanguage?.toUpperCase() ?? "Meaning"}
            </span>
            <span
              lang={card.promptLanguage ?? undefined}
              style={{
                font: "var(--type-hero)",
                fontSize: "2rem",
                letterSpacing: "var(--tracking-display)",
              }}
            >
              {card.headword}
            </span>
            <span
              style={{
                font: "var(--type-caption)",
                color: "var(--fg-3)",
                marginTop: 8,
              }}
            >
              {flipped ? "Tap to see it again" : "Tap to turn it over"}
            </span>
          </span>
          <span
            aria-hidden={!flipped}
            style={{
              position: "absolute",
              inset: 0,
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
              borderRadius: "var(--radius-lg)",
              background: "var(--bg-inverse)",
              color: "var(--fg-inverse)",
              display: "grid",
              placeContent: "center",
              gap: 8,
              padding: 24,
              textAlign: "center",
            }}
          >
            <span
              style={{
                font: "var(--type-overline)",
                letterSpacing: "var(--tracking-wide)",
                textTransform: "uppercase",
                opacity: 0.6,
              }}
            >
              {card.answerLanguage?.toUpperCase() ?? "Meaning"}
            </span>
            <span
              lang={card.answerLanguage ?? undefined}
              style={{
                font: "var(--type-hero)",
                fontSize: "2rem",
                letterSpacing: "var(--tracking-display)",
              }}
            >
              {card.answer}
            </span>
          </span>
        </button>
      </div>

      {flipped && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginTop: 14,
          }}
        >
          <Button
            variant="outline"
            size="lg"
            icon="rotate-ccw"
            onClick={onAgain}
          >
            Again
          </Button>
          <Button size="lg" icon="check" onClick={onGotIt}>
            Got it
          </Button>
        </div>
      )}
    </div>
  );
}
