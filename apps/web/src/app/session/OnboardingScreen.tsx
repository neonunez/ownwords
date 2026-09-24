import { TopBar } from "../../design-system";
import { Screen } from "../layout";
import { useClient } from "../shell/ClientProvider";
import { LanguageForm } from "./LanguageForm";
import type { Onboarding } from "../../api/types";

/** The first run: it asks only what changes the content. */
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
        <p style={{ margin: "0 4px", font: "var(--type-body)" }}>
          Which languages do you speak, and how well? Everything you store is
          kept reachable in each of them.
        </p>
        <LanguageForm
          submitLabel="Start"
          onSubmit={async (next) => onDone(await client.saveOnboarding(next))}
        />
      </Screen>
    </>
  );
}
