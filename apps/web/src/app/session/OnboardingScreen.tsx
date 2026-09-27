import { Mascot, TopBar } from "../../design-system";
import { Screen } from "../layout";
import { useClient } from "../shell/ClientProvider";
import { LanguageForm } from "./LanguageForm";
import type { Onboarding } from "../../api/types";

/** The first run, on one screen: it asks only what changes the content. */
export function OnboardingScreen({
  onDone,
}: {
  onDone: (onboarding: Onboarding) => void;
}) {
  const client = useClient();
  return (
    <>
      <TopBar title="Your languages" large />
      <Screen>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "48px minmax(0, 1fr)",
            gap: 14,
            alignItems: "center",
            padding: "0 4px",
          }}
        >
          <Mascot size={48} expression="happy" interactive={false} />
          <p style={{ margin: 0, font: "var(--type-body)" }}>
            Ownwords does two things with languages: it keeps up the ones you
            already speak, and it teaches a new one from zero. Tell it which is
            which.
          </p>
        </div>
        <LanguageForm
          submitLabel="Start"
          onSubmit={async (next) => onDone(await client.saveOnboarding(next))}
        />
      </Screen>
    </>
  );
}
