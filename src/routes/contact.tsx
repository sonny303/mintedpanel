// Public "contact us" route (redesign E0.5 / F0.5.5 / TE-7). No token, no session
// — a stranger submits interest and it becomes a triaged lead (never a live org).
// Rendered outside the app shell by __root. Baseline anti-abuse: required fields
// + a hidden honeypot field (a bot fills it; a human never sees it).
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitInboundLead } from "@/services/inboundLeads";
import { isValidEmail } from "@/lib/contactValidation";
import type { InboundLeadInput } from "@/types";
import logoAsset from "@/assets/minted-mark.png.asset.json";
import "./landing.css";

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
      <Label className="mp-contact-label" htmlFor={id}>
        {label}
      </Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className="mp-contact-input"
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
    <div className="mp-site mp-contact-page">
      <header className="mp-contact-header">
        <div className="mp-container mp-contact-header-inner">
          <Link className="mp-brand" to="/" aria-label="Minted Panel home">
            <span className="mp-brand-mark">
              <img src={logoAsset.url} alt="" />
            </span>
            <span>
              minted<span className="mp-brand-panel">panel</span>
            </span>
          </Link>
          <Link to="/" className="mp-contact-back">
            <ArrowLeft size={16} /> Back to site
          </Link>
        </div>
      </header>
      <main className="mp-container mp-contact-grid">
        <section className="mp-contact-intro" aria-labelledby="mp-contact-title">
          <div className="mp-eyebrow">
            <span className="mp-eyebrow-dot" /> Let's talk
          </div>
          <h1 id="mp-contact-title">Tell us where credentialing needs support.</h1>
          <p>
            Share a few details about your organization. We’ll follow up to learn about your
            provider and payer workload and where our team can help.
          </p>
          <div className="mp-contact-topics">
            <div>
              <span>01</span> Your provider and payer workload
            </div>
            <div>
              <span>02</span> Where applications and follow-ups need support
            </div>
            <div>
              <span>03</span> How you want to stay informed
            </div>
          </div>
        </section>
        <section className="mp-contact-panel" aria-label="Contact form">
          {done ? (
            <div className="mp-contact-success" role="status">
              <span>
                <CheckCircle2 size={25} />
              </span>
              <h2>Thanks for reaching out.</h2>
              <p>We received your details. Our team will review your inquiry and follow up.</p>
              <Link to="/" className="mp-text-link">
                Back to Minted Panel <ArrowRight size={17} />
              </Link>
            </div>
          ) : (
            <>
              <div className="mp-contact-form-heading">
                <div className="mp-eyebrow">Get in touch</div>
                <h2>Tell us about your organization.</h2>
                <p>We’ll reach out to discuss the credentialing support you need.</p>
              </div>
              <form onSubmit={onSubmit} noValidate className="mp-contact-form">
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
                <div className="mp-contact-form-row">
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

                <button
                  type="submit"
                  disabled={submitting}
                  className="mp-button mp-button-dark mp-contact-submit"
                >
                  {submitting ? "Sending…" : "Send details"}
                  {!submitting && <ArrowRight size={17} />}
                </button>
                <p className="mp-contact-privacy">
                  See how we handle information in our <Link to="/privacy">privacy policy</Link>.
                </p>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
