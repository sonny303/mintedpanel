// E2.0 F2.0.1/F2.0.2/F2.0.3 + E2.1 F2.1.2/F2.1.3 — the computed
// generation-preview checklist: every candidate provider × group × payer ×
// state exactly once, checked by default, with derivation reason, readiness
// signal (E1.8 + the TE-8 group contract check), and status-aware
// existing-case gray-outs (TE-7; complete-bucket rows link to the case —
// reapply continues THERE, never as a second case at the key). Confirm &
// create (E2.1) runs the batch through the generationConfirm service — run
// row first, one create_case_with_tasks call per checked row, duplicates
// skipped — then lands on the cases work view filtered to the batch (interim
// landing; E2.3 F2.3.2 supersedes it). Unchecking a proposed row records a
// persistent, reasoned exclusion; excluded rows live in the collapsible
// section below with one-click restore (a VOID, never a delete). Exclusion
// and restore writes are admin-only ([r4-review] Q2); confirm is a writer
// flow, mirroring the case-creation RLS.
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ExclusionReasonDialog } from "@/components/generation/ExclusionReasonDialog";
import {
  useConfirmGeneration,
  useGenerationPreview,
  useVoidCaseGenerationExclusion,
} from "@/hooks/useGenerationPreview";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";
import type { ReadinessRow } from "@/lib/enrollmentReadiness";
import {
  EXCLUSION_REASON_LABELS,
  existingCaseIndicator,
  previewRowKey,
  splitGenerationPreview,
  type GenerationPreviewRow,
} from "@/lib/generationPreview";

function ReadinessBadge({ readiness }: { readiness: ReadinessRow | undefined }) {
  // TE-9: a missing readiness row renders as neutral "no readiness data" —
  // never a green Ready.
  if (!readiness) {
    return (
      <Badge className="rounded-full border-0 bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]">
        No readiness data
      </Badge>
    );
  }
  if (readiness.ready) {
    return (
      <Badge className="rounded-full border-0 bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]">
        Ready
      </Badge>
    );
  }
  const gaps = readiness.checks.filter((c) => !c.pass);
  return (
    <Badge
      className="rounded-full border-0 bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]"
      title={gaps.map((c) => c.label).join(", ")}
    >
      {readiness.openGaps} {readiness.openGaps === 1 ? "gap" : "gaps"}
    </Badge>
  );
}

export function GenerationPreviewContent() {
  const preview = useGenerationPreview();
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const voidExclusion = useVoidCaseGenerationExclusion();
  const confirm = useConfirmGeneration();
  const [excluding, setExcluding] = useState<GenerationPreviewRow | null>(null);
  const [excludedOpen, setExcludedOpen] = useState(false);

  if (preview.isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load the generation inputs.</p>
        <Button variant="outline" size="sm" onClick={preview.refetch}>
          Retry
        </Button>
      </div>
    );
  }
  if (!preview.rows) {
    return <Skeleton className="h-24 w-full" />;
  }

  const { checklist, excluded } = splitGenerationPreview(preview.rows);
  const summary = preview.summary;

  const runConfirm = () => {
    if (!preview.rows) return;
    confirm.mutate(preview.rows, {
      onSuccess: (result) => {
        const skipped = (summary?.existing ?? 0) + result.summary.skippedExisting;
        toast.success(
          `${result.summary.created} case${result.summary.created === 1 ? "" : "s"} created · ${skipped} skipped (existing) · ${summary?.excluded ?? 0} excluded`,
        );
        if (result.summary.failed > 0) {
          // F2.1.2: a partial failure reports which rows failed; the created
          // ones stand (per-row transactionality) and the refetched preview
          // shows them as existing, so the user can retry just the failures.
          toast.error(
            `${result.summary.failed} row${result.summary.failed === 1 ? "" : "s"} failed: ${result.summary.failures
              .map((f) => `${f.row.providerName} — ${f.row.payerName} ${f.row.state}`)
              .join("; ")}`,
          );
          return;
        }
        navigate({ to: "/cases", search: { runId: result.runId } });
      },
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Could not confirm the generation run."),
    });
  };

  const restore = (row: GenerationPreviewRow) => {
    if (!row.exclusion) return;
    voidExclusion.mutate(row.exclusion.exclusionId, {
      onSuccess: () =>
        toast.success("Exclusion restored — the row will be proposed on the next run."),
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Could not restore the exclusion."),
    });
  };

  if (preview.rows.length === 0) {
    return (
      <div className="rounded-md border border-[#E8E5E0] p-4">
        <p className="text-[13px] font-medium">No combinations to propose yet</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Candidates derive from active payer network targets and each group&apos;s roster —
          providers count once they hold a clinic assignment under the targeted group. Attach payers
          and assign providers to facilities in the onboarding wizard to see rows here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary ? (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          <span>
            {summary.candidates} {summary.candidates === 1 ? "combination" : "combinations"}:{" "}
            {summary.proposed} proposed · {summary.existing} already{" "}
            {summary.existing === 1 ? "exists" : "exist"} · {summary.excluded} excluded
          </span>
          {canWrite ? (
            <Button
              size="sm"
              className="ml-auto bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              disabled={summary.proposed === 0 || confirm.isPending || !confirm.ready}
              onClick={runConfirm}
            >
              {confirm.isPending
                ? "Creating cases…"
                : `Confirm & create ${summary.proposed} ${summary.proposed === 1 ? "case" : "cases"}`}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Include in generation</span>
            </TableHead>
            <TableHead>Provider</TableHead>
            <TableHead>Group</TableHead>
            <TableHead>Payer</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Readiness</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {checklist.map((row) => {
            const key = previewRowKey(row);
            const existing = row.existingCase;
            const grayed = row.disposition === "existing";
            return (
              <TableRow key={key} className={grayed ? "text-muted-foreground" : undefined}>
                <TableCell>
                  {grayed ? null : (
                    <Checkbox
                      checked
                      disabled={!isAdmin}
                      aria-label={`Uncheck to exclude ${row.providerName} — ${row.payerName} ${row.state} (${row.groupName})`}
                      onCheckedChange={(checked) => {
                        if (checked === false) setExcluding(row);
                      }}
                    />
                  )}
                </TableCell>
                <TableCell className="text-[13px] font-medium">{row.providerName}</TableCell>
                <TableCell className="text-[13px]">{row.groupName}</TableCell>
                <TableCell className="text-[13px]">{row.payerName}</TableCell>
                <TableCell className="text-[13px]">{row.state}</TableCell>
                <TableCell>
                  <ReadinessBadge readiness={preview.readinessByKey?.get(key)} />
                </TableCell>
                <TableCell className="max-w-[320px] text-[12px] text-muted-foreground">
                  {existing ? (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <Badge className="rounded-full border-0 bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]">
                        {existingCaseIndicator(existing).label}
                      </Badge>
                      {/* F2.1.3: generation never proposes a new case at a
                          denied/closed key — the row links to the case, where
                          reapplication continues the same history. */}
                      {existingCaseIndicator(existing).reapply ? (
                        <Link
                          to="/cases/$id"
                          params={{ id: existing.caseId }}
                          className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
                        >
                          reapply from the case
                        </Link>
                      ) : null}
                    </span>
                  ) : (
                    row.reason
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Collapsible open={excludedOpen} onOpenChange={setExcludedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" aria-expanded={excludedOpen}>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${excludedOpen ? "rotate-180" : ""}`}
            />
            Excluded ({excluded.length})
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {excluded.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted-foreground">
              Nothing is excluded. Uncheck a proposed row to exclude it with a reason.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {excluded.map((row) => (
                <li
                  key={previewRowKey(row)}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-[#E8E5E0] p-3"
                >
                  <span className="text-[13px] font-medium">{row.providerName}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {row.payerName} in {row.state} under {row.groupName}
                  </span>
                  {row.exclusion ? (
                    <Badge className="rounded-full border-0 bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]">
                      {EXCLUSION_REASON_LABELS[row.exclusion.reason]}
                    </Badge>
                  ) : null}
                  {row.exclusion?.note ? (
                    <span className="text-[12px] text-muted-foreground">{row.exclusion.note}</span>
                  ) : null}
                  {isAdmin ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      disabled={voidExclusion.isPending}
                      onClick={() => restore(row)}
                    >
                      Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>

      {excluding ? (
        <ExclusionReasonDialog row={excluding} onClose={() => setExcluding(null)} />
      ) : null}
    </div>
  );
}
