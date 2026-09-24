import { useEffect, useState } from "react";
import { Button, Card, Mascot, TextField, TopBar } from "../../design-system";
import { Note, Screen, Section } from "../layout";
import { useClient } from "../shell/ClientProvider";

/** What the sign-in handler reports back in `?error=` when Google sign-in does not finish. */
function googleFailure(code: string): string {
  if (code === "invitation_required") {
    return "That Google account has no invitation yet. Accept your invitation below, then continue with Google using the same address.";
  }
  if (code.includes("email") && code.includes("verif")) {
    return "Google has not verified that email address, so it cannot sign in.";
  }
  return "Signing in with Google did not finish. Nothing changed; try again.";
}

function writtenError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "That did not work. Nothing changed; try again.";
}

/**
 * Sign-in without passwords, and access by invitation. A passkey works once
 * the account exists; the first sign-in is always Google, with the email
 * address an invitation was issued to.
 */
export function SignInScreen({
  ended,
  onSignedIn,
}: {
  /** The session ended while the app was open, rather than never starting. */
  ended: boolean;
  onSignedIn: () => void;
}) {
  const client = useClient();
  // Google sends the browser back here with `?error=` when sign-in did not finish.
  const [error, setError] = useState<string | null>(() => {
    const failure = new URL(window.location.href).searchParams.get("error");
    return failure ? googleFailure(failure) : null;
  });
  const [busy, setBusy] = useState<"passkey" | "google" | "invitation" | null>(
    null,
  );
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [accepted, setAccepted] = useState<string | null>(null);

  // Once read, the error leaves the address, so a reload does not repeat it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("error")) return;
    url.searchParams.delete("error");
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const withPasskey = async () => {
    setBusy("passkey");
    setError(null);
    try {
      await client.signInWithPasskey();
      onSignedIn();
    } catch (cause) {
      setError(writtenError(cause));
      setBusy(null);
    }
  };

  const withGoogle = async () => {
    setBusy("google");
    setError(null);
    try {
      window.location.assign(await client.startGoogleSignIn());
    } catch (cause) {
      setError(writtenError(cause));
      setBusy(null);
    }
  };

  const acceptInvitation = async () => {
    setBusy("invitation");
    setError(null);
    try {
      await client.redeemInvitation(code, email);
      setAccepted(email.trim());
      setCode("");
    } catch (cause) {
      setError(writtenError(cause));
    }
    setBusy(null);
  };

  return (
    <>
      <TopBar title="Sign in" large />
      <Screen>
        <Card tone="soft" padding={20} style={{ textAlign: "center" }}>
          <Mascot size={64} style={{ margin: "0 auto 10px" }} />
          <p style={{ margin: 0, font: "var(--type-body)" }}>
            {ended
              ? "You have been signed out. Sign in again to carry on; nothing was lost."
              : "Ownwords keeps the words you actually use, in every language you speak. It is open by invitation."}
          </p>
        </Card>

        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "var(--state-failed-soft)",
              color: "var(--fg-1)",
              font: "var(--type-body)",
              fontSize: ".9375rem",
            }}
          >
            {error}
          </p>
        )}

        {accepted && (
          <p
            role="status"
            style={{
              margin: 0,
              padding: "10px 12px",
              borderRadius: "var(--radius-md)",
              background: "var(--state-confirmed-soft)",
              color: "var(--fg-1)",
              font: "var(--type-body)",
              fontSize: ".9375rem",
            }}
          >
            Invitation accepted for {accepted}. Now continue with Google, using
            that address. The invitation holds for fifteen minutes.
          </p>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          <Button
            size="lg"
            full
            icon="key-round"
            disabled={busy !== null}
            onClick={() => void withPasskey()}
          >
            Sign in with a passkey
          </Button>
          <Button
            size="lg"
            full
            variant={accepted ? "primary" : "secondary"}
            disabled={busy !== null}
            onClick={() => void withGoogle()}
          >
            Continue with Google
          </Button>
          <Note>
            A passkey signs in on a device that already has one. The first time,
            continue with Google, then add a passkey from the side panel.
          </Note>
        </div>

        <Section title="Accept an invitation">
          <form
            style={{ display: "grid", gap: 10 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (email.trim() && code.trim()) void acceptInvitation();
            }}
          >
            <TextField
              label="Email address"
              name="invitation-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={setEmail}
              hint="The address the invitation was sent to."
            />
            <TextField
              label="Invitation code"
              name="invitation-code"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={code}
              onChange={setCode}
            />
            <Button
              type="submit"
              variant="secondary"
              full
              disabled={busy !== null || !email.trim() || !code.trim()}
            >
              Accept invitation
            </Button>
          </form>
        </Section>
      </Screen>
    </>
  );
}
