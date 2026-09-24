import { useNavigate, useParams } from "react-router-dom";
import { Card, Icon, TopBar } from "../../../design-system";
import { Screen } from "../../layout";
import { Empty, Failed, Loading } from "../ScreenState";
import { useAsync } from "../../shell/useAsync";
import { useClient } from "../../shell/ClientProvider";

/** One reference topic, in course order. What a lesson has not opened yet says so. */
export function ReferenceTopicScreen() {
  const { topicId = "" } = useParams();
  const client = useClient();
  const navigate = useNavigate();
  const state = useAsync(() => client.listReferenceTopics(), [client]);
  const back = () => navigate(-1);
  const topic = state.data?.find((candidate) => candidate.id === topicId);
  const header = (
    <TopBar
      title={topic?.title ?? "Reference"}
      onBack={back}
      backLabel="Back"
    />
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
  if (!topic || topic.items.length === 0) {
    return (
      <>
        {header}
        <Screen>
          <Empty message="Nothing in this part of the reference yet." />
        </Screen>
      </>
    );
  }

  return (
    <>
      {header}
      <Screen>
        {topic.items.map((item) => (
          <Card key={item.id} padding={16} style={{ display: "grid", gap: 8 }}>
            <h2
              style={{
                margin: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
                font: "var(--type-label)",
                fontSize: "1.0625rem",
              }}
            >
              {item.locked && (
                <Icon name="lock" size={16} color="var(--fg-3)" />
              )}
              {item.title}
            </h2>
            {item.locked ? (
              <p
                style={{
                  margin: 0,
                  font: "var(--type-caption)",
                  color: "var(--fg-3)",
                }}
              >
                Locked. It opens once the lesson that teaches it is finished.
              </p>
            ) : (
              item.lines.map((line) => (
                <p key={line} style={{ margin: 0, font: "var(--type-body)" }}>
                  {line}
                </p>
              ))
            )}
          </Card>
        ))}
      </Screen>
    </>
  );
}
