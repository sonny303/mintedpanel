// Public one-time data capture route (redesign E0.5, TE-3). Reachable WITHOUT a
// session (BD-1: token link, no login) — rendered outside the app shell by
// __root. A SECURITY DEFINER RPC hash-validates the token and returns only the
// single authorized party/org. Used/expired/revoked/invalid are the intended
// terminal lockdown states (F0.5.2), each with an operator-contact fallback.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ContactFields } from "@/components/org/ContactFields";
import { validateCaptureToken, submitCapture } from "@/services/captureLinks";
import { EMPTY_CONTACT } from "@/lib/contacts";
import { contactErrors, hasContactErrors } from "@/lib/contactValidation";
import { fmtDateTime } from "@/lib/format";
import type { CaptureTokenState, ContactInput } from "@/types";

export const Route = createFileRoute("/capture/$token")({
  component: CapturePage,
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

function lockdownFor(state: CaptureTokenState, orgName?: string) {
  const org = orgName ? ` for ${orgName}` : "";
  if (state === "used") {
    return {
      icon: CheckCircle2,
      title: "This form is already completed",
      message: `Thanks — the details${org} have already been submitted. If you need to make a change, contact ${OPERATOR_CONTACT}.`,
    };
  }
  if (state === "expired") {
    return {
      icon: Clock,
      title: "This link has expired",
      message: `For security, capture links expire after 72 hours. Contact ${OPERATOR_CONTACT} and we'll send you a new one.`,
    };
  }
  // revoked or invalid — never confirm which org a bad token targets.
  return {
    icon: Clock,
    title: "This link is no longer valid",
    message: `This link can't be used. Contact ${OPERATOR_CONTACT} to request a new one.`,
  };
}

function CapturePage() {
  const { token } = Route.useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["capture-token", token],
    queryFn: () => validateCaptureToken(token),
    retry: false,
    staleTime: 0,
  });

  const [form, setForm] = useState<ContactInput>(EMPTY_CONTACT);
  const [seeded, setSeeded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [done, setDone] = useState(false);
  // A submit can reveal the link was used/expired concurrently — override state.
  const [overrideState, setOverrideState] = useState<CaptureTokenState | null>(null);

  useEffect(() => {
    if (data?.state === "active" && data.current && !seeded) {
      setForm({ ...EMPTY_CONTACT, ...data.current });
      setSeeded(true);
    }
  }, [data, seeded]);

  const errors = useMemo(() => (showErrors ? contactErrors(form) : {}), [showErrors, form]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const found = contactErrors(form);
    if (hasContactErrors(found)) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitCapture(token, form);
      if (res.ok) {
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
          message={`Your details${data.orgName ? ` for ${data.orgName}` : ""} have been submitted. You can close this window.`}
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
          <h1 className="text-[18px] font-semibold text-foreground">Confirm your details</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {data.orgName ? `${data.orgName} · ` : ""}
            Please review and complete every field, then submit. This secure link is for you only —
            no account or password is created.
          </p>
          {data.expiresAt ? (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Expires {fmtDateTime(data.expiresAt)}.
            </p>
          ) : null}

          <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
            <ContactFields
              value={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              errors={errors}
              idPrefix="capture"
            />
            {submitError ? (
              <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]">
                {submitError}
              </div>
            ) : null}
            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#1B4D3E] text-white hover:bg-[#163E32]"
            >
              {submitting ? "Submitting…" : "Submit details"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Shell>
  );
}
