import { useNavigate } from "react-router-dom";
import { TopBar } from "../../design-system";
import { Screen } from "../layout";
import { useClient } from "../shell/ClientProvider";
import { useToast } from "../shell/ToastProvider";
import { useSession } from "../session/SessionGate";
import { LanguageForm } from "../session/LanguageForm";

/** Changes the languages and preferences the first run set. */
export function LanguagesScreen() {
  const client = useClient();
  const session = useSession();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const back = () => navigate(-1);

  return (
    <>
      <TopBar title="Languages" onBack={back} backLabel="Back" />
      <Screen>
        <LanguageForm
          {...(session ? { initial: session.onboarding } : {})}
          submitLabel="Save languages"
          onSubmit={async (next) => {
            await client.saveOnboarding(next);
            session?.refresh();
            showToast("Your languages are saved.", { icon: "check" });
            back();
          }}
        />
      </Screen>
    </>
  );
}
