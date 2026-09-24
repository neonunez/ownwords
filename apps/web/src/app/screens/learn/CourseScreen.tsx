import { useNavigate } from "react-router-dom";
import { Card, Icon, TopBar } from "../../../design-system";
import type { IconName } from "../../../design-system";
import { Screen, Section } from "../../layout";
import { Failed, Loading } from "../ScreenState";
import { useAsync } from "../../shell/useAsync";
import { useClient } from "../../shell/ClientProvider";
import { useScreen } from "../../shell/useScreen";
import type { UnitState } from "../../../api/types";

const marks: Record<
  UnitState,
  { icon: IconName; fg: string; bg: string; written: string }
> = {
  done: {
    icon: "check",
    fg: "var(--state-confirmed)",
    bg: "var(--state-confirmed-soft)",
    written: "finished",
  },
  current: {
    icon: "play",
    fg: "var(--fg-on-accent)",
    bg: "var(--accent)",
    written: "in progress",
  },
  locked: {
    icon: "lock",
    fg: "var(--fg-3)",
    bg: "var(--bg-sunken)",
    written: "locked",
  },
};

/** The lesson and the path on one screen: resume on top, the units below. */
export function CourseScreen() {
  const client = useClient();
  const navigate = useNavigate();
  const { openPanel } = useScreen();
  const state = useAsync(() => client.getCourse(), [client]);

  const header = (
    <TopBar title="Course" large mode="Learn · Русский" onMenu={openPanel} />
  );

  if (state.loading && !state.data) {
    return (
      <>
        {header}
        <Loading label="Reading the course." />
      </>
    );
  }
  if (state.error || !state.data) {
    return (
      <>
        {header}
        <Failed
          message="The course could not be read. Nothing was lost."
          onRetry={state.reload}
        />
      </>
    );
  }

  const course = state.data;

  return (
    <>
      {header}
      <Screen>
        <Card
          tone="accent"
          padding={18}
          onClick={() => navigate(`/learn/course/${course.resume.unitId}`)}
        >
          <span
            style={{
              display: "block",
              font: "var(--type-overline)",
              letterSpacing: "var(--tracking-wide)",
              textTransform: "uppercase",
              opacity: 0.9,
            }}
          >
            Continue · Unit {course.resume.unitNumber}
          </span>
          <span
            lang={course.language}
            style={{
              display: "block",
              font: "var(--type-title)",
              fontSize: "1.75rem",
              marginTop: 6,
              letterSpacing: "var(--tracking-display)",
            }}
          >
            {course.resume.title}
          </span>
          <span
            style={{
              display: "block",
              font: "var(--type-body)",
              fontSize: ".9375rem",
              opacity: 0.9,
              marginTop: 4,
            }}
          >
            {course.resume.step} · {course.resume.canDo}
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 16,
            }}
          >
            <span
              role="img"
              aria-label={`${Math.round(course.resume.progress * 100)}% through this unit`}
              style={{
                flex: 1,
                height: 6,
                borderRadius: 99,
                background:
                  "color-mix(in oklab, var(--fg-on-accent) 22%, transparent)",
                display: "block",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: `${course.resume.progress * 100}%`,
                  height: "100%",
                  borderRadius: 99,
                  background: "var(--fg-on-accent)",
                }}
              />
            </span>
            <Icon name="arrow-right" size={22} />
          </span>
        </Card>

        <Section title="Units">
          <Card padding={0}>
            {course.units.map((unit, index) => {
              const mark = marks[unit.state];
              const locked = unit.state === "locked";
              return (
                <button
                  key={unit.id}
                  type="button"
                  className={locked ? undefined : "ow-row"}
                  disabled={locked}
                  onClick={() => navigate(`/learn/course/${unit.id}`)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "40px minmax(0, 1fr) auto",
                    gap: 14,
                    alignItems: "center",
                    width: "100%",
                    padding: "12px 16px",
                    minHeight: 64,
                    border: 0,
                    borderBottom:
                      index < course.units.length - 1
                        ? "1px solid var(--border-1)"
                        : 0,
                    background: "transparent",
                    color: "inherit",
                    textAlign: "left",
                    cursor: locked ? "default" : "pointer",
                    font: "inherit",
                    opacity: locked ? 0.6 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 99,
                      background: mark.bg,
                      color: mark.fg,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    <Icon name={mark.icon} size={18} strokeWidth={2} />
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      lang={course.language}
                      style={{
                        display: "block",
                        font: "var(--type-headword)",
                        fontSize: "1.125rem",
                        letterSpacing: "var(--tracking-display)",
                      }}
                    >
                      {unit.title}
                    </span>
                    <span
                      style={{
                        display: "block",
                        font: "var(--type-caption)",
                        color: "var(--fg-3)",
                        marginTop: 2,
                      }}
                    >
                      {unit.subtitle}
                    </span>
                  </span>
                  <span
                    style={{
                      font: "var(--type-caption)",
                      color: "var(--fg-3)",
                      textAlign: "right",
                    }}
                  >
                    {unit.number === 0 ? "intro" : `unit ${unit.number}`}
                    <span style={{ display: "block" }}>{mark.written}</span>
                  </span>
                </button>
              );
            })}
          </Card>
        </Section>

        <Section title="Can-do milestones">
          <Card tone="sunken" padding={14}>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "grid",
                gap: 10,
              }}
            >
              {course.milestones.map((milestone) => (
                <li
                  key={milestone.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    font: "var(--type-body)",
                    fontSize: ".9375rem",
                    color: milestone.reached ? "var(--fg-1)" : "var(--fg-3)",
                  }}
                >
                  <Icon
                    name={milestone.reached ? "circle-check" : "circle"}
                    size={18}
                    color={
                      milestone.reached
                        ? "var(--state-confirmed)"
                        : "var(--fg-3)"
                    }
                  />
                  <span>
                    {milestone.text}
                    <span className="ow-visually-hidden">
                      {milestone.reached ? " · reached" : " · not yet reached"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      </Screen>
    </>
  );
}
