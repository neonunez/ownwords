import { useLocation, useNavigate } from "react-router-dom";
import { TopBar } from "../../design-system";
import { Screen } from "../layout";
import { modeFromPath } from "../navigation";
import { useClient } from "../shell/ClientProvider";
import { useToast } from "../shell/ToastProvider";
import { useSession } from "../session/SessionGate";
import { LanguageForm } from "../session/LanguageForm";

/**
 * Changes the languages the first run set, from Settings. The preferences sit
 * on Settings itself, so this form saves them as they stand when it saves,
 * not as they were when it opened.
 */
export function LanguagesScreen() {
  const client = useClient();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const mode = modeFromPath(location.pathname);

  // Opened from Settings, back returns there; opened directly, there is
  // nothing beneath it in the app, so back goes to Settings instead of away.
  const back = () =>
    location.key === "default"
      ? navigate(`/${mode}/settings`, { replace: true })
      : navigate(-1);

  return (
    <>
      <TopBar title="Languages" onBack={back} backLabel="Back" />
      <Screen>
        <LanguageForm
          {...(session ? { initial: session.onboarding } : {})}
          submitLabel="Save languages"
          askPreferences={false}
          onSubmit={async (next) => {
            // A preference changed in Settings a moment ago may not have
            // reached the session yet; this form cannot show it, so it must
            // not write back an older one.
            const current = await client.getPreferences();
            await client.saveOnboarding({
              languages: next.languages,
              preferences: {
                explanationsIn: current.explanationsIn,
                audioInCourse: current.audioInCourse,
                suggestTranslations: current.suggestTranslations,
              },
            });
            session?.refresh();
            showToast("Your languages are saved.", { icon: "check" });
            back();
          }}
        />
      </Screen>
    </>
  );
}
