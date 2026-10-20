// 2026-10-20 — Provider self-onboarding sign-in. ANON. Rendered outside the
// app shell (see src/routes/__root.tsx and src/routes/ssn-intake.$token.tsx
// for the same pattern).
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OnboardingShell } from "@/components/onboarding/Shell";
import { Lockdown, lockdownFor, type LockdownState } from "@/components/onboarding/Lockdown";
import { useRequestIntakeCode, useValidateProviderIntakeToken } from "@/hooks/useIntake";

export const Route = createFileRoute("/onboarding/$token")({
  component: OnboardingSignInPage,
});

function OnboardingSignInPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const validationQ = useValidateProviderIntakeToken(token);
  const requestCode = useRequestIntakeCode();

  const [email, setEmail] = useState("");

  useEffect(() => {
    if (validationQ.data?.recipient_email) setEmail(validationQ.data.recipient_email);
  }, [validationQ.data?.recipient_email]);

  const state = (validationQ.data?.state ?? "invalid") as LockdownState;
  const isLocked = state !== "active";

  async function onSendCode() {
    if (!email.trim()) return;
    try {
      await requestCode.mutateAsync(token);
      toast.success("A 6-digit code is on its way to your inbox.");
      navigate({ to: "/onboarding/code", search: { token } });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (validationQ.isLoading) {
    return (
      <OnboardingShell>
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
      </OnboardingShell>
    );
  }

  if (isLocked) {
    const view = lockdownFor(state, validationQ.data?.org_name);
    return (
      <OnboardingShell>
        <Lockdown {...view} />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell>
      <Card>
        <CardContent className="space-y-4 p-8">
          <div className="space-y-1.5">
            <h1 className="text-[18px] font-semibold">
              Welcome to {validationQ.data?.org_name}
            </h1>
            <p className="text-[13px] text-muted-foreground">
              Complete your provider profile to finish setting up your credentialing with
              {" "}{validationQ.data?.org_name}. We'll send a 6-digit code to the email
              on file — no password needed.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled
            />
            <p className="text-[11px] text-muted-foreground">
              This is the address on file. Contact your Minted Panel contact if it's wrong.
            </p>
          </div>
          <Button
            onClick={onSendCode}
            disabled={!email.trim() || requestCode.isPending}
            className="w-full bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          >
            {requestCode.isPending ? "Sending…" : "Send me a code"}
          </Button>
        </CardContent>
      </Card>
    </OnboardingShell>
  );
}
