import { useId, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Card,
  Icon,
  SegmentedControl,
  Switch,
  TopBar,
  type IconName,
} from "../../design-system";
import { Note, Screen, Section } from "../layout";
import { homeFor, modeFromPath } from "../navigation";
import { useAsync } from "../shell/useAsync";
import { useClient } from "../shell/ClientProvider";
import { useTheme, type Appearance } from "../shell/ThemeProvider";
import { useToast } from "../shell/ToastProvider";
import { useSession } from "../session/SessionGate";
import type { ExplanationLanguage, Preferences } from "../../api/types";

const appearances: { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const explanations: { value: ExplanationLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

/**
 * Everything that is set rather than done: the languages, the preferences,
 * the data and the sign-in. It has a page of its own, reached from the side
 * panel, so the panel is left to moving around.
 */
export function SettingsScreen() {
  const client = useClient();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { appearance, setAppearance } = useTheme();
  const suggestId = useId();
  const mode = modeFromPath(location.pathname);
  const demo = client.kind === "demo";
  const [busy, setBusy] = useState(false);

  const languages = useAsync(
    () => client.listLanguages(),
    [client, session?.onboarding],
  );
  const stored = useAsync(() => client.getPreferences(), [client]);
  const preferences = stored.data;

  // Opened from the side panel, back returns to the screen beneath it; opened
  // directly, there is nothing beneath, so back goes to the mode's home.
  const back = () =>
    location.key === "default"
      ? navigate(homeFor[mode], { replace: true })
      : navigate(-1);

  const update = (patch: Partial<Preferences>) => {
    if (!preferences) return;
    const before = preferences;
    stored.set({ ...preferences, ...patch });
    client.savePreferences({ ...preferences, ...patch }).then(
      (saved) => {
        stored.set(saved);
        session?.refresh();
      },
      (error: unknown) => {
        stored.set(before);
        showToast(
          error instanceof Error
            ? `Not saved. ${error.message}`
            : "That preference was not saved. Try again.",
        );
      },
    );
  };

  /** Runs an account action, saying in words when it did not work. */
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showToast(
        error instanceof Error && error.message
          ? error.message
          : "That did not work. Nothing changed; try again.",
      );
    }
    setBusy(false);
  };

  const exportData = () =>
    act(async () => {
      const { filename, blob } = await client.exportAccount();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      // Give the browser a moment to start the download before letting go.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      showToast("Your data is saved as a file.", { icon: "download" });
    });

  const addPasskey = () =>
    act(async () => {
      await client.addPasskey();
      showToast("Passkey added. Next time, sign in with it.", {
        icon: "check",
      });
    });

  const signOut = () =>
    act(async () => {
      await session?.signOut();
      // The next sign-in opens on the mode's home, not on Settings.
      navigate(homeFor[mode], { replace: true, state: null });
    });

  return (
    <>
      <TopBar title="Settings" large onBack={back} backLabel="Back" />
      <Screen>
        {session && (
          <Card padding={14}>
            <span
              style={{
                display: "grid",
                gridTemplateColumns: "40px minmax(0, 1fr)",
                gap: 12,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--radius-pill)",
                  background: "var(--accent-soft)",
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <Icon name="user" size={20} color="var(--accent-soft-fg)" />
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    font: "var(--type-label)",
                    fontSize: "1rem",
                    overflowWrap: "anywhere",
                  }}
                >
                  {session.account.name || session.account.email}
                </span>
                <span
                  style={{
                    display: "block",
                    font: "var(--type-caption)",
                    color: "var(--fg-2)",
                    overflowWrap: "anywhere",
                  }}
                >
                  <span className="ow-visually-hidden">Signed in as </span>
                  {session.account.email}
                </span>
              </span>
            </span>
          </Card>
        )}

        <Section title="Languages">
          <Card padding={0}>
            {languages.data ? (
              <ul
                aria-label="Your languages"
                style={{ listStyle: "none", margin: 0, padding: 0 }}
              >
                {languages.data.map((language) => (
                  <li
                    key={language.code}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: "11px 14px",
                      minHeight: 44,
                      borderBottom: "1px solid var(--border-1)",
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
                  </li>
                ))}
              </ul>
            ) : (
              <p
                role={languages.error ? "alert" : "status"}
                style={{
                  margin: 0,
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--border-1)",
                  font: "var(--type-body)",
                  fontSize: ".9375rem",
                  color: "var(--fg-2)",
                }}
              >
                {languages.error
                  ? "Your languages could not be read."
                  : "Reading your languages."}
              </p>
            )}
            <ActionRow
              icon="languages"
              label="Change languages"
              detail="Add one, set a level, or start the course"
              disabled={demo}
              onClick={() => navigate(`/${mode}/languages`)}
              last
              opens
            />
          </Card>
        </Section>

        <Section title="Preferences">
          <Card padding={0}>
            <div style={stacked(true)}>
              <Icon name="languages" size={18} color="var(--fg-3)" />
              <span>Explanations in</span>
              <SegmentedControl
                style={{ gridColumn: 2 }}
                label="Explanations in"
                options={explanations}
                value={preferences?.explanationsIn ?? "en"}
                onChange={(explanationsIn) => update({ explanationsIn })}
              />
            </div>
            <div style={row(true)}>
              <Icon name="sparkles" size={18} color="var(--fg-3)" />
              <span id={suggestId}>Suggest translations</span>
              <Switch
                checked={preferences?.suggestTranslations ?? true}
                labelledBy={suggestId}
                label="Suggest translations"
                disabled={!preferences}
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
            <div style={stacked(false)}>
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
          {stored.error && (
            <Note>
              Your preferences could not be read, so they cannot be changed
              right now.{" "}
              <button
                type="button"
                onClick={stored.reload}
                className="ow-press-dim"
                style={{
                  border: 0,
                  padding: 0,
                  background: "none",
                  color: "var(--accent-soft-fg)",
                  font: "inherit",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                Try again
              </button>
            </Note>
          )}
        </Section>

        <Section title="Your data">
          <Card padding={0}>
            <ActionRow
              icon="download"
              label="Export my data"
              detail="Your account, languages, Lexicon and progress, as one file"
              disabled={busy}
              onClick={() => void exportData()}
              first
              last
            />
          </Card>
        </Section>

        {!demo && (
          <Section title="Sign-in">
            <Card padding={0}>
              <ActionRow
                icon="key-round"
                label="Add a passkey on this device"
                detail="Sign in here next time without Google"
                disabled={busy}
                onClick={() => void addPasskey()}
                first
              />
              <ActionRow
                icon="log-out"
                label="Sign out"
                disabled={busy}
                onClick={() => void signOut()}
                last
              />
            </Card>
          </Section>
        )}

        {demo && (
          <Note>
            This is a demo with sample data. Nothing is sent anywhere, and
            nothing is kept when you close the tab.
          </Note>
        )}
      </Screen>
    </>
  );
}

/** A row in a settings card that does something, named by its label alone. */
function ActionRow({
  icon,
  label,
  detail,
  disabled,
  onClick,
  first,
  last,
  opens,
}: {
  icon: IconName;
  label: string;
  /** A quiet line under the label: read as its description, not its name. */
  detail?: string;
  disabled?: boolean;
  onClick: () => void;
  /** Where the row sits in its card, so a pressed row keeps the card's corners. */
  first?: boolean;
  last?: boolean;
  /** Opens another screen, and says so with a chevron. */
  opens?: boolean;
}) {
  const labelId = useId();
  const detailId = useId();
  const radius = "var(--radius-lg)";
  return (
    <button
      type="button"
      className={disabled ? undefined : "ow-row"}
      disabled={disabled}
      onClick={onClick}
      aria-labelledby={labelId}
      aria-describedby={detail ? detailId : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: "24px minmax(0, 1fr) auto",
        gap: 10,
        alignItems: "center",
        width: "100%",
        minHeight: 52,
        padding: "8px 14px",
        border: 0,
        borderBottom: last ? 0 : "1px solid var(--border-1)",
        borderRadius: `${first ? radius : 0} ${first ? radius : 0} ${last ? radius : 0} ${last ? radius : 0}`,
        background: "transparent",
        textAlign: "left",
        font: "var(--type-body)",
        fontSize: ".9375rem",
        color: "var(--fg-1)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Icon name={icon} size={18} color="var(--fg-2)" />
      <span style={{ minWidth: 0 }}>
        <span id={labelId} style={{ display: "block" }}>
          {label}
        </span>
        {detail && (
          <span
            id={detailId}
            style={{
              display: "block",
              font: "var(--type-caption)",
              color: "var(--fg-3)",
            }}
          >
            {detail}
          </span>
        )}
      </span>
      {opens ? (
        <Icon name="chevron-right" size={18} color="var(--fg-3)" />
      ) : (
        <span />
      )}
    </button>
  );
}

const row = (bordered: boolean) =>
  ({
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr) auto",
    gap: 10,
    alignItems: "center",
    padding: "6px 14px",
    minHeight: 52,
    borderBottom: bordered ? "1px solid var(--border-1)" : 0,
    font: "var(--type-body)",
    fontSize: ".9375rem",
  }) as const;

/** A label with its control on the line below, for a control too wide to sit beside it. */
const stacked = (bordered: boolean) =>
  ({
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr)",
    gap: 10,
    alignItems: "center",
    padding: "10px 14px",
    borderBottom: bordered ? "1px solid var(--border-1)" : 0,
    font: "var(--type-body)",
    fontSize: ".9375rem",
  }) as const;
