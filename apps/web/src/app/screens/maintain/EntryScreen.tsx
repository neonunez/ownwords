import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  Chip,
  IconButton,
  MasteryMeter,
  StateLabel,
  TextField,
  TopBar,
} from "../../../design-system";
import { Screen, Section } from "../../layout";
import { Failed, Loading } from "../ScreenState";
import { AppSheet } from "../../shell/OverlayHost";
import { useAsync } from "../../shell/useAsync";
import { useClient } from "../../shell/ClientProvider";
import { useToast } from "../../shell/ToastProvider";
import { OwnwordsError } from "../../../api/client";
import type {
  Entry,
  EntryKind,
  Equivalent,
  Fit,
  Language,
  Sense,
} from "../../../api/types";

const fits: { value: Fit; label: string; description: string }[] = [
  {
    value: "exact",
    label: "Exact",
    description: "It means the same, in the same situations.",
  },
  {
    value: "broader",
    label: "Broader",
    description: "It covers more than I mean.",
  },
  {
    value: "narrower",
    label: "Narrower",
    description: "It covers less than I mean.",
  },
  {
    value: "context-only",
    label: "Context-only",
    description: "It works only in some situations.",
  },
  {
    value: "false-friend",
    label: "False friend",
    description: "It looks right and is wrong. Kept, and marked “not this”.",
  },
];

/** Which equivalent the fix sheet is open for, or which language a sense is missing. */
type SheetTarget =
  | { kind: "fix"; sense: Sense; equivalent: Equivalent }
  | { kind: "add"; sense: Sense; language: string };

export function EntryScreen() {
  const { entryId = "" } = useParams();
  const client = useClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [typed, setTyped] = useState("");
  const [addingSense, setAddingSense] = useState(false);
  const [gloss, setGloss] = useState("");
  const [editing, setEditing] = useState(false);
  const [editNote, setEditNote] = useState("");
  const [editKind, setEditKind] = useState<EntryKind>("expression");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const state = useAsync(
    async () => ({
      entry: await client.getEntry(entryId),
      languages: await client.listLanguages(),
    }),
    [client, entryId],
  );

  const back = () => navigate("/maintain/lexicon");

  if (state.loading && !state.data) {
    return (
      <>
        <TopBar title="Entry" onBack={back} backLabel="Back to your Lexicon" />
        <Loading label="Reading the entry." />
      </>
    );
  }

  if (state.error || !state.data) {
    const gone =
      state.error instanceof OwnwordsError && state.error.status === 404;
    return (
      <>
        <TopBar title="Entry" onBack={back} backLabel="Back to your Lexicon" />
        <Failed
          message={
            gone
              ? "That entry is no longer in your Lexicon."
              : "That entry could not be read. Nothing was lost."
          }
          onRetry={state.reload}
        />
      </>
    );
  }

  const { entry, languages } = state.data;
  const nameOf = (code: string) =>
    languages.find((language: Language) => language.code === code)?.name ??
    code.toUpperCase();

  /** Applies a change, and says so in words whether it worked or not. */
  const apply = async (next: Promise<Entry>, message: string) => {
    setBusy(true);
    try {
      const updated = await next;
      state.set({ entry: updated, languages });
      showToast(message, { icon: "check" });
    } catch (error) {
      showToast(
        error instanceof Error && error.message
          ? error.message
          : "That was not saved. Nothing changed; try again.",
      );
      // Somebody else changed it first: show what is there now.
      if (error instanceof OwnwordsError && error.status === 409) {
        state.reload();
      }
    }
    setBusy(false);
  };

  const closeSheet = () => {
    setTarget(null);
    setTyped("");
  };

  const closeSenseSheet = () => {
    setAddingSense(false);
    setGloss("");
  };

  const saveSense = () => {
    const text = gloss.trim();
    if (!text) return;
    closeSenseSheet();
    void apply(client.addSense(entry.id, text), "Sense added.");
  };

  const saveTyped = () => {
    const text = typed.trim();
    if (!target || !text) return;
    closeSheet();
    if (target.kind === "fix") {
      void apply(
        client.updateEquivalent(
          entry.id,
          target.sense.id,
          target.equivalent.id,
          {
            version: target.equivalent.version,
            text,
          },
        ),
        "Saved, typed by hand.",
      );
    } else {
      void apply(
        client.addEquivalents(entry.id, target.sense.id, [
          { language: target.language, text, state: "manual" },
        ]),
        `Added in ${nameOf(target.language)}.`,
      );
    }
  };

  const openEdit = () => {
    setEditNote(entry.note);
    setEditKind(entry.kind);
    setConfirmDelete(false);
    setEditing(true);
  };

  const saveEdit = () => {
    setEditing(false);
    void apply(
      client.updateEntry(entry.id, {
        version: entry.version,
        note: editNote,
        kind: editKind,
      }),
      "Entry saved.",
    );
  };

  const remove = async () => {
    setEditing(false);
    setBusy(true);
    try {
      await client.deleteEntry(entry.id, entry.version);
      back();
      showToast("Deleted from your Lexicon.", { icon: "check" });
    } catch (error) {
      setBusy(false);
      showToast(
        error instanceof Error && error.message
          ? error.message
          : "That entry was not deleted. Try again.",
      );
      if (error instanceof OwnwordsError && error.status === 409) {
        state.reload();
      }
    }
  };

  /** The configured languages a sense has no equivalent in yet. */
  const missingFrom = (sense: Sense) =>
    languages
      .map((language) => language.code)
      .filter(
        (code) =>
          code !== entry.language &&
          !sense.equivalents.some((equivalent) => equivalent.language === code),
      );

  const fixing = target?.kind === "fix" ? target.equivalent : null;

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
            disabled={busy}
            onClick={openEdit}
          />
        }
      />
      <Screen>
        <div style={{ padding: "4px 4px 0" }}>
          <p
            style={{
              margin: 0,
              font: "var(--type-overline)",
              letterSpacing: "var(--tracking-wide)",
              textTransform: "uppercase",
              color: "var(--fg-3)",
            }}
          >
            {nameOf(entry.language)} · {entry.kind}
          </p>
          <p
            lang={entry.language}
            style={{
              margin: "6px 0 0",
              font: "var(--type-hero)",
              fontSize: "2.25rem",
              letterSpacing: "var(--tracking-display)",
            }}
          >
            {entry.headword}
          </p>
          {entry.note && (
            <p
              style={{
                margin: "8px 0 0",
                font: "var(--type-body)",
                color: "var(--fg-2)",
              }}
            >
              “{entry.note}”
            </p>
          )}
        </div>

        {entry.senses.map((sense, index) => {
          const missing = missingFrom(sense);
          const rows = sense.equivalents.length + missing.length;
          return (
            <Section
              key={sense.id}
              title={
                entry.senses.length > 1
                  ? `Sense ${index + 1}${sense.gloss ? ` · ${sense.gloss}` : ""}`
                  : sense.gloss
              }
            >
              <Card padding={0}>
                {rows === 0 && (
                  <p
                    style={{
                      margin: 0,
                      padding: "16px",
                      font: "var(--type-body)",
                      color: "var(--fg-3)",
                    }}
                  >
                    No equivalents on this sense yet.
                  </p>
                )}
                {sense.equivalents.map((equivalent, position) => (
                  <div
                    key={equivalent.id}
                    style={{
                      ...rowStyle,
                      borderBottom:
                        position < rows - 1 ? "1px solid var(--border-1)" : 0,
                    }}
                  >
                    <span style={codeStyle}>
                      {equivalent.language.toUpperCase()}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      {equivalent.text ? (
                        <div
                          lang={equivalent.language}
                          style={{
                            font: "var(--type-headword)",
                            fontSize: "1.125rem",
                            letterSpacing: "var(--tracking-display)",
                            textDecoration:
                              equivalent.fit === "false-friend"
                                ? "line-through"
                                : "none",
                            color:
                              equivalent.fit === "false-friend"
                                ? "var(--fg-3)"
                                : "var(--fg-1)",
                          }}
                        >
                          {equivalent.text}
                        </div>
                      ) : (
                        <div
                          style={{
                            font: "var(--type-body)",
                            color: "var(--fg-3)",
                          }}
                        >
                          {equivalent.state === "failed"
                            ? "Translation failed. Nothing was dropped."
                            : "Waiting for a translation."}
                        </div>
                      )}
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          marginTop: 6,
                          flexWrap: "wrap",
                        }}
                      >
                        {equivalent.fit && (
                          <StateLabel state={equivalent.fit} />
                        )}
                        <StateLabel state={equivalent.state} />
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {equivalent.state === "failed" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void apply(
                              client.retryTranslation(
                                entry.id,
                                sense.id,
                                equivalent.id,
                              ),
                              `Translated into ${nameOf(equivalent.language)}.`,
                            )
                          }
                        >
                          Retry
                        </Button>
                      )}
                      <IconButton
                        name="more-horizontal"
                        label={`Fix the ${nameOf(equivalent.language)} equivalent`}
                        disabled={busy}
                        onClick={() =>
                          setTarget({ kind: "fix", sense, equivalent })
                        }
                      />
                    </div>
                  </div>
                ))}
                {missing.map((code, position) => (
                  <div
                    key={code}
                    style={{
                      ...rowStyle,
                      borderBottom:
                        sense.equivalents.length + position < rows - 1
                          ? "1px solid var(--border-1)"
                          : 0,
                    }}
                  >
                    <span style={codeStyle}>{code.toUpperCase()}</span>
                    <span
                      style={{ font: "var(--type-body)", color: "var(--fg-3)" }}
                    >
                      No {nameOf(code)} equivalent yet.
                    </span>
                    <IconButton
                      name="plus"
                      label={`Add the ${nameOf(code)} equivalent`}
                      disabled={busy}
                      onClick={() =>
                        setTarget({ kind: "add", sense, language: code })
                      }
                    />
                  </div>
                ))}
              </Card>
            </Section>
          );
        })}

        <Section title="Mastery">
          <Card padding={14}>
            <div style={{ display: "grid", gap: 12 }}>
              {Object.entries(entry.mastery).length === 0 && (
                <p
                  style={{
                    margin: 0,
                    font: "var(--type-body)",
                    color: "var(--fg-3)",
                  }}
                >
                  Not practised yet. It joins the queue once an equivalent is
                  confirmed.
                </p>
              )}
              {Object.entries(entry.mastery).map(([code, mastery]) => (
                <div key={code} style={{ display: "grid", gap: 8 }}>
                  <span style={{ font: "var(--type-label)" }}>
                    {nameOf(code)}
                  </span>
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
          disabled={busy}
          onClick={() => setAddingSense(true)}
        >
          Add another sense
        </Button>
      </Screen>

      <AppSheet
        open={addingSense}
        title="Add another sense"
        onClose={closeSenseSheet}
        footer={
          <Button variant="ghost" full onClick={closeSenseSheet}>
            Cancel
          </Button>
        }
      >
        <div style={{ display: "grid", gap: 8 }}>
          <TextField
            label="What does it mean in this sense?"
            name="sense-gloss"
            value={gloss}
            onChange={setGloss}
            placeholder="A short gloss"
            hint="Adding a sense never rewrites another."
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveSense();
              }
            }}
          />
          <Button
            full
            disabled={!gloss.trim()}
            icon="check"
            onClick={saveSense}
          >
            Add this sense
          </Button>
        </div>
      </AppSheet>

      <AppSheet
        open={target !== null}
        title={
          target?.kind === "add"
            ? `The ${nameOf(target.language)} equivalent`
            : "How well does it fit?"
        }
        onClose={closeSheet}
        footer={
          <Button variant="ghost" full onClick={closeSheet}>
            Cancel
          </Button>
        }
      >
        <div style={{ display: "grid", gap: 8 }}>
          {/* A fit describes wording, so a translation still missing has none to judge. */}
          {fixing?.text &&
            fits.map((option) => (
              <button
                key={option.value}
                type="button"
                className="ow-press-card"
                onClick={() => {
                  if (target?.kind !== "fix") return;
                  const { sense, equivalent } = target;
                  closeSheet();
                  void apply(
                    client.updateEquivalent(entry.id, sense.id, equivalent.id, {
                      version: equivalent.version,
                      fit: option.value,
                      state:
                        equivalent.state === "manual" ? "manual" : "confirmed",
                    }),
                    `Marked as ${option.label.toLowerCase()}.`,
                  );
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr)",
                  gap: 12,
                  alignItems: "center",
                  textAlign: "left",
                  padding: "12px 14px",
                  minHeight: 52,
                  border: "1px solid var(--border-1)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-surface)",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                }}
              >
                <StateLabel state={option.value} />
                <span
                  style={{
                    font: "var(--type-caption)",
                    color: "var(--fg-2)",
                    fontSize: ".8125rem",
                  }}
                >
                  {option.description}
                </span>
              </button>
            ))}
          <TextField
            label={
              target?.kind === "add"
                ? "Type the equivalent"
                : "Or type the equivalent yourself"
            }
            name="equivalent"
            display
            value={typed}
            onChange={setTyped}
            placeholder="Your own wording"
            hint="Typed by hand always wins over a suggestion."
            lang={
              target?.kind === "fix"
                ? target.equivalent.language
                : target?.language
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                saveTyped();
              }
            }}
          />
          <Button
            full
            disabled={!typed.trim()}
            icon="check"
            onClick={saveTyped}
          >
            Save this wording
          </Button>
        </div>
      </AppSheet>

      <AppSheet
        open={editing}
        title="Edit this entry"
        onClose={() => setEditing(false)}
        footer={
          <Button variant="ghost" full onClick={() => setEditing(false)}>
            Cancel
          </Button>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div
            role="group"
            aria-label="What you stored"
            style={{ display: "flex", gap: 8 }}
          >
            <Chip
              size="sm"
              selected={editKind === "expression"}
              onClick={() => setEditKind("expression")}
            >
              An expression
            </Chip>
            <Chip
              size="sm"
              selected={editKind === "word"}
              onClick={() => setEditKind("word")}
            >
              A word
            </Chip>
          </div>
          <TextField
            label="What do you mean by it?"
            name="edit-note"
            multiline
            value={editNote}
            onChange={setEditNote}
            hint="This note is what keeps false friends out."
          />
          <Button full icon="check" onClick={saveEdit}>
            Save changes
          </Button>
          {confirmDelete ? (
            <>
              <p
                role="status"
                style={{
                  margin: 0,
                  font: "var(--type-body)",
                  fontSize: ".9375rem",
                }}
              >
                It leaves your Lexicon and its practice. Delete it?
              </p>
              <Button
                full
                variant="outline"
                icon="x"
                onClick={() => void remove()}
              >
                Yes, delete it
              </Button>
            </>
          ) : (
            <Button
              full
              variant="outline"
              icon="x"
              onClick={() => setConfirmDelete(true)}
            >
              Delete this entry
            </Button>
          )}
        </div>
      </AppSheet>
    </>
  );
}

const rowStyle = {
  display: "grid",
  gridTemplateColumns: "32px minmax(0, 1fr) auto",
  gap: 12,
  alignItems: "center",
  padding: "12px 16px",
} as const;

const codeStyle = {
  font: "var(--type-overline)",
  letterSpacing: ".06em",
  color: "var(--fg-3)",
} as const;
