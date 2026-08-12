// The per-step detail bodies for a case's SOP tasks, extracted from the
// retired CaseWizard (2026-07-20 handoff: the step-at-a-time Wizard tab was
// removed from case detail — the List view is the only checklist). The step
// CONTENT was the valuable part and lives on here, rendered inside the
// TaskDrawer: online_form (portal link + resolved data fields with copy),
// draft_email (resolved subject/body/To/CC with unresolved-{{token}}
// highlighting and the human-in-loop Gmail hand-off — F1.7b.5, never
// auto-sent), pdf (upload a fillable AcroForm -> field_dictionary mapping ->
// fill from the case's provider data -> local download), and the E1.7b plain
// channels (fax/phone/mail/custom). StepBody renders one step's body by stepType —
// label/checkbox chrome belongs to the caller (the drawer's rows).
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Download, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PortalStepLink } from "@/components/portals/PortalStepLink";
import { planGmailHandoff } from "@/lib/gmailCompose";
import { splitOnUnresolvedTokens, findUnresolvedTokens } from "@/lib/caseWizard";
import { pdfFillFileStem } from "@/lib/pdfFill";
import { analyzePdfForm, fillAndDownloadPdf, type PdfAnalysis } from "@/lib/pdfFillClient";
import { useFieldDictionary } from "@/hooks/useMappingReview";
import type { ResolvedSOPEmailRecipient, SOPStep } from "@/types";

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Could not copy to clipboard");
  }
}

// Gmail compose hand-off (P9): open a prefilled Gmail draft; the human sends.
// Never auto-sends. Recipients (E1.7b TE-17) prefill To/CC; the over-long-body
// fallback keeps recipients + subject and copies only the body to the clipboard.
async function openInGmail(subject: string, body: string, to: string[], cc: string[]) {
  const { url, bodyToClipboard } = planGmailHandoff(subject, body, to, cc);
  if (bodyToClipboard) {
    try {
      await navigator.clipboard.writeText(body);
      toast.message("Email body copied — paste it into the Gmail draft", {
        description: "The body was too long for the compose link.",
      });
    } catch {
      toast.error("Could not copy the email body");
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function CopyInlineButton({ text, what }: { text: string; what: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 px-2 text-[12px] shadow-none"
      onClick={() => copyText(text, what)}
    >
      <Copy className="h-3.5 w-3.5" />
      Copy
    </Button>
  );
}

// Resolved text with any remaining {{token}} placeholders highlighted amber.
function HighlightedText({ text }: { text: string }) {
  const segments = useMemo(() => splitOnUnresolvedTokens(text), [text]);
  return (
    <>
      {segments.map((seg, i) =>
        seg.isToken ? (
          <span
            key={i}
            className="rounded-sm bg-[#FEF3C7] px-1 font-medium text-[#92400E]"
            title="Missing data — fill this in before sending"
          >
            {seg.value}
          </span>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}

function OnlineFormStep({ step }: { step: SOPStep }) {
  const fields = step.dataFields ?? [];
  return (
    <div className="space-y-3">
      {step.portalKey ? <PortalStepLink portalKey={step.portalKey} /> : null}
      {step.detail ? <p className="text-[13px] text-muted-foreground">{step.detail}</p> : null}
      <StepCadenceMeta step={step} />
      {fields.length > 0 ? (
        <dl className="rounded-md border border-[#E8E5E0] divide-y divide-[#E8E5E0]">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-2.5">
              <dt className="text-[12px] text-muted-foreground">{f.label}</dt>
              <dd className="flex items-center gap-2">
                <span className="text-[13px] font-medium tabular-nums">{f.value}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] shadow-none"
                  onClick={() => copyText(f.value, f.label)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Complete this step in the portal, then mark it done below.
        </p>
      )}
    </div>
  );
}

// Resolved address of a recipient, or null when a token recipient is unresolved
// (a provider with no email) — an explicit fill-before-send gap, never a blank.
// A literal always carries an address; a token's may be null.
function recipientAddress(r: ResolvedSOPEmailRecipient): string | null {
  return r.address;
}

// One resolved recipient chip. Shows the address AND where it came from
// ("Email address" for a literal, the {{token}} for a token). An unresolved
// token renders amber "fill before sending" — the same gap treatment as an
// unresolved {{token}} in the body; it is shown, never silently dropped.
function RecipientChip({ r }: { r: ResolvedSOPEmailRecipient }) {
  if (r.source === "literal") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E8E5E0] bg-muted/40 px-2 py-0.5 text-[12px]">
        <span className="font-medium">{r.address}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Email address
        </span>
      </span>
    );
  }
  if (r.address) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E8E5E0] bg-muted/40 px-2 py-0.5 text-[12px]">
        <span className="font-medium">{r.address}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{`{{${r.token}}}`}</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[#FDE68A] bg-[#FEF3C7] px-2 py-0.5 text-[12px] text-[#92400E]"
      title="Missing data — fill this recipient in before sending"
    >
      <span className="font-mono">{`{{${r.token}}}`}</span>
      <span className="text-[10px] uppercase tracking-wide">fill before sending</span>
    </span>
  );
}

function RecipientRow({
  label,
  recipients,
}: {
  label: string;
  recipients: ResolvedSOPEmailRecipient[];
}) {
  const addrs = recipients.map(recipientAddress).filter((a): a is string => Boolean(a));
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[#E8E5E0] px-3 py-2">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 flex flex-wrap gap-1.5">
          {recipients.map((r, i) => (
            <RecipientChip key={i} r={r} />
          ))}
        </div>
      </div>
      {addrs.length > 0 ? <CopyInlineButton text={addrs.join(", ")} what={label} /> : null}
    </div>
  );
}

function DraftEmailStep({ step }: { step: SOPStep }) {
  const subject = step.emailTemplate?.subject ?? "";
  const body = step.emailTemplate?.body ?? "";
  const to = useMemo(() => step.emailTemplate?.to ?? [], [step.emailTemplate?.to]);
  const cc = useMemo(() => step.emailTemplate?.cc ?? [], [step.emailTemplate?.cc]);
  const unresolved = useMemo(() => findUnresolvedTokens(`${subject}\n${body}`), [subject, body]);
  // Resolved addresses for the Gmail hand-off. Unresolved token recipients drop
  // out here (can't prefill an unknown address) but stay visible as a
  // fill-before-send gap in the chips above — never silently sent.
  const toAddrs = useMemo(
    () => to.map(recipientAddress).filter((a): a is string => Boolean(a)),
    [to],
  );
  const ccAddrs = useMemo(
    () => cc.map(recipientAddress).filter((a): a is string => Boolean(a)),
    [cc],
  );
  const unresolvedRecipients = useMemo(
    () => [...to, ...cc].filter((r) => r.source === "token" && r.address === null).length,
    [to, cc],
  );

  if (!step.emailTemplate) {
    return <p className="text-[13px] text-muted-foreground">No email template on this step.</p>;
  }

  return (
    <div className="space-y-3">
      {unresolved.length > 0 || unresolvedRecipients > 0 ? (
        <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3 text-[12px] text-[#92400E]">
          {unresolved.length > 0 ? (
            <div>
              Missing data — fill these in before sending:{" "}
              <span className="font-medium">{unresolved.map((t) => `{{${t}}}`).join(", ")}</span>
            </div>
          ) : null}
          {unresolvedRecipients > 0 ? (
            <div>
              A recipient could not be resolved (no provider email) — fill it in before sending.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-md border border-[#E8E5E0]">
        {to.length > 0 ? <RecipientRow label="To" recipients={to} /> : null}
        {cc.length > 0 ? <RecipientRow label="Cc" recipients={cc} /> : null}
        <div className="flex items-center justify-between gap-3 border-b border-[#E8E5E0] px-3 py-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Subject</div>
            <div className="truncate text-[13px] font-medium text-foreground">
              <HighlightedText text={subject} />
            </div>
          </div>
          {subject ? <CopyInlineButton text={subject} what="Subject" /> : null}
        </div>
        <div className="px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Body</div>
            {body ? <CopyInlineButton text={body} what="Email body" /> : null}
          </div>
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
            <HighlightedText text={body} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          className="h-8 gap-1.5 bg-[#1B4D3E] px-3 text-[13px] hover:bg-[#163f33]"
          onClick={() => openInGmail(subject, body, toAddrs, ccAddrs)}
        >
          <Mail className="h-3.5 w-3.5" />
          Open in Gmail
        </Button>
        <span className="text-[12px] text-muted-foreground">
          Opens a prefilled draft — review and send it yourself.
        </span>
      </div>
    </div>
  );
}

// Upload a fillable PDF, map its field names to catalog tokens via the org's
// confirmed field_dictionary (the SAME memory the portal mapper trains), fill
// from this case's provider data, and download locally. pdf-lib is loaded lazily
// (client-only) by the pdfFillClient helpers. Nothing is ever submitted.
function PdfStep({ step, tokenValues }: { step: SOPStep; tokenValues: Record<string, string> }) {
  const dictQ = useFieldDictionary();
  const dictionary = useMemo(() => dictQ.data ?? [], [dictQ.data]);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<PdfAnalysis | null>(null);
  const [busy, setBusy] = useState<"analyze" | "generate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-analyze whenever the file, the loaded dictionary, or the token values
  // change — this also covers the dictionary loading AFTER the file was picked.
  useEffect(() => {
    if (!file) {
      setAnalysis(null);
      return;
    }
    let cancelled = false;
    setBusy("analyze");
    setError(null);
    analyzePdfForm(file, dictionary, tokenValues)
      .then((result) => {
        if (!cancelled) setAnalysis(result);
      })
      .catch(() => {
        if (cancelled) return;
        setAnalysis(null);
        setError("Could not read this file as a fillable PDF form.");
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [file, dictionary, tokenValues]);

  const willFill = analysis?.fill ?? [];
  const wontFill = analysis?.unfilled ?? [];
  const noFields = analysis != null && analysis.fieldNames.length === 0;

  const handleGenerate = async () => {
    if (!file) return;
    setBusy("generate");
    try {
      const result = await fillAndDownloadPdf(
        file,
        dictionary,
        tokenValues,
        pdfFillFileStem(step.label),
      );
      setAnalysis(result);
      toast.success("Filled PDF downloaded");
    } catch {
      toast.error("Could not generate the filled PDF");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-muted-foreground">
        Upload the payer&apos;s fillable PDF. Fields are matched to your saved form dictionary and
        filled from this provider&apos;s data — review and submit it yourself.
      </p>

      <Input
        type="file"
        accept="application/pdf,.pdf"
        className="text-[13px]"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />

      {busy === "analyze" ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading form fields…
        </p>
      ) : null}

      {error ? (
        <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] p-3 text-[12px] text-[#B91C1C]">
          {error}
        </div>
      ) : null}

      {analysis && !error ? (
        noFields ? (
          <div className="rounded-md border border-[#E8E5E0] bg-muted/30 p-3 text-[12px] text-muted-foreground">
            This PDF has no fillable form fields — complete it manually.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[12px] text-muted-foreground">
              {analysis.fieldNames.length} form{" "}
              {analysis.fieldNames.length === 1 ? "field" : "fields"} · {willFill.length} will fill
              · {wontFill.length} left blank
            </div>

            {willFill.length > 0 ? (
              <div className="rounded-md border border-[#E8E5E0] p-3 text-[12px]">
                <div className="mb-1 flex items-center gap-1.5 font-medium text-[#1B4D3E]">
                  <Check className="h-3.5 w-3.5" /> Will fill
                </div>
                <div className="text-foreground">{willFill.map((p) => p.field).join(", ")}</div>
              </div>
            ) : null}

            {wontFill.length > 0 ? (
              <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3 text-[12px] text-[#92400E]">
                <div className="font-medium">Won&apos;t fill — complete these by hand:</div>
                <div className="mt-1">{wontFill.map((f) => f.field).join(", ")}</div>
              </div>
            ) : null}
          </div>
        )
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          className="h-8 gap-1.5 bg-[#1B4D3E] px-3 text-[13px] hover:bg-[#163f33]"
          disabled={!file || busy !== null || willFill.length === 0}
          onClick={handleGenerate}
        >
          {busy === "generate" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Generate PDF
        </Button>
        <span className="text-[12px] text-muted-foreground">
          Downloads locally — nothing is submitted.
        </span>
      </div>
    </div>
  );
}

// E1.7b: fax/phone/mail/custom steps render as plain instructions — label/detail,
// data fields, and the turnaround/cadence/artifact metadata; deliberately no
// portal affordances (those belong to online_form steps only).
function PlainChannelStep({ step }: { step: SOPStep }) {
  const fields = step.dataFields ?? [];
  return (
    <div className="space-y-3">
      {step.detail ? <p className="text-[13px] text-muted-foreground">{step.detail}</p> : null}
      <StepCadenceMeta step={step} />
      {fields.length > 0 ? (
        <dl className="rounded-md border border-[#E8E5E0] divide-y divide-[#E8E5E0]">
          {fields.map((f, i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-2.5">
              <dt className="text-[12px] text-muted-foreground">{f.label}</dt>
              <dd className="text-[13px] font-medium tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function StepCadenceMeta({ step }: { step: SOPStep }) {
  const parts: string[] = [];
  if (typeof step.expectedTurnaroundDays === "number") {
    parts.push(`Expected turnaround ~${step.expectedTurnaroundDays} days`);
  }
  if (typeof step.followUpEveryDays === "number") {
    parts.push(`follow up every ${step.followUpEveryDays} days`);
  }
  const artifacts = step.requiredArtifacts ?? [];
  if (parts.length === 0 && artifacts.length === 0) return null;
  return (
    <div className="space-y-1 text-[12px] text-muted-foreground">
      {parts.length > 0 ? <p>{parts.join(" · ")}</p> : null}
      {artifacts.length > 0 ? <p>Artifacts to save: {artifacts.join(", ")}</p> : null}
    </div>
  );
}

export function StepBody({
  step,
  tokenValues = {},
}: {
  step: SOPStep;
  tokenValues?: Record<string, string>;
}) {
  const stepType = step.stepType ?? "online_form";
  if (stepType === "draft_email") return <DraftEmailStep step={step} />;
  if (stepType === "pdf") return <PdfStep step={step} tokenValues={tokenValues} />;
  if (stepType === "fax" || stepType === "phone" || stepType === "mail" || stepType === "custom") {
    return <PlainChannelStep step={step} />;
  }
  return <OnlineFormStep step={step} />;
}
