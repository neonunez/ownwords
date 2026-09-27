import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Card,
  Icon,
  IconButton,
  Mascot,
  type IconName,
} from "../../design-system";
import { Section } from "../layout";
import { useDialogBehaviour } from "../../lib/useDialogBehaviour";
import { useClient } from "./ClientProvider";
import type { Language } from "../../api/types";
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

/** What is waiting on either side of the app, read when the panel opens. */
interface Waiting {
  /** The course step to carry on from; `null` when there is none to resume. */
  lesson: {
    lessonId: string;
    unitNumber: number;
    title: string;
    step: string;
    language: string;
  } | null;
  /** How long the Maintain practice due now takes; empty when nothing is due. */
  estimate: string;
  /** When Maintain practice comes next, if nothing is due now. */
  next: string | null;
  /** Whether Maintain progress could be read at all. */
  progressRead: boolean;
}

type WaitingState = "loading" | "failed" | Waiting;

/**
 * Mode, what is up next, and the languages: the panel is for moving around.
 * Settings, the account and the data have a page of their own, one row away,
 * which leaves the tab bar to the four things a person does every day.
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
  const client = useClient();
  const navigate = useNavigate();
  const [waiting, setWaiting] = useState<WaitingState>("loading");
  const demo = client.kind === "demo";
  const learningCode = languages.find(
    (language) => language.role === "learning",
  )?.code;

  // The panel is the one place that crosses modes, so it is the one place
  // that can say what is waiting on both sides, and go straight to it.
  useEffect(() => {
    if (!open) return;
    let live = true;
    // What was read last time stays up until the new answer replaces it.
    Promise.allSettled([
      client.getProgress(),
      learningCode ? client.getCourse() : Promise.resolve(null),
    ]).then(([progress, course]) => {
      if (!live) return;
      const summary = progress.status === "fulfilled" ? progress.value : null;
      const resume =
        course.status === "fulfilled" ? (course.value?.resume ?? null) : null;
      const lesson =
        resume && course.status === "fulfilled" && course.value
          ? {
              lessonId: resume.lessonId,
              unitNumber: resume.unitNumber,
              title: resume.title,
              step: resume.step,
              language: course.value.language,
            }
          : null;
      if (!summary && !lesson) {
        setWaiting("failed");
        return;
      }
      setWaiting({
        lesson,
        estimate: summary?.estimate ?? "",
        next: summary?.comingUp[0]?.when ?? null,
        progressRead: summary !== null,
      });
    });
    return () => {
      live = false;
    };
  }, [open, client, learningCode]);

  useDialogBehaviour(panelRef, open, onClose);

  /** Replacing the panel's own history entry closes it on the way. */
  const go = (path: string) => navigate(path, { replace: true, state: null });

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
            // Shorter than the panel now, so rows keep their own height
            // instead of stretching to fill it.
            alignContent: "start",
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
                      // Left out rather than `undefined` when not selected: an
                      // empty longhand would reset the card's border to ink.
                      ...(selected ? { borderColor: "var(--accent)" } : {}),
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

          <Section title="Up next">
            <UpNext waiting={waiting} go={go} />
          </Section>

          <Section title="Languages">
            <Card padding={0}>
              <ul
                aria-label="Your languages"
                style={{ listStyle: "none", margin: 0, padding: 0 }}
              >
                {languages.map((language, index) => (
                  <li
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
                  </li>
                ))}
              </ul>
            </Card>
          </Section>

          <Destination
            icon="settings"
            title="Settings"
            detail="Languages, preferences, your data and sign-in"
            onClick={() => go(`/${mode}/settings`)}
          />

          {demo && (
            <p
              style={{
                margin: 0,
                padding: "0 4px",
                font: "var(--type-caption)",
                color: "var(--fg-3)",
              }}
            >
              This is a demo with sample data. Nothing is sent anywhere, and
              nothing is kept when you close the tab.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** What is waiting, each item one tap from where the person will do it. */
function UpNext({
  waiting,
  go,
}: {
  waiting: WaitingState;
  go: (path: string) => void;
}) {
  if (waiting === "loading" || waiting === "failed") {
    return (
      <p style={quiet}>
        {waiting === "loading"
          ? "Looking for what is waiting."
          : "What is waiting could not be read. Open the panel again to retry."}
      </p>
    );
  }
  const { lesson, estimate, next, progressRead } = waiting;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {lesson && (
        <Destination
          icon="graduation-cap"
          title={`Carry on · Unit ${lesson.unitNumber}`}
          detail={
            <>
              <span lang={lesson.language}>{lesson.title}</span> · {lesson.step}
            </>
          }
          onClick={() => go(`/learn/course/${lesson.lessonId}`)}
        />
      )}
      {estimate ? (
        <Destination
          icon="repeat"
          title="Practice is due"
          detail={estimate}
          onClick={() => go("/maintain/practice")}
        />
      ) : (
        progressRead && (
          <p style={quiet}>
            {next
              ? `Nothing is due to practise. The next words come back ${next}.`
              : "Nothing is due to practise."}
          </p>
        )
      )}
    </div>
  );
}

/** A place to go: a real button, its name first and a line of detail under it. */
function Destination({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: IconName;
  title: string;
  detail: ReactNode;
  onClick: () => void;
}) {
  return (
    <Card
      padding={12}
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "24px minmax(0, 1fr) auto",
        gap: 12,
        alignItems: "center",
      }}
    >
      <Icon name={icon} size={20} color="var(--fg-2)" />
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: "block",
            font: "var(--type-label)",
            fontSize: "1rem",
          }}
        >
          {title}
        </span>
        <span
          style={{
            display: "block",
            font: "var(--type-caption)",
            color: "var(--fg-3)",
          }}
        >
          {detail}
        </span>
      </span>
      <Icon name="chevron-right" size={18} color="var(--fg-3)" />
    </Card>
  );
}

const quiet = {
  margin: 0,
  padding: "0 4px",
  font: "var(--type-caption)",
  color: "var(--fg-3)",
} as const;
