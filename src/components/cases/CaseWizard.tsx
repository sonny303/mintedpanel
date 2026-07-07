// Step-by-step Wizard presentation of a case's tasks. One tab per task, in the
// same sortOrder the List panel uses. The primary action completes the current
// task (via the shared useUpdateTaskStatus mutation — its cache invalidation
// updates the case's task/bucket state) and advances; Back steps to the prior
// task. Steps render by stepType: online_form (label + resolved data fields),
// draft_email (resolved subject/body with copy-to-clipboard and unresolved
// {{token}} highlighting), and pdf (coming-soon placeholder).
import { useMemo, useState } from "react";
import { differenceInDays, parseISO } from "date-fns";
import { toast } from "sonner";
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Loader2,
  Mail,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/StatusPill";
import { fmtDate } from "@/lib/format";
import {
  splitOnUnresolvedTokens,
  findUnresolvedTokens,
  firstIncompleteTaskIndex,
} from "@/lib/caseWizard";
import { useUpdateTaskStatus } from "@/hooks/useTasks";
import { useCanWrite } from "@/lib/permissions";
import type { SOPStep, Task } from "@/types";

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Could not copy to clipboard");
  }
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
      {step.detail ? <p className="text-[13px] text-muted-foreground">{step.detail}</p> : null}
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

function DraftEmailStep({ step }: { step: SOPStep }) {
  const subject = step.emailTemplate?.subject ?? "";
  const body = step.emailTemplate?.body ?? "";
  const unresolved = useMemo(() => findUnresolvedTokens(`${subject}\n${body}`), [subject, body]);

  if (!step.emailTemplate) {
    return <p className="text-[13px] text-muted-foreground">No email template on this step.</p>;
  }

  return (
    <div className="space-y-3">
      {unresolved.length > 0 ? (
        <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3 text-[12px] text-[#92400E]">
          Missing data — fill these in before sending:{" "}
          <span className="font-medium">{unresolved.map((t) => `{{${t}}}`).join(", ")}</span>
        </div>
      ) : null}

      <div className="rounded-md border border-[#E8E5E0]">
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
    </div>
  );
}

function PdfStep() {
  return (
    <div className="rounded-md border border-[#E8E5E0] bg-muted/30 p-4 text-[13px] text-muted-foreground">
      PDF form filling is coming soon. For now, complete this document manually.
    </div>
  );
}

function StepBlock({ step }: { step: SOPStep }) {
  const stepType = step.stepType ?? "online_form";
  const icon =
    stepType === "draft_email" ? (
      <Mail className="h-4 w-4 text-[#1B4D3E]" />
    ) : stepType === "pdf" ? (
      <FileText className="h-4 w-4 text-[#1B4D3E]" />
    ) : null;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span
          className={`text-[13px] font-medium ${
            step.isCompleted ? "text-muted-foreground line-through" : "text-foreground"
          }`}
        >
          {step.label}
        </span>
        {step.isCompleted ? <CheckCircle2 className="h-4 w-4 text-[#059669]" /> : null}
      </div>
      {stepType === "draft_email" ? (
        <DraftEmailStep step={step} />
      ) : stepType === "pdf" ? (
        <PdfStep />
      ) : (
        <OnlineFormStep step={step} />
      )}
    </div>
  );
}

export function CaseWizard({ tasks }: { tasks: Task[] }) {
  const canEdit = useCanWrite();
  const updateStatusM = useUpdateTaskStatus();
  // Seed on the first task still needing work; the deck remounts (and re-seeds)
  // each time the Wizard tab is selected.
  const [index, setIndex] = useState(() => firstIncompleteTaskIndex(tasks));

  const total = tasks.length;
  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1);
  const current = tasks[safeIndex];

  const steps = useMemo<SOPStep[]>(
    () =>
      Array.isArray(current?.sopContent)
        ? current.sopContent.slice().sort((a, b) => a.order - b.order)
        : [],
    [current?.sopContent],
  );

  if (total === 0) {
    return (
      <Card className="shadow-none border-border">
        <CardHeader className="p-4 pb-2 border-b border-border">
          <CardTitle className="text-[14px] font-semibold">Wizard</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <EmptyState message="No tasks yet" />
        </CardContent>
      </Card>
    );
  }

  const isCompleted = current.status === "completed";
  const isLast = safeIndex === total - 1;
  const isFirst = safeIndex === 0;
  const overdue =
    !isCompleted && current.dueDate && differenceInDays(new Date(), parseISO(current.dueDate)) > 0;

  const goNext = () => setIndex((i) => Math.min(i + 1, total - 1));
  const goBack = () => setIndex((i) => Math.max(i - 1, 0));

  const handleComplete = () => {
    if (!canEdit || isCompleted) return;
    updateStatusM.mutate(
      { id: current.id, status: "completed" },
      {
        onSuccess: () => {
          toast.success(`Completed "${current.title}"`);
          if (!isLast) goNext();
        },
        onError: (err: unknown) =>
          toast.error(err instanceof Error ? err.message : "Could not complete task"),
      },
    );
  };

  const canComplete = canEdit && !isCompleted;

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
        <CardTitle className="text-[14px] font-semibold">Wizard</CardTitle>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          Step {safeIndex + 1} of {total}
        </span>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* Current task heading */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="text-[15px] font-semibold text-foreground">{current.title}</h3>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span
                className={`inline-flex items-center gap-1 tabular-nums ${
                  overdue ? "text-[#DC2626] font-semibold" : "text-muted-foreground"
                }`}
              >
                <Calendar className="h-3.5 w-3.5" />
                Due {fmtDate(current.dueDate)}
              </span>
              {isCompleted ? <StatusPill status="green" label="Completed" /> : null}
            </div>
          </div>
        </div>

        {current.description ? (
          <p className="text-[13px] text-muted-foreground">{current.description}</p>
        ) : null}

        {/* Steps */}
        <div className="space-y-4">
          {steps.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No SOP steps defined for this task.</p>
          ) : (
            steps.map((step) => <StepBlock key={step.id} step={step} />)
          )}
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={goBack}
            disabled={isFirst}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>

          {canComplete ? (
            <Button
              type="button"
              className="gap-1.5 bg-[#1B4D3E] hover:bg-[#1B4D3E]/90 text-white"
              onClick={handleComplete}
              disabled={updateStatusM.isPending}
            >
              {updateStatusM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {isLast ? "Complete step" : "Complete & next"}
            </Button>
          ) : (
            <Button
              type="button"
              className="gap-1.5 bg-[#1B4D3E] hover:bg-[#1B4D3E]/90 text-white"
              onClick={goNext}
              disabled={isLast}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
