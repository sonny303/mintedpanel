// E4.4 F4.4.4 — public secure SSN intake route. Reachable WITHOUT a session (a
// token link, no login) — rendered outside the app shell by __root. A SECURITY
// DEFINER RPC hash-validates the token and returns only the single authorized
// provider/org (never the SSN — this is write-only ingress). The value encrypts
// on submit into the server-only vault and is never echoed back (mask only).
// Used/expired/revoked/invalid are the intended terminal lockdown states.
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateSsnIntakeToken, submitSsnIntake } from "@/services/ssnVault";
import { formatFullSsn } from "@/lib/ssnMask";
import { fmtDateTime } from "@/lib/format";
import type { SsnIntakeTokenState } from "@/types";

export const Route = createFileRoute("/ssn-intake/$token")({
  component: SsnIntakePage,
});

const OPERATOR_CONTACT = "your Minted Panel contact";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1B4D3E] text-white">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <span className="text-[15px] font-semibold text-foreground">Minted Panel</span>
        </div>
        {children}
        <div className="mt-8 text-center text-[11px] text-muted-foreground">
          Powered by Minted Panel · Your information is encrypted and stored securely
        </div>
      </div>
    </div>
  );
}

function Lockdown({
  icon: Icon,
  title,
  message,
}: {
  icon: typeof Clock;
  title: string;
  message: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div className="text-[16px] font-semibold text-foreground">{title}</div>
        <p className="max-w-sm text-[13px] text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function lockdownFor(state: SsnIntakeTokenState, orgName?: string) {
  const org = orgName ? ` for ${orgName}` : "";
  if (state === "used") {
    return {
      icon: CheckCircle2,
      title: "This form is already completed",
      message: `Thanks — the information${org} has already been submitted. If you need to make a change, contact ${OPERATOR_CONTACT}.`,
    };
  }
  if (state === "expired") {
    return {
      icon: Clock,
      title: "This link has expired",
      message: `For security, these links expire after 72 hours. Contact ${OPERATOR_CONTACT} and we'll send you a new one.`,
    };
  }
  // revoked or invalid — never confirm which provider a bad token targets.
  return {
    icon: Clock,
    title: "This link is no longer valid",
    message: `This link can't be used. Contact ${OPERATOR_CONTACT} to request a new one.`,
  };
}

function SsnIntakePage() {
  const { token } = Route.useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ssn-intake-token", token],
    queryFn: () => validateSsnIntakeToken(token),
    retry: false,
    staleTime: 0,
  });

  const [digits, setDigits] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  const [done, setDone] = useState(false);
  const [overrideState, setOverrideState] = useState<SsnIntakeTokenState | null>(null);

  // Never leave the entered value lingering once the page unmounts.
  useEffect(() => () => setDigits(""), []);

  const complete = digits.length === 9;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!complete) {
      setShowError(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitSsnIntake(token, digits);
      if (res.ok) {
        setDigits("");
        setDone(true);
      } else {
        setOverrideState(res.state);
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <Shell>
        <div className="text-[13px] text-muted-foreground">Loading…</div>
      </Shell>
    );
  }

  if (isError || !data) {
    const l = lockdownFor("invalid");
    return (
      <Shell>
        <Lockdown icon={l.icon} title={l.title} message={l.message} />
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <Lockdown
          icon={CheckCircle2}
          title="Thank you — you're all set"
          message={`The information${data.orgName ? ` for ${data.orgName}` : ""} has been submitted securely. You can close this window.`}
        />
      </Shell>
    );
  }

  const effectiveState = overrideState ?? data.state;
  if (effectiveState !== "active") {
    const l = lockdownFor(effectiveState, data.orgName);
    return (
      <Shell>
        <Lockdown icon={l.icon} title={l.title} message={l.message} />
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <CardContent className="p-6">
          <h1 className="text-[18px] font-semibold text-foreground">
            Enter Social Security Number
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {data.orgName ? `${data.orgName} · ` : ""}
            {data.providerName ? `For ${data.providerName}. ` : ""}
            This secure link is for you only — no account or password is created. Your SSN is
            encrypted immediately and is never shown back to you.
          </p>
          {data.expiresAt ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Expires {fmtDateTime(data.expiresAt)}.
            </p>
          ) : null}

          <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4" aria-label="Enter SSN">
            <div className="space-y-1.5">
              <Label htmlFor="ssn-intake-value">Social Security Number</Label>
              <Input
                id="ssn-intake-value"
                value={formatFullSsn(digits)}
                onChange={(e) => setDigits(e.target.value.replace(/\D/g, "").slice(0, 9))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="123-45-6789"
                className="font-mono tracking-widest"
                aria-describedby="ssn-intake-help"
                aria-invalid={showError && !complete}
                autoFocus
              />
              <p id="ssn-intake-help" className="text-[12px] text-muted-foreground">
                Enter all nine digits.
              </p>
              {showError && !complete ? (
                <p role="alert" className="text-[12px] text-[#B91C1C]">
                  Enter all nine digits of the SSN.
                </p>
              ) : null}
            </div>
            {submitError ? (
              <div
                role="alert"
                className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]"
              >
                {submitError}
              </div>
            ) : null}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            >
              {submitting ? "Submitting…" : "Submit securely"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}
