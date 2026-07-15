// E2.0/E2.1 preview checklist + E4.2 F4.2.4 release configuration (TE-14) and
// F4.2.6 upstream profile gating (TE-13). The candidate/dedupe/exclusion logic
// is the locked E2.0 derivation; this component adds a SELECTION layer on top:
//   - gated proposed rows (a required profile attribute is missing) are pulled
//     out of the confirmable set and shown as blocked, with a per-provider
//     "Create outreach task" spawn (never auto-created);
//   - a release scope (all / first N) narrows how many confirmable rows this run
//     actually creates; the remainder stays eligible for a later run, and the
//     E2.4 run record carries the scope.
// Confirm still runs the UNCHANGED E2.1 batch. An optional payer/group scope
// (TE-6) filters the preview when entered from a payer's row.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type GenerationScope,
} from "@/hooks/useGenerationPreview";
import { useCreateProviderOutreachTask } from "@/hooks/useTasks";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";
import type { ReadinessRow } from "@/lib/enrollmentReadiness";
import { applyReleaseScope, type ReleaseScope } from "@/lib/releaseScope";
import { outreachTaskTitle } from "@/lib/profileGating";
import {
  EXCLUSION_REASON_LABELS,
  existingCaseIndicator,
  previewRowKey,
  splitGenerationPreview,
  type GenerationPreviewRow,
} from "@/lib/generationPreview";

function ReadinessBadge({ readiness }: { readiness: ReadinessRow | undefined }) {
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

export interface GenerationPreviewContentProps {
  scope?: GenerationScope;
}

export function GenerationPreviewContent({ scope }: GenerationPreviewContentProps = {}) {
  const preview = useGenerationPreview(scope);
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const voidExclusion = useVoidCaseGenerationExclusion();
  const confirm = useConfirmGeneration();
  const outreach = useCreateProviderOutreachTask();
  const [excluding, setExcluding] = useState<GenerationPreviewRow | null>(null);
  const [excludedOpen, setExcludedOpen] = useState(false);
  const [spawned, setSpawned] = useState<Set<string>>(new Set());
  // Release scope: "" = release all; a positive number = first-N cap (TE-14).
  const [releaseCap, setReleaseCap] = useState<string>("");

  const gatedKeys = useMemo(
    () => new Set((preview.gated ?? []).map((g) => previewRowKey(g.row))),
    [preview.gated],
  );

  // The confirmable proposed rows = proposed, not gated. Gated rows are shown
  // separately and never enter the run.
  const confirmableProposed = useMemo(
    () =>
      (preview.rows ?? []).filter(
        (r) => r.disposition === "proposed" && !gatedKeys.has(previewRowKey(r)),
      ),
    [preview.rows, gatedKeys],
  );

  const releaseScope: ReleaseScope = useMemo(() => {
    const n = releaseCap.trim() === "" ? null : Number(releaseCap);
    if (n === null || Number.isNaN(n) || n < 0) return { kind: "all" };
    return { kind: "count", limit: n };
  }, [releaseCap]);

  const releasedCount = useMemo(
    () => applyReleaseScope(confirmableProposed, releaseScope).length,
    [confirmableProposed, releaseScope],
  );

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
  const visibleChecklist = checklist.filter((r) => !gatedKeys.has(previewRowKey(r)));
  const gated = preview.gated ?? [];

  const runConfirm = () => {
    if (!preview.rows) return;
    // Remove gated proposed rows so they never reach create_case_with_tasks;
    // existing/excluded rows stay for E2.4 disposition recording.
    const rows = preview.rows.filter((r) => !gatedKeys.has(previewRowKey(r)));
    confirm.mutate(
      { rows, releaseScope, providerFacilities: preview.providerFacilities },
      {
        onSuccess: (result) => {
          toast.success(
            `${result.summary.created} case${result.summary.created === 1 ? "" : "s"} created · ${result.summary.skippedExisting} skipped (existing)`,
          );
          if (result.summary.failed > 0) {
            toast.error(
              `${result.summary.failed} row${result.summary.failed === 1 ? "" : "s"} failed: ${result.summary.failures
                .map((f) => `${f.row.providerName} — ${f.row.payerName} ${f.row.state}`)
                .join("; ")}`,
            );
            return;
          }
          navigate({ to: "/work", search: { run: result.runId } });
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not confirm the generation run."),
      },
    );
  };

  const spawnOutreach = (row: GenerationPreviewRow, title: string) => {
    outreach.mutate(
      { providerId: row.providerId, title },
      {
        onSuccess: () => {
          setSpawned((prev) => new Set(prev).add(row.providerId));
          toast.success(`Outreach task created for ${row.providerName}.`);
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not create the outreach task."),
      },
    );
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
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
        <span>
          {confirmableProposed.length} {confirmableProposed.length === 1 ? "proposal" : "proposals"}{" "}
          · {gated.length} blocked · {excluded.length} excluded
        </span>
        {canWrite && confirmableProposed.length > 0 ? (
          <div className="ml-auto flex items-center gap-2">
            <Label htmlFor="release-cap" className="text-[12px] text-muted-foreground">
              Release
            </Label>
            <Input
              id="release-cap"
              inputMode="numeric"
              placeholder="all"
              value={releaseCap}
              onChange={(e) => setReleaseCap(e.target.value.replace(/[^0-9]/g, ""))}
              className="h-8 w-20 text-[13px]"
              aria-label="Release count cap (blank = all)"
            />
            <Button
              size="sm"
              className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
              disabled={releasedCount === 0 || confirm.isPending || !confirm.ready}
              onClick={runConfirm}
            >
              {confirm.isPending
                ? "Creating cases…"
                : `Confirm & create ${releasedCount} ${releasedCount === 1 ? "case" : "cases"}`}
            </Button>
          </div>
        ) : null}
      </div>

      {gated.length > 0 ? (
        <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3">
          <p className="text-[13px] font-medium text-[#92400E]">
            {gated.length} provider{gated.length === 1 ? "" : "s"} blocked by a missing required
            attribute — no case generates for them this run.
          </p>
          <ul className="mt-2 space-y-2">
            {gated.map(({ row, unmet }) => {
              const title = outreachTaskTitle(row.providerName, unmet);
              return (
                <li
                  key={previewRowKey(row)}
                  className="flex flex-wrap items-center gap-2 text-[13px] text-[#92400E]"
                >
                  <span className="font-medium">{row.providerName}</span>
                  <span>
                    {row.payerName} {row.state} — missing {unmet.map((u) => u.label).join(", ")}
                  </span>
                  {canWrite ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-7 text-[12px]"
                      disabled={outreach.isPending || spawned.has(row.providerId)}
                      onClick={() => spawnOutreach(row, title)}
                    >
                      {spawned.has(row.providerId)
                        ? "Outreach task created"
                        : "Create outreach task"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
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
          {visibleChecklist.map((row) => {
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
