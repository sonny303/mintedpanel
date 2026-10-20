// 2026-10-20 — Provider self-onboarding code-entry page. ANON.
import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OnboardingShell } from "@/components/onboarding/Shell";
import { Lockdown, lockdownFor, type LockdownState } from "@/components/onboarding/Lockdown";
import { useValidateProviderIntakeToken, useVerifyIntakeCode } from "@/hooks/useIntake";

const SESSION_STORAGE_KEY = "mintedpanel.intake.session";

interface Search {
  token?: string;
}

export const Route = createFileRoute("/onboarding/code")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  component: OnboardingCodePage,
});

function OnboardingCodePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const validationQ = useValidateProviderIntakeToken(token);
  const verify = useVerifyIntakeCode();
  const [code, setCode] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Clear the entered code when the page unmounts.
  useEffect(() => () => setCode(""), []);

  const state = (validationQ.data?.state ?? "invalid") as LockdownState;
  const isLocked = state !== "active";

  async function onVerify() {
    if (!token) return;
    if (code.length !== 6) {
      setSubmitError("Enter the 6-digit code from your email.");
      return;
    }
    setSubmitError(null);
    try {
      const result = await verify.mutateAsync({ token, code });
      if (!result.ok || !result.session_token) {
        setSubmitError("That code didn't work. Try again or request a new one.");
        return;
      }
      // Store the session token locally for the profile form.
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, result.session_token);
      } catch {
        // sessionStorage unavailable — the form will fall back to passing the token in URL.
      }
      toast.success("Verified. Let's complete your profile.");
      navigate({ to: "/onboarding/form", search: { token, session: result.session_token } });
    } catch (err) {
      setSubmitError((err as Error).message);
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
            <h1 className="text-[18px] font-semibold">Enter your 6-digit code</h1>
            <p className="text-[13px] text-muted-foreground">
              We sent a 6-digit code to {validationQ.data?.recipient_email}. It expires in
              10 minutes. After 5 wrong attempts the link locks.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
              placeholder="123456"
            />
          </div>
          {submitError ? (
            <div role="alert" className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]">
              {submitError}
            </div>
          ) : null}
          <Button
            onClick={onVerify}
            disabled={code.length !== 6 || verify.isPending || !token}
            className="w-full bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          >
            {verify.isPending ? "Verifying…" : "Verify code"}
          </Button>
          <button
            type="button"
            onClick={() => navigate({ to: "/onboarding/$token", params: { token: token ?? "" } })}
            className="text-[12px] text-muted-foreground underline"
          >
            Didn't get a code? Try again
          </button>
        </CardContent>
      </Card>
    </OnboardingShell>
  );
}
