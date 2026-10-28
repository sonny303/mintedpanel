// Provider intake (slice 1, docs/provider-onboarding/slice-1-invite-to-form.md).
// Public and chromeless (listed in __root.tsx). The link token is the door; the
// emailed code is the key. The session that follows is an HttpOnly cookie, so
// nothing here stores a token. One route, the step in component state.
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CodeStep,
  ConsentStep,
  DetailsStep,
  IdentifyStep,
  IntakeShell,
  InvalidLink,
  TryAgain,
} from "@/components/intake/IntakeScreens";
import {
  useIntakeLink,
  useIntakeMe,
  useOpenIntakeSession,
  useRequestIntakeCode,
} from "@/hooks/useIntake";

export const Route = createFileRoute("/intake/$token")({
  head: () => ({
    meta: [
      { title: "Secure intake — Minted Panel" },
      // Keep the link token out of Referer headers on any outbound request.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: IntakePage,
});

type Step = "identify" | "code" | "consent" | "details";

function IntakePage() {
  const { token } = Route.useParams();
  const qc = useQueryClient();
  const link = useIntakeLink(token);
  const [step, setStep] = useState<Step>("identify");
  const [error, setError] = useState<string | null>(null);
  const requestCode = useRequestIntakeCode();
  const openSession = useOpenIntakeSession();
  const signedIn = step === "consent" || step === "details";
  const me = useIntakeMe(token, link.data != null);

  // A live session from earlier in this browser (2 hours) skips the code; a
  // session that ended (expired, or replaced by a resend) goes back to the start.
  useEffect(() => {
    // Only a definite "no session" sends her back; a failed read doesn't.
    if (!me.isSuccess) return;
    if (step === "identify" && me.data) setStep("consent");
    if (signedIn && me.data === null) setStep("identify");
  }, [me.isSuccess, me.data, step, signedIn]);

  if (link.isLoading) {
    return (
      <IntakeShell practiceName={null}>
        <div className="text-[13px] text-muted-foreground">Loading…</div>
      </IntakeShell>
    );
  }
  if (link.isError) return <TryAgain onRetry={() => void link.refetch()} />;
  if (!link.data) return <InvalidLink />;
  const { practiceName, email } = link.data;

  async function sendCode(): Promise<boolean> {
    setError(null);
    try {
      await requestCode.mutateAsync(token);
      setStep("code");
      return true;
    } catch {
      setError("We couldn't send a code just now. Please try again.");
      return false;
    }
  }

  async function checkCode(code: string) {
    setError(null);
    try {
      const ok = await openSession.mutateAsync({ token, code });
      if (!ok) {
        setError("That code didn't work. Use the newest code we sent, or send a new one.");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["intake-me", token] });
      setStep("consent");
    } catch {
      setError("Something went wrong. Please try again.");
    }
  }

  if (step === "identify") {
    return (
      <IntakeShell practiceName={practiceName}>
        <IdentifyStep
          email={email}
          sending={requestCode.isPending}
          error={error}
          onSend={() => void sendCode()}
        />
      </IntakeShell>
    );
  }

  if (step === "code") {
    return (
      <IntakeShell practiceName={practiceName}>
        <CodeStep
          email={email}
          checking={openSession.isPending}
          error={error}
          onSubmit={checkCode}
          onResend={sendCode}
        />
      </IntakeShell>
    );
  }

  // Signed in, but her details didn't load: offer a retry rather than an
  // endless spinner (a definite "no session" is handled by the effect above).
  if (me.isError) return <TryAgain onRetry={() => void me.refetch()} />;
  if (!me.data) {
    return (
      <IntakeShell practiceName={practiceName}>
        <div className="text-[13px] text-muted-foreground">Loading…</div>
      </IntakeShell>
    );
  }

  return (
    <IntakeShell practiceName={me.data.practiceName} signedInAs={me.data.email}>
      {step === "consent" ? (
        <ConsentStep practiceName={me.data.practiceName} onSign={() => setStep("details")} />
      ) : (
        <DetailsStep
          firstName={me.data.firstName}
          lastName={me.data.lastName}
          email={me.data.email}
        />
      )}
    </IntakeShell>
  );
}
