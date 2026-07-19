// E6.3 F6.3.2/F6.3.3/F6.3.4 — the decoupled generation grid: the ONE door
// cases come through. Pivotable (by provider / by payer) with per-group
// check-alls; every provider × target lands in exactly one bucket and the
// confirm bar's reconciliation always sums (src/lib/generationGrid.ts).
// Unchecking a row is SKIP-FOR-NOW — no reason, no ceremony, nothing stored;
// the candidate stays in the buffer and reappears checked next time.
// "Exclude…" is the deliberate opt-out (the E2.0 reasoned store, restorable
// in one click). Confirm runs the UNCHANGED E2.1 per-row transactional batch
// (SOP resolved + version-stamped, run + run-row ledger with the E6.3
// skipped/enrolled dispositions, concurrent duplicates degrade to safe
// skips); full success lands on Cases filtered to the run, partial failure
// stays here naming the failed rows. The E4.2 profile gating + release cap +
// generic-fallback warning ride unchanged.
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useEnrollmentFacts } from "@/hooks/useEnrollmentFacts";
import { useCreateProviderOutreachTask } from "@/hooks/useTasks";
import { useCanWrite, useIsAdmin } from "@/lib/permissions";
import type { ReadinessRow } from "@/lib/enrollmentReadiness";
import { applyReleaseScope, type ReleaseScope } from "@/lib/releaseScope";
import { outreachTaskTitle } from "@/lib/profileGating";
import {
  bucketGridRows,
  filterGridRows,
  groupGridRows,
  reconcileGrid,
  splitGridSelection,
  type GridPivot,
  type GridRow,
  type GridScope,
} from "@/lib/generationGrid";
import {
  EXCLUSION_REASON_LABELS,
  existingCaseIndicator,
  previewRowKey,
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

export interface GenerationGridProps {
  scope?: GridScope;
  /** Entry point picks the default grouping (a payer-row entry opens by payer). */
  defaultPivot?: GridPivot;
}

export function GenerationGrid({ scope = {}, defaultPivot = "provider" }: GenerationGridProps) {
  const preview = useGenerationPreview();
  const factsQ = useEnrollmentFacts();
  const isAdmin = useIsAdmin();
  const canWrite = useCanWrite();
  const navigate = useNavigate();
  const voidExclusion = useVoidCaseGenerationExclusion();
  const confirm = useConfirmGeneration();
  const outreach = useCreateProviderOutreachTask();
  const [pivot, setPivot] = useState<GridPivot>(defaultPivot);
  // Skip-for-now is SELECTION state only: deselected keys, nothing persisted
  // (F6.3.3 — a skipped row reappears checked on the next preview).
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [excluding, setExcluding] = useState<GenerationPreviewRow | null>(null);
  const [spawned, setSpawned] = useState<Set<string>>(new Set());
  // Release scope: "" = release all; a positive number = first-N cap (TE-14).
  const [releaseCap, setReleaseCap] = useState<string>("");

  const gatedKeys = useMemo(
    () => new Set((preview.gated ?? []).map((g) => previewRowKey(g.row))),
    [preview.gated],
  );
  const fallbackKeys = useMemo(
    () => preview.fallbackRowKeys ?? new Set<string>(),
    [preview.fallbackRowKeys],
  );

  // Bucket + scope-filter the grid rows. Gated proposed rows are pulled out of
  // the grid entirely (shown in their own banner, never confirmable).
  const gridRows = useMemo<GridRow[] | undefined>(() => {
    if (!preview.rows || factsQ.data === undefined) return undefined;
    const bucketed = bucketGridRows(
      preview.rows.filter((r) => !gatedKeys.has(previewRowKey(r))),
      factsQ.data,
    );
    return filterGridRows(bucketed, scope, preview.providerFacilities);
  }, [preview.rows, factsQ.data, gatedKeys, scope, preview.providerFacilities]);

  const selectedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of gridRows ?? []) {
      if (r.bucket === "candidate" && !deselected.has(r.key)) keys.add(r.key);
    }
    return keys;
  }, [gridRows, deselected]);

  const releaseScope: ReleaseScope = useMemo(() => {
    const n = releaseCap.trim() === "" ? null : Number(releaseCap);
    if (n === null || Number.isNaN(n) || n < 0) return { kind: "all" };
    return { kind: "count", limit: n };
  }, [releaseCap]);

  if (preview.isError || factsQ.isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load the generation inputs.</p>
        <Button variant="outline" size="sm" onClick={preview.refetch}>
          Retry
        </Button>
      </div>
    );
  }
  if (gridRows === undefined) return <Skeleton className="h-32 w-full" />;

  const split = splitGridSelection(gridRows, selectedKeys);
  const reconciliation = reconcileGrid(gridRows, selectedKeys);
  const released = applyReleaseScope(split.selectedRows, releaseScope);
  const releasedCount = released.length;
  const releasedFallbackCount = released.filter((r) => fallbackKeys.has(previewRowKey(r))).length;
  const gated = preview.gated ?? [];
  const groups = groupGridRows(gridRows, pivot);

  const toggleKeys = (keys: readonly string[], check: boolean) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (check) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  };

  const runConfirm = () => {
    // Selected candidates ride as proposed; existing/excluded ride for the
    // ledger; the E6.3 buckets (skip-for-now + enrolled) go as their own
    // ledger inputs. The release cap narrows only what is CREATED — capped-out
    // rows are recorded as skipped-for-now (they stay in the buffer).
    const cappedOut = split.selectedRows.filter((r) => !released.includes(r));
    confirm.mutate(
      {
        rows: [...released, ...split.existingRows, ...split.excludedRows],
        releaseScope,
        providerFacilities: preview.providerFacilities,
        skippedRows: [...split.skippedRows, ...cappedOut],
        enrolledRows: split.enrolledRows,
      },
      {
        onSuccess: (result) => {
          toast.success(
            `${result.summary.created} case${result.summary.created === 1 ? "" : "s"} created`,
          );
          if (result.summary.failed > 0) {
            toast.error(
              `${result.summary.failed} row${result.summary.failed === 1 ? "" : "s"} failed: ${result.summary.failures
                .map((f) => `${f.row.providerName} — ${f.row.payerName} ${f.row.state}`)
                .join("; ")}`,
            );
            return; // partial failure stays on the preview, honestly
          }
          void navigate({ to: "/cases", search: { run: result.runId } });
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Could not confirm the generation run."),
      },
    );
  };

  const restore = (row: GenerationPreviewRow) => {
    if (!row.exclusion) return;
    voidExclusion.mutate(row.exclusion.exclusionId, {
      onSuccess: () => toast.success("Exclusion restored — the candidate is back in the buffer."),
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Could not restore the exclusion."),
    });
  };

  if (gridRows.length === 0) {
    return (
      <div className="rounded-md border border-[#E8E5E0] p-4">
        <p className="text-[13px] font-medium">Nothing to review here yet</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Candidates derive from the group&apos;s active payer targets × providers with a clinic
          assignment under the group, minus enrollment facts, existing cases, and standing
          exclusions. Attach payers and add providers on the group&apos;s pages to see rows.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* The pivot chips: same rows, two groupings; selection is key-stable. */}
        <Tabs value={pivot} onValueChange={(v) => setPivot(v as GridPivot)}>
          <TabsList className="h-8">
            <TabsTrigger value="provider" className="text-[12.5px]">
              By provider
            </TabsTrigger>
            <TabsTrigger value="payer" className="text-[12.5px]">
              By payer
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {canWrite ? (
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
                      onClick={() =>
                        outreach.mutate(
                          { providerId: row.providerId, title },
                          {
                            onSuccess: () => {
                              setSpawned((prev) => new Set(prev).add(row.providerId));
                              toast.success(`Outreach task created for ${row.providerName}.`);
                            },
                            onError: (e) =>
                              toast.error(
                                e instanceof Error ? e.message : "Could not create the task.",
                              ),
                          },
                        )
                      }
                    >
                      {spawned.has(row.providerId) ? "Outreach task created" : "Create outreach task"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {releasedFallbackCount > 0 ? (
        <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3" role="alert">
          <p className="text-[13px] font-medium text-[#92400E]">
            {releasedFallbackCount} of the {releasedCount} case
            {releasedCount === 1 ? "" : "s"} you&apos;re about to create will use the generic
            fallback SOP.
          </p>
          <p className="mt-1 text-[13px] text-[#92400E]">
            No payer-specific SOP matches their payer, state, and group — author one to replace
            the generic checklist; fallback usage is recorded on the run.
          </p>
        </div>
      ) : null}

      {groups.map((group) => {
        const groupSelected = group.candidateKeys.filter((k) => selectedKeys.has(k)).length;
        const allChecked =
          group.candidateKeys.length > 0 && groupSelected === group.candidateKeys.length;
        return (
          <div key={group.key} className="rounded-md border border-[#E8E5E0]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[#F0EEE9] bg-[#FAFAF9] px-3 py-2">
              {group.candidateKeys.length > 0 ? (
                <Checkbox
                  checked={allChecked}
                  disabled={!canWrite}
                  aria-label={`Select all candidates for ${group.label}`}
                  onCheckedChange={(v) => toggleKeys(group.candidateKeys, v === true)}
                />
              ) : null}
              <span className="text-[13px] font-semibold text-foreground">{group.label}</span>
              <span className="text-[12px] text-muted-foreground">
                {groupSelected} of {group.candidateKeys.length} selected
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">Include in generation</span>
                  </TableHead>
                  <TableHead>{pivot === "provider" ? "Payer" : "Provider"}</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Readiness</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.rows.map(({ key, bucket, row }) => {
                  const grayed = bucket !== "candidate";
                  return (
                    <TableRow key={key} className={grayed ? "text-muted-foreground" : undefined}>
                      <TableCell>
                        {bucket === "candidate" ? (
                          <Checkbox
                            checked={selectedKeys.has(key)}
                            disabled={!canWrite}
                            aria-label={`Include ${row.providerName} — ${row.payerName} ${row.state}`}
                            onCheckedChange={(v) => toggleKeys([key], v === true)}
                          />
                        ) : null}
                      </TableCell>
                      <TableCell className="text-[13px] font-medium">
                        {pivot === "provider" ? row.payerName : row.providerName}
                      </TableCell>
                      <TableCell className="text-[13px]">{row.state}</TableCell>
                      <TableCell>
                        <ReadinessBadge readiness={preview.readinessByKey?.get(key)} />
                      </TableCell>
                      <TableCell className="max-w-[340px] text-[12px] text-muted-foreground">
                        {bucket === "existing" && row.existingCase ? (
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <Badge className="rounded-full border-0 bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]">
                              {existingCaseIndicator(row.existingCase).label}
                            </Badge>
                            {existingCaseIndicator(row.existingCase).reapply ? (
                              <Link
                                to="/cases/$id"
                                params={{ id: row.existingCase.caseId }}
                                className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
                              >
                                reapply from the case
                              </Link>
                            ) : null}
                          </span>
                        ) : bucket === "enrolled" ? (
                          <Badge className="rounded-full border-0 bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]">
                            Already enrolled under {row.groupName}
                          </Badge>
                        ) : bucket === "excluded" ? (
                          <span className="inline-flex flex-wrap items-center gap-2">
                            <Badge className="rounded-full border-0 bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]">
                              Excluded — {row.exclusion ? EXCLUSION_REASON_LABELS[row.exclusion.reason] : ""}
                            </Badge>
                            {row.exclusion?.note ? <span>{row.exclusion.note}</span> : null}
                          </span>
                        ) : (
                          <span className="inline-flex flex-col gap-1">
                            {fallbackKeys.has(key) ? (
                              <Badge
                                className="w-fit rounded-full border-0 bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]"
                                title="No payer-specific SOP matches — generates with the generic checklist"
                              >
                                Generic fallback SOP
                              </Badge>
                            ) : null}
                            <span>{row.reason}</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {bucket === "candidate" && isAdmin ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[12px]"
                            onClick={() => setExcluding(row)}
                          >
                            Exclude…
                          </Button>
                        ) : bucket === "excluded" && isAdmin ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[12px]"
                            disabled={voidExclusion.isPending}
                            onClick={() => restore(row)}
                          >
                            Undo
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        );
      })}

      {/* F6.3.4 — the always-visible reconciliation confirm bar. */}
      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#E8E5E0] bg-white px-4 py-3 shadow-none">
        <p className="text-[13px] text-foreground" data-testid="grid-reconciliation">
          {reconciliation.line}
        </p>
        {canWrite ? (
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            disabled={releasedCount === 0 || confirm.isPending || !confirm.ready}
            onClick={runConfirm}
          >
            {confirm.isPending
              ? "Creating cases…"
              : `Confirm & create ${releasedCount} ${releasedCount === 1 ? "case" : "cases"}`}
          </Button>
        ) : null}
      </div>

      <div>
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            Run history
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              Every confirm writes an immutable run + per-candidate ledger.{" "}
              <Link to="/generation/runs" className="font-medium text-[#1B4D3E] underline">
                Open run history
              </Link>
            </p>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {excluding ? (
        <ExclusionReasonDialog row={excluding} onClose={() => setExcluding(null)} />
      ) : null}
    </div>
  );
}
