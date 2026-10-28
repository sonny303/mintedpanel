// Provider intake screens (canvas boards 3, 4, 4b, 5, 5a). Presentational:
// the route owns the step and every call. Practice name first, Minted as the
// operator ("Secure intake by Minted Panel"), phone width first.
import { useEffect, useState, type ReactNode } from "react";
import { Clock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { consentParagraphs } from "@/lib/intakeConsent";
import { fmtDate } from "@/lib/format";
import { localTodayIso } from "@/hooks/useEnrollmentReadiness";

export function IntakeShell({
  practiceName,
  signedInAs,
  children,
}: {
  practiceName: string | null;
  signedInAs?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#1B4D3E] text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0">
            {practiceName ? (
              <div className="truncate text-[15px] font-semibold text-foreground">
                {practiceName}
              </div>
            ) : null}
            <div className="text-[12px] text-muted-foreground">Secure intake by Minted Panel</div>
          </div>
        </div>
        {signedInAs ? (
          <div className="mb-3 text-right text-[12px] text-muted-foreground">
            Signed in as {signedInAs}
          </div>
        ) : null}
        <Card>
          <CardContent className="space-y-4 p-6">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <h1 className="text-[20px] font-semibold text-foreground">{children}</h1>;
}

function Body({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-muted-foreground">{children}</p>;
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-[13px] text-destructive">
      {message}
    </p>
  );
}

// Board 4b State B. One screen for unknown, expired and revoked links.
export function InvalidLink() {
  return (
    <IntakeShell practiceName={null}>
      <Clock className="h-6 w-6 text-muted-foreground" aria-hidden />
      <Heading>This invitation is no longer valid</Heading>
      <Body>
        It may have expired or been replaced. Ask your practice administrator for a new one.
      </Body>
    </IntakeShell>
  );
}

// A server or network failure, kept apart from an invalid link so a provider
// with a good link isn't told it's dead.
export function TryAgain({ onRetry }: { onRetry: () => void }) {
  return (
    <IntakeShell practiceName={null}>
      <Heading>Something went wrong</Heading>
      <Body>We couldn't open your form just now. Please try again in a moment.</Body>
      <Button className="h-10 w-full" onClick={onRetry}>
        Try again
      </Button>
    </IntakeShell>
  );
}

// Board 3. The code always goes to the invited address (slice 1, S6).
export function IdentifyStep({
  email,
  sending,
  error,
  onSend,
}: {
  email: string;
  sending: boolean;
  error: string | null;
  onSend: () => void;
}) {
  return (
    <>
      <Heading>Confirm it's you</Heading>
      <Body>
        Your practice administrator invited you. We'll send a 6-digit code to{" "}
        <strong className="text-foreground">{email}</strong> to open your form.
      </Body>
      <ErrorLine message={error} />
      <Button className="h-10 w-full" onClick={onSend} disabled={sending}>
        {sending ? "Sending…" : "Send me a code"}
      </Button>
      <p className="text-[12px] text-muted-foreground">
        Have your NPI, license, CAQH ID, and your CAQH and PECOS logins handy. If this isn't your
        email address, ask your practice administrator to invite you again.
      </p>
    </>
  );
}

const RESEND_AFTER_SECONDS = 60;

// Board 4. One real input; it continues on its own once six digits are in.
export function CodeStep({
  email,
  checking,
  error,
  onSubmit,
  onResend,
}: {
  email: string;
  checking: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
  onResend: () => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(RESEND_AFTER_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  function change(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) onSubmit(digits);
  }

  return (
    <>
      <Heading>Enter your code</Heading>
      <Body>
        We sent a 6-digit code to <strong className="text-foreground">{email}</strong>. It expires
        in 10 minutes.
      </Body>
      <div className="space-y-1.5">
        <Label htmlFor="intake-code">Code</Label>
        <Input
          id="intake-code"
          value={code}
          onChange={(e) => change(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="6-digit code"
          maxLength={6}
          disabled={checking}
          className="h-12 text-center font-mono text-[22px] tracking-[0.5em]"
          autoFocus
        />
      </div>
      <ErrorLine message={error} />
      <p className="text-[13px] text-muted-foreground">
        {checking ? "Checking…" : "Continues automatically when all six digits are in."}
      </p>
      <p className="text-[13px] text-muted-foreground">
        Didn't get it? Check spam, or{" "}
        {wait > 0 ? (
          <span>resend in 0:{String(wait).padStart(2, "0")}</span>
        ) : (
          <button
            type="button"
            className="font-medium text-foreground underline"
            onClick={async () => {
              setCode("");
              if (await onResend()) setWait(RESEND_AFTER_SECONDS);
            }}
          >
            send a new code
          </button>
        )}
        .
      </p>
      <p className="text-[12px] text-muted-foreground">
        You can ask for up to 3 codes every 10 minutes. Use the newest one.
      </p>
    </>
  );
}

// Board 5. The signature is not saved yet in slice 1 (r1-ui-spec Q2).
export function ConsentStep({
  practiceName,
  onSign,
}: {
  practiceName: string;
  onSign: (typedName: string) => void;
}) {
  const [name, setName] = useState("");
  const signed = name.trim().length > 1;
  return (
    <>
      <Heading>Your consent</Heading>
      <Body>Please read and sign before you start your details.</Body>
      <div className="space-y-3 text-[13px] leading-relaxed text-foreground">
        {consentParagraphs(practiceName).map((p) => (
          <p key={p.slice(0, 24)}>{p}</p>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="consent-name">Type your full name to sign *</Label>
        <Input
          id="consent-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
      </div>
      <div className="text-[13px] text-muted-foreground">Date: {fmtDate(localTodayIso())}</div>
      <Button className="h-10 w-full" disabled={!signed} onClick={() => onSign(name.trim())}>
        Sign and continue
      </Button>
    </>
  );
}

function ReadOnlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[12px] font-medium text-muted-foreground">{label} *</div>
      <Input value={value ?? ""} readOnly disabled placeholder="—" />
    </div>
  );
}

// Board 5a, read-only in slice 1: saving arrives in the next build.
export function DetailsStep({
  firstName,
  lastName,
  email,
}: {
  firstName: string;
  lastName: string;
  email: string;
}) {
  return (
    <>
      <Heading>Your credentialing details</Heading>
      <p className="rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
        Staging preview: saving arrives in the next build.
      </p>
      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold">Identity</h2>
        <ReadOnlyField label="First name" value={firstName} />
        <ReadOnlyField label="Last name" value={lastName} />
        <ReadOnlyField label="NPI" />
        <ReadOnlyField label="Specialty" />
        <ReadOnlyField label="Date of birth" />
        <ReadOnlyField label="CAQH ID" />
        <ReadOnlyField label="Social Security number" />
      </section>
      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold">Contact</h2>
        <ReadOnlyField label="Email" value={email} />
        <ReadOnlyField label="Mobile phone" />
        <ReadOnlyField label="Home address" />
      </section>
      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold">State licenses</h2>
        <ReadOnlyField label="State" />
        <ReadOnlyField label="License number" />
        <ReadOnlyField label="Expires" />
      </section>
      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold">Logins</h2>
        <ReadOnlyField label="CAQH ProView username" />
        <ReadOnlyField label="PECOS user ID" />
      </section>
      <div className="flex gap-2">
        <Button variant="outline" className="h-10 flex-1" disabled>
          Save, finish later
        </Button>
        <Button className="h-10 flex-1" disabled>
          Continue
        </Button>
      </div>
    </>
  );
}
