import { useEffect, useId, useRef, useState } from "react";
import {
  Button,
  Card,
  Icon,
  IconButton,
  Mascot,
  SegmentedControl,
  Switch,
} from "../../design-system";
import { Section } from "../layout";
import { useDialogBehaviour } from "../../lib/useDialogBehaviour";
import { useTheme, type Appearance } from "./ThemeProvider";
import { useClient } from "./ClientProvider";
import { useToast } from "./ToastProvider";
import type { Language, Preferences } from "../../api/types";
import type { Mode } from "../navigation";

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  onModeChange: (next: Mode) => void;
  languages: readonly Language[];
}

const modes: { key: Mode; title: string; icon: "repeat" | "graduation-cap" }[] =
  [
    { key: "maintain", title: "Maintain", icon: "repeat" },
    { key: "learn", title: "Learn", icon: "graduation-cap" },
  ];

const appearances: { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Mode, languages, preferences, export and account. Everything that is not a
 * daily action lives here, which is what leaves the tab bar to the four things
 * a person does every day.
 */
export function SidePanel({
  open,
  onClose,
  mode,
  onModeChange,
  languages,
}: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const audioId = useId();
  const suggestId = useId();
  const { appearance, setAppearance } = useTheme();
  const client = useClient();
  const { showToast } = useToast();
  const [preferences, setPreferences] = useState<Preferences | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void client.getPreferences().then((value) => {
      if (live) setPreferences(value);
    });
    return () => {
      live = false;
    };
  }, [open, client]);

  useDialogBehaviour(panelRef, open, onClose);

  const update = (patch: Partial<Preferences>) => {
    if (!preferences) return;
    const next = { ...preferences, ...patch };
    setPreferences(next);
    void client.savePreferences(next);
  };

  const maintained = languages
    .filter((language) => language.role !== "learning")
    .map((language) => language.name)
    .join(" · ");
  const learning = languages.find((language) => language.role === "learning");

  return (
    <div
      inert={!open}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 30,
        visibility: open ? "visible" : "hidden",
        transition: `visibility 0s linear ${open ? "0s" : "var(--motion-screen)"}`,
      }}
    >
      <button
        type="button"
        aria-label="Close the side panel"
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          border: 0,
          padding: 0,
          background: "var(--bg-scrim)",
          opacity: open ? 1 : 0,
          transition: "opacity var(--motion-base) var(--ease-out)",
          cursor: "default",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          width: "min(300px, 86%)",
          background: "var(--bg-elevated)",
          boxShadow: "var(--shadow-3)",
          paddingTop: "var(--safe-top)",
          paddingBottom: "var(--safe-bottom)",
          transform: open ? "none" : "translateX(-100%)",
          transition: "transform var(--motion-screen) var(--ease-out)",
          display: "flex",
          flexDirection: "column",
          borderRadius: "0 var(--radius-xl) var(--radius-xl) 0",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px 8px",
          }}
        >
          <Mascot size={40} interactive={false} />
          <h2
            id={titleId}
            style={{
              margin: 0,
              font: "500 1.5rem/1 var(--font-display)",
              letterSpacing: "var(--tracking-display)",
            }}
          >
            Ownwórds
          </h2>
          <span style={{ flex: 1 }} />
          <IconButton name="x" label="Close the side panel" onClick={onClose} />
        </div>

        <div
          className="ow-scroll"
          style={{
            padding: "8px 20px 20px",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 18,
            overflow: "auto",
            flex: 1,
          }}
        >
          <Section title="Mode">
            <div style={{ display: "grid", gap: 8 }}>
              {modes.map((option) => {
                const selected = mode === option.key;
                const subtitle =
                  option.key === "maintain"
                    ? maintained
                    : learning
                      ? `${learning.name} · ${learning.level.replace("learning · ", "")} → A1`
                      : "No language started yet";
                return (
                  <Card
                    key={option.key}
                    tone={selected ? "soft" : "surface"}
                    padding={12}
                    onClick={() => onModeChange(option.key)}
                    aria-current={selected ? "true" : undefined}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "24px minmax(0, 1fr) auto",
                      gap: 12,
                      alignItems: "center",
                      borderColor: selected ? "var(--accent)" : undefined,
                    }}
                  >
                    <Icon
                      name={option.icon}
                      size={20}
                      color={selected ? "var(--accent-soft-fg)" : "var(--fg-2)"}
                    />
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          font: "var(--type-label)",
                          fontSize: "1rem",
                        }}
                      >
                        {option.title}
                      </span>
                      <span
                        style={{
                          display: "block",
                          font: "var(--type-caption)",
                          // The selected card sits on the soft accent tint, where
                          // the quietest foreground would fall under 4.5:1.
                          color: selected ? "var(--fg-2)" : "var(--fg-3)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {subtitle}
                      </span>
                    </span>
                    {selected ? (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span className="ow-visually-hidden">Current mode</span>
                        <Icon name="check" size={18} color="var(--accent)" />
                      </span>
                    ) : (
                      <span />
                    )}
                  </Card>
                );
              })}
            </div>
          </Section>

          <Section title="Languages">
            <Card padding={0}>
              {languages.map((language, index) => (
                <div
                  key={language.code}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: "11px 14px",
                    minHeight: 44,
                    borderBottom:
                      index < languages.length - 1
                        ? "1px solid var(--border-1)"
                        : 0,
                    font: "var(--type-body)",
                    fontSize: ".9375rem",
                  }}
                >
                  <span lang={language.code}>{language.name}</span>
                  <span
                    style={{
                      font: "var(--type-caption)",
                      color: "var(--fg-3)",
                    }}
                  >
                    {language.level}
                  </span>
                </div>
              ))}
            </Card>
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              onClick={() =>
                showToast("Adding a language arrives with the account backend.")
              }
            >
              Add a language
            </Button>
          </Section>

          <Section title="Preferences">
            <Card padding={0}>
              <div style={row(true)}>
                <Icon name="languages" size={18} color="var(--fg-3)" />
                <span>Explanations in</span>
                <span
                  style={{ font: "var(--type-caption)", color: "var(--fg-3)" }}
                >
                  {languages.find(
                    (language) => language.code === preferences?.explanationsIn,
                  )?.name ?? "English"}
                </span>
              </div>
              <div style={row(true)}>
                <Icon name="volume-2" size={18} color="var(--fg-3)" />
                <span id={audioId}>Audio in the course</span>
                <Switch
                  checked={preferences?.audioInCourse ?? true}
                  labelledBy={audioId}
                  label="Audio in the course"
                  onChange={(next) => update({ audioInCourse: next })}
                />
              </div>
              <div style={row(true)}>
                <Icon name="sparkles" size={18} color="var(--fg-3)" />
                <span id={suggestId}>Suggest translations</span>
                <Switch
                  checked={preferences?.suggestTranslations ?? true}
                  labelledBy={suggestId}
                  label="Suggest translations"
                  onChange={(next) => update({ suggestTranslations: next })}
                />
              </div>
              <div style={row(true)}>
                <Icon name="bell" size={18} color="var(--fg-3)" />
                <span>Reminders</span>
                <span
                  style={{ font: "var(--type-caption)", color: "var(--fg-3)" }}
                >
                  After install
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px minmax(0, 1fr)",
                  gap: "10px",
                  alignItems: "center",
                  padding: "10px 14px",
                  borderTop: "1px solid var(--border-1)",
                  font: "var(--type-body)",
                  fontSize: ".9375rem",
                }}
              >
                <Icon
                  name={appearance === "dark" ? "moon" : "sun"}
                  size={18}
                  color="var(--fg-3)"
                />
                <span>Appearance</span>
                <SegmentedControl
                  style={{ gridColumn: 2 }}
                  label="Appearance"
                  options={appearances}
                  value={appearance}
                  onChange={setAppearance}
                />
              </div>
            </Card>
          </Section>

          <div style={{ display: "grid", gap: 4 }}>
            <Button
              variant="ghost"
              icon="download"
              style={{ justifyContent: "flex-start" }}
              onClick={() =>
                showToast("Export arrives with the account backend.")
              }
            >
              Export my data
            </Button>
            <Button
              variant="ghost"
              icon="user"
              style={{ justifyContent: "flex-start" }}
              onClick={() =>
                showToast("Sign-in arrives with the account backend.")
              }
            >
              Account
            </Button>
          </div>

          <p
            style={{
              margin: 0,
              padding: "0 4px",
              font: "var(--type-caption)",
              color: "var(--fg-3)",
            }}
          >
            Your collection lives in this browser for now. Nothing is sent
            anywhere, and nothing is kept when you close the tab.
          </p>
        </div>
      </div>
    </div>
  );
}

const row = (bordered: boolean) =>
  ({
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    padding: "6px 14px",
    minHeight: 48,
    borderBottom: bordered ? "1px solid var(--border-1)" : 0,
    font: "var(--type-body)",
    fontSize: ".9375rem",
  }) as const;
