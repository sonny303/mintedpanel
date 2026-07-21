// Public "contact us" route (redesign E0.5 / F0.5.5 / TE-7). No token, no session
// — a stranger submits interest and it becomes a triaged lead (never a live org).
// Rendered outside the app shell by __root. Baseline anti-abuse: required fields
// + a hidden honeypot field (a bot fills it; a human never sees it).
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitInboundLead } from "@/services/inboundLeads";
import { isValidEmail } from "@/lib/contactValidation";
import type { InboundLeadInput } from "@/types";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
});

const EMPTY: InboundLeadInput = {
  orgName: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  companyWebsite: "",
};

interface LeadErrors {
  orgName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}

function leadErrors(v: InboundLeadInput): LeadErrors {
  const e: LeadErrors = {};
  if (!v.orgName.trim()) e.orgName = "Organization name is required";
  if (!v.contactName.trim()) e.contactName = "Your name is required";
  if (!v.contactEmail.trim()) e.contactEmail = "Email is required";
  else if (!isValidEmail(v.contactEmail)) e.contactEmail = "Enter a valid email address";
  if (!v.contactPhone.trim()) e.contactPhone = "Phone is required";
  return e;
}

const errClass = "mt-1 text-[12px] text-[#B91C1C]";

function Field({
  id,
  label,
  value,
  onChange,
  error,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
}) {
  const errId = `${id}-error`;
  return (
    <div>
      <Label className="text-[12px]" htmlFor={id}>
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className="h-9"
      />
      {error ? (
        <div id={errId} aria-live="polite" className={errClass}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

function ContactPage() {
  const [form, setForm] = useState<InboundLeadInput>(EMPTY);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const errors = useMemo(() => (showErrors ? leadErrors(form) : {}), [showErrors, form]);
  const set = (patch: Partial<InboundLeadInput>) => setForm((f) => ({ ...f, ...patch }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (Object.keys(leadErrors(form)).length > 0) {
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    try {
      await submitInboundLead(form);
      setDone(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1B4D3E] text-white">
            <Mail className="h-4 w-4" />
          </div>
          <span className="text-[15px] font-semibold text-foreground">Minted Panel</span>
        </div>

        {done ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="text-[16px] font-semibold text-foreground">
                Thanks for reaching out
              </div>
              <p className="max-w-sm text-[13px] text-muted-foreground">
                We received your details and someone from our team will be in touch shortly.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-6">
              <h1 className="text-[18px] font-semibold text-foreground">Get in touch</h1>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Tell us about your organization and we'll reach out about getting your providers
                credentialed.
              </p>

              <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
                {/* Honeypot: visually hidden, off the tab order. Bots fill it; the
                    server drops any submission that carries a value. */}
                <div aria-hidden="true" className="hidden">
                  <label htmlFor="company_website">Company website</label>
                  <input
                    id="company_website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={form.companyWebsite ?? ""}
                    onChange={(e) => set({ companyWebsite: e.target.value })}
                  />
                </div>

                <Field
                  id="lead-org"
                  label="Organization name"
                  value={form.orgName}
                  onChange={(v) => set({ orgName: v })}
                  error={errors.orgName}
                />
                <Field
                  id="lead-name"
                  label="Your name"
                  value={form.contactName}
                  onChange={(v) => set({ contactName: v })}
                  error={errors.contactName}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    id="lead-email"
                    label="Email"
                    type="email"
                    value={form.contactEmail}
                    onChange={(v) => set({ contactEmail: v })}
                    error={errors.contactEmail}
                  />
                  <Field
                    id="lead-phone"
                    label="Phone"
                    value={form.contactPhone}
                    onChange={(v) => set({ contactPhone: v })}
                    error={errors.contactPhone}
                  />
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
                  {submitting ? "Sending…" : "Send"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
