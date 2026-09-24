import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { TopBar } from "../../design-system";
import { useClient } from "../shell/ClientProvider";
import { Failed, Loading } from "../screens/ScreenState";
import { OnboardingScreen } from "./OnboardingScreen";
import { SignInScreen } from "./SignInScreen";
import type { Account, Onboarding } from "../../api/types";

type GateState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "signed-out"; ended: boolean }
  | { status: "signed-in"; account: Account; onboarding: Onboarding | null };

export interface SessionValue {
  account: Account;
  onboarding: Onboarding;
  /** Reads the session again, after something changed the profile. */
  refresh: () => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** The frame the gate's own screens sit in, matching the app's. */
function GateFrame({ children }: { children: ReactNode }) {
  return (
    <div className="ow-app">
      <main className="ow-main" id="ow-main">
        <div className="ow-screen">{children}</div>
      </main>
    </div>
  );
}

/**
 * Nothing behind the gate renders without a verified session and a finished
 * first run. The backend is the judge: the gate asks it who is signed in, and
 * any request that comes back 401 later brings the person back here.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const client = useClient();
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [run, setRun] = useState(0);

  useEffect(() => {
    let live = true;
    client.getSession().then(
      (session) => {
        if (!live) return;
        setState(
          session.status === "signed-out"
            ? { status: "signed-out", ended: false }
            : {
                status: "signed-in",
                account: session.account,
                onboarding: session.onboarding,
              },
        );
      },
      () => {
        if (live) setState({ status: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [client, run]);

  useEffect(
    () =>
      client.onSignedOut(() => setState({ status: "signed-out", ended: true })),
    [client],
  );

  const refresh = useCallback(() => setRun((value) => value + 1), []);

  const signOut = useCallback(async () => {
    await client.signOut();
    setState({ status: "signed-out", ended: false });
  }, [client]);

  if (state.status === "loading") {
    return (
      <GateFrame>
        <TopBar title="Ownwords" large />
        <Loading label="Opening Ownwords." />
      </GateFrame>
    );
  }

  if (state.status === "failed") {
    return (
      <GateFrame>
        <TopBar title="Ownwords" large />
        <Failed
          message="Ownwords could not be reached. Check the connection, then try again."
          onRetry={() => {
            setState({ status: "loading" });
            refresh();
          }}
        />
      </GateFrame>
    );
  }

  if (state.status === "signed-out") {
    return (
      <GateFrame>
        <SignInScreen ended={state.ended} onSignedIn={refresh} />
      </GateFrame>
    );
  }

  if (!state.onboarding) {
    return (
      <GateFrame>
        <OnboardingScreen
          onDone={(onboarding) => setState({ ...state, onboarding })}
        />
      </GateFrame>
    );
  }

  return (
    <SessionContext.Provider
      value={{
        account: state.account,
        onboarding: state.onboarding,
        refresh,
        signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

/** The signed-in account. `null` outside the gate, as in a test rendering one screen. */
export function useSession(): SessionValue | null {
  return useContext(SessionContext);
}
