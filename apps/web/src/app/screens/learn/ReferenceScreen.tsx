import { useNavigate } from "react-router-dom";
import { Card, Icon, TopBar } from "../../../design-system";
import type { IconName } from "../../../design-system";
import { Note, Screen } from "../../layout";
import { Empty, Failed, Loading } from "../ScreenState";
import { useAsync } from "../../shell/useAsync";
import { useClient } from "../../shell/ClientProvider";
import { useScreen } from "../../shell/useScreen";

/** One lookup tab, with grammar and verbs as its first and largest screen. */
export function ReferenceScreen() {
  const client = useClient();
  const { openPanel } = useScreen();
  const navigate = useNavigate();
  const state = useAsync(() => client.listReferenceTopics(), [client]);

  const header = (
    <TopBar title="Reference" large mode="Learn · Русский" onMenu={openPanel} />
  );

  if (state.loading && !state.data) {
    return (
      <>
        {header}
        <Loading label="Reading the reference." />
      </>
    );
  }
  if (state.error || !state.data) {
    return (
      <>
        {header}
        <Failed
          message="The reference could not be read. Nothing was lost."
          onRetry={state.reload}
        />
      </>
    );
  }

  const topics = state.data;
  if (topics.length === 0) {
    return (
      <>
        {header}
        <Screen>
          <Empty message="The reference is published with the course. There is no course for the language you are learning yet." />
        </Screen>
      </>
    );
  }

  return (
    <>
      {header}
      <Screen>
        <Card padding={0}>
          {topics.map((topic, index) => {
            const closed = topic.locked || topic.items.length === 0;
            return (
              <button
                key={topic.id}
                type="button"
                className={closed ? undefined : "ow-row"}
                disabled={closed}
                onClick={() => navigate(`/learn/reference/${topic.id}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "40px minmax(0, 1fr) auto",
                  gap: 14,
                  alignItems: "center",
                  width: "100%",
                  padding: "14px 16px",
                  minHeight: 64,
                  border: 0,
                  borderBottom:
                    index < topics.length - 1 ? "1px solid var(--border-1)" : 0,
                  background: "transparent",
                  color: "inherit",
                  textAlign: "left",
                  cursor: closed ? "default" : "pointer",
                  font: "inherit",
                  opacity: closed ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 99,
                    background: "var(--accent-soft)",
                    color: "var(--accent-soft-fg)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <Icon name={topic.icon as IconName} size={20} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      font: "var(--type-label)",
                      fontSize: "1rem",
                    }}
                  >
                    {topic.title}
                  </span>
                  <span
                    style={{
                      display: "block",
                      font: "var(--type-caption)",
                      color: "var(--fg-3)",
                      marginTop: 2,
                    }}
                  >
                    {topic.summary}
                  </span>
                </span>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    font: "var(--type-caption)",
                    color: "var(--fg-3)",
                  }}
                >
                  {topic.locked
                    ? `${topic.introducedIn} · locked`
                    : topic.introducedIn}
                  <Icon name="chevron-right" size={18} />
                </span>
              </button>
            );
          })}
        </Card>
        <Note>
          Each topic says which unit introduced it and what is still locked, and
          offers practice on the spot.
        </Note>
      </Screen>
    </>
  );
}
