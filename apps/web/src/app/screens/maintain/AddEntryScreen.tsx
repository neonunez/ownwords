import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
} from "../../../design-system";
import { Note, Screen, Spacer } from "../../layout";
import { AppSheet } from "../../shell/OverlayHost";
import { useAsync } from "../../shell/useAsync";
import { useClient } from "../../shell/ClientProvider";
import { useToast } from "../../shell/ToastProvider";
import type {
  Entry,
  EntryKind,
  Fit,
  LanguageTag,
  NewEquivalent,
  SuggestionResult,
} from "../../../api/types";

type Step = "capture" | "review";

/** Where each other language stands while the person reviews it. */
type Candidate =
  | { state: "idle" }
  | { state: "waiting" }
  | { state: "failed"; reason: string }
  | {
      state: "suggested" | "confirmed" | "manual";
      text: string;
      fit?: Exclude<Fit, "false-friend">;
    };

const failedWords = "Translation failed. Nothing was dropped.";

function written(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Capture, then optional auto-translation, then review each candidate, then
 * save. The headword is stored when the person moves on from capture, so the
 * suggestions have something to translate; each reviewed equivalent is added
 * when they save. The note is what keeps false friends out, so it is asked
 * for here and never afterwards.
 */
export function AddEntryScreen() {
  const client = useClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const prefilled =
    (location.state as { headword?: string } | null)?.headword ?? "";

  const [step, setStep] = useState<Step>("capture");
  const [headword, setHeadword] = useState(prefilled);
  const [note, setNote] = useState("");
  const [chosenLanguage, setLanguage] = useState<LanguageTag | null>(null);
  const [kind, setKind] = useState<EntryKind>("expression");
  const [suggestChoice, setSuggest] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<Entry | null>(null);
  const [candidates, setCandidates] = useState<Record<string, Candidate>>({});
  const [typing, setTyping] = useState<LanguageTag | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const requests = useRef<AbortController | null>(null);

  const languages = useAsync(() => client.listLanguages(), [client]);
  const preferences = useAsync(() => client.getPreferences(), [client]);
  const language = chosenLanguage ?? languages.data?.[0]?.code ?? "";
  const suggest =
    suggestChoice ?? preferences.data?.suggestTranslations ?? true;
  const others = (languages.data ?? [])
    .map((entry) => entry.code)
    .filter((code) => code !== language);

  useEffect(() => () => requests.current?.abort(), []);

  const nameOf = (code: string) =>
    languages.data?.find((entry) => entry.code === code)?.name ??
    code.toUpperCase();

  const setCandidate = (code: string, candidate: Candidate) =>
    setCandidates((current) => ({ ...current, [code]: candidate }));

  const record = (result: SuggestionResult) =>
    setCandidate(
      result.language,
      result.state === "suggested"
        ? {
            state: "suggested",
            text: result.text,
            ...(result.fit ? { fit: result.fit } : {}),
          }
        : { state: "failed", reason: result.reason ?? failedWords },
    );

  const translate = (entry: Entry, into: readonly string[]) => {
    const controller = new AbortController();
    requests.current = controller;
    setCandidates((current) => ({
      ...current,
      ...Object.fromEntries(into.map((code) => [code, { state: "waiting" }])),
    }));
    client
      .requestSuggestions(entry, into, record, controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        for (const code of into) {
          setCandidate(code, {
            state: "failed",
            reason: written(error, failedWords),
          });
        }
      });
  };

  const moveOn = async () => {
    setBusy(true);
    try {
      const entry = await client.createEntry({
        headword,
        note,
        kind,
        language,
      });
      setDraft(entry);
      setCandidates(
        Object.fromEntries(others.map((code) => [code, { state: "idle" }])),
      );
      setStep("review");
      if (suggest && others.length) translate(entry, others);
    } catch (error) {
      showToast(written(error, "That entry was not saved. Try again."));
    }
    setBusy(false);
  };

  const backToCapture = async () => {
    requests.current?.abort();
    if (draft) {
      setBusy(true);
      try {
        // Nothing has been reviewed yet, so the stored headword goes too.
        await client.deleteEntry(draft.id, draft.version);
      } catch (error) {
        setBusy(false);
        showToast(
          written(error, "That draft could not be set aside. Try again."),
        );
        return;
      }
      setBusy(false);
    }
    setDraft(null);
    setCandidates({});
    setStep("capture");
  };

  const save = async () => {
    if (!draft) return;
    const sense = draft.senses[0];
    const equivalents = others.flatMap<NewEquivalent>((code) => {
      const candidate = candidates[code];
      if (!candidate) return [];
      if (candidate.state === "failed") {
        return [{ language: code, text: "", state: "failed" as const }];
      }
      if (
        candidate.state === "suggested" ||
        candidate.state === "confirmed" ||
        candidate.state === "manual"
      ) {
        return [
          {
            language: code,
            text: candidate.text,
            state: candidate.state,
            ...(candidate.fit ? { fit: candidate.fit } : {}),
          },
        ];
      }
      // Never asked for: nothing to keep.
      return [];
    });
    setBusy(true);
    try {
      if (sense && equivalents.length) {
        await client.addEquivalents(draft.id, sense.id, equivalents);
      }
      navigate("/maintain/lexicon");
      showToast("Saved to your Lexicon.", { icon: "check" });
    } catch (error) {
      setBusy(false);
      navigate(`/maintain/lexicon/${draft.id}`);
      showToast(
        `The entry is saved, but not every translation. ${written(error, "")}`.trim(),
      );
    }
  };

  const closeTyping = () => {
    setTyping(null);
    setTyped("");
  };

  const keepTyped = () => {
    const text = typed.trim();
    if (!typing || !text) return;
    setCandidate(typing, { state: "manual", text });
    closeTyping();
  };

  if (step === "capture") {
    return (
      <>
        <TopBar
          title="New entry"
          onBack={() => navigate("/maintain/lexicon")}
          backLabel="Back to your Lexicon"
        />
        <Screen>
          <div
            role="group"
            aria-label="The language you are writing in"
            style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
          >
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

          <div
            role="group"
            aria-label="What you stored"
            style={{ display: "flex", gap: 8 }}
          >
            <Chip
              size="sm"
              selected={kind === "expression"}
              onClick={() => setKind("expression")}
            >
              An expression
            </Chip>
            <Chip
              size="sm"
              selected={kind === "word"}
              onClick={() => setKind("word")}
            >
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

          {others.length > 0 && (
            <Card tone="sunken" padding={14}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div>
                  <div id="suggest-label" style={{ font: "var(--type-label)" }}>
                    Suggest translations
                  </div>
                  <div
                    style={{
                      font: "var(--type-caption)",
                      color: "var(--fg-3)",
                    }}
                  >
                    Into {others.map(nameOf).join(" and ")}. You review each
                    one.
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
          )}

          <Spacer />
          <Button
            size="lg"
            full
            disabled={!headword.trim() || !language || busy}
            iconRight="arrow-right"
            onClick={() => void moveOn()}
          >
            {suggest && others.length ? "Translate" : "Next"}
          </Button>
        </Screen>
      </>
    );
  }

  const waiting = others.some((code) => candidates[code]?.state === "waiting");

  return (
    <>
      <TopBar
        title={suggest ? "Review translations" : "Add translations"}
        onBack={() => void backToCapture()}
        backLabel="Back to the entry"
      />
      <Screen>
        <div style={{ padding: "0 4px" }}>
          <p
            style={{
              margin: 0,
              font: "var(--type-overline)",
              letterSpacing: "var(--tracking-wide)",
              textTransform: "uppercase",
              color: "var(--fg-3)",
            }}
          >
            {nameOf(language)}
          </p>
          <p
            lang={language}
            style={{
              margin: "4px 0 0",
              font: "var(--type-title)",
              letterSpacing: "var(--tracking-display)",
            }}
          >
            {headword}
          </p>
          {note && (
            <p
              style={{
                margin: "4px 0 0",
                font: "var(--type-caption)",
                color: "var(--fg-2)",
              }}
            >
              “{note}”
            </p>
          )}
        </div>

        {others.length > 0 && (
          <Card padding={0}>
            {others.map((code, index) => (
              <CandidateRow
                key={code}
                code={code}
                name={nameOf(code)}
                candidate={candidates[code] ?? { state: "idle" }}
                last={index === others.length - 1}
                onConfirm={(text, fit) =>
                  setCandidate(code, {
                    state: "confirmed",
                    text,
                    ...(fit ? { fit } : {}),
                  })
                }
                onRetry={() => draft && translate(draft, [code])}
                onType={() => setTyping(code)}
              />
            ))}
          </Card>
        )}

        <Note>
          A suggestion stays out of practice until you confirm it, and nothing
          is dropped if one fails.
        </Note>

        <Spacer />
        <Button
          size="lg"
          full
          icon="check"
          disabled={busy || waiting}
          onClick={() => void save()}
        >
          Save entry
        </Button>
      </Screen>

      <AppSheet
        open={typing !== null}
        title={typing ? `The ${nameOf(typing)} equivalent` : "Type it yourself"}
        onClose={closeTyping}
        footer={
          <Button variant="ghost" full onClick={closeTyping}>
            Cancel
          </Button>
        }
      >
        <div style={{ display: "grid", gap: 8 }}>
          <TextField
            label="Type the equivalent yourself"
            name="typed-equivalent"
            display
            value={typed}
            onChange={setTyped}
            placeholder="Your own wording"
            hint="Typed by hand always wins over a suggestion."
            lang={typing ?? undefined}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                keepTyped();
              }
            }}
          />
          <Button
            full
            icon="check"
            disabled={!typed.trim()}
            onClick={keepTyped}
          >
            Use this wording
          </Button>
        </div>
      </AppSheet>
    </>
  );
}

function CandidateRow({
  code,
  name,
  candidate,
  last,
  onConfirm,
  onRetry,
  onType,
}: {
  code: string;
  name: string;
  candidate: Candidate;
  last: boolean;
  onConfirm: (text: string, fit?: Exclude<Fit, "false-friend">) => void;
  onRetry: () => void;
  onType: () => void;
}) {
  const typeButton = (
    <IconButton
      name="pencil"
      label={`Type the ${name} equivalent yourself`}
      onClick={onType}
    />
  );
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "32px minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "center",
        padding: "14px 16px",
        minHeight: 72,
        borderBottom: last ? 0 : "1px solid var(--border-1)",
      }}
    >
      <span
        style={{
          font: "var(--type-overline)",
          letterSpacing: ".06em",
          color: "var(--fg-3)",
        }}
      >
        {code.toUpperCase()}
      </span>

      {candidate.state === "idle" ? (
        <>
          <span style={{ font: "var(--type-body)", color: "var(--fg-3)" }}>
            No {name} equivalent yet.
          </span>
          {typeButton}
        </>
      ) : candidate.state === "waiting" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: 99,
                background: "var(--state-waiting)",
                animation: "ow-pulse 1s var(--ease-in-out) infinite",
              }}
            />
            <span style={{ font: "var(--type-body)", color: "var(--fg-3)" }}>
              Translating into {name}.
            </span>
          </div>
          <StateLabel state="waiting" />
        </>
      ) : candidate.state === "failed" ? (
        <>
          <div>
            <div style={{ font: "var(--type-body)", color: "var(--fg-2)" }}>
              {candidate.reason}
            </div>
            <div style={{ marginTop: 6 }}>
              <StateLabel state="failed" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
            {typeButton}
          </div>
        </>
      ) : (
        <>
          <div style={{ minWidth: 0 }}>
            <div
              lang={code}
              style={{
                font: "var(--type-headword)",
                fontSize: "1.125rem",
                letterSpacing: "var(--tracking-display)",
              }}
            >
              {candidate.text}
            </div>
            <div style={{ marginTop: 6 }}>
              <StateLabel state={candidate.state} />
            </div>
          </div>
          {candidate.state === "suggested" ? (
            <div style={{ display: "flex", gap: 4 }}>
              <IconButton
                name="check"
                label={`Confirm the ${name} equivalent`}
                variant="tonal"
                onClick={() => onConfirm(candidate.text, candidate.fit)}
              />
              {typeButton}
            </div>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Icon name="check" size={20} color="var(--state-confirmed)" />
              {typeButton}
            </span>
          )}
        </>
      )}
    </div>
  );
}
