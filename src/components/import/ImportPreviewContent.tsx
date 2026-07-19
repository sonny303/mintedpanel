// E3.1 F3.1.1/F3.1.3/F3.1.4/F3.1.5 — the staged-import preview + commit
// surface, reusing the E2.0 preview idiom (counts + drill-down + explicit
// Commit / Cancel). Everything is computed from live reads by the pure
// src/lib/importDedupe (nothing is stored at preview time); Commit runs the
// ONE transactional commit_import_run RPC, so nothing reaches live tables
// until then and a failure leaves them untouched. Conflict review is
// per-field, side-by-side, default = the existing value (an explicit pick is
// required to overwrite); unresolved conflicts block ONLY their own rows.
// After commit, the run's committed view offers the one-step batch assignment
// (F3.1.5) — committed providers carry Pending Verification and are verified
// from the roster (ProviderRosterSection), fenced out of readiness/generation
// until then (TE-2).
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { BatchAssignPanel } from "@/components/import/BatchAssignPanel";
import { ImportRunStatePill } from "@/components/import/ImportRunPanel";
import { useCancelImportRun, useCommitImportRun, useImportPreview } from "@/hooks/useImportRuns";
import { useIsAdmin } from "@/lib/permissions";
import { downloadCsv } from "@/lib/csv";
import { errorReportCsvRows } from "@/lib/rosterImport";
import {
  buildCommitPlan,
  summarizeImportPreview,
  unresolvedConflicts,
  type ConflictChoice,
  type ImportConflict,
  type ImportRowDisposition,
  type RunResolutions,
  type UpdateDisposition,
} from "@/lib/importDedupe";
import type { ImportRun } from "@/types";

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "brand" | "danger";
}) {
  const toneClass =
    tone === "brand" ? "text-[#1B4D3E]" : tone === "danger" ? "text-[#B91C1C]" : "text-foreground";
  return (
    <div className="rounded-md border border-[#E8E5E0] bg-white p-4">
      <div className={`text-[24px] font-semibold tabular-nums ${toneClass}`}>{value}</div>
      <div className="text-[12px] text-muted-foreground">{label}</div>
    </div>
  );
}

function ConflictPicker({
  conflict,
  choice,
  onChoose,
}: {
  conflict: ImportConflict;
  choice: ConflictChoice | undefined;
  onChoose: (c: ConflictChoice) => void;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr_1fr] items-center gap-2 border-t border-[#E8E5E0] py-2 text-[12px]">
      <span className="font-medium">{conflict.label}</span>
      <button
        type="button"
        onClick={() => onChoose("existing")}
        aria-pressed={choice === "existing"}
        className={`rounded-[4px] border px-2 py-1 text-left ${
          choice === "existing"
            ? "border-[#1B4D3E] bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]"
            : "border-[#E8E5E0] text-foreground"
        }`}
      >
        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
          Keep existing
        </span>
        {conflict.existingDisplay ?? "—"}
      </button>
      <button
        type="button"
        onClick={() => onChoose("imported")}
        aria-pressed={choice === "imported"}
        className={`rounded-[4px] border px-2 py-1 text-left ${
          choice === "imported"
            ? "border-[#1B4D3E] bg-[var(--mp-info-tint)] text-[var(--mp-info-ink)]"
            : "border-[#E8E5E0] text-foreground"
        }`}
      >
        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
          Use imported
        </span>
        {conflict.importedDisplay}
      </button>
    </div>
  );
}

function UpdateRow({
  entry,
  resolutions,
  onResolve,
}: {
  entry: UpdateDisposition;
  resolutions: RunResolutions;
  onResolve: (providerId: string, key: string, choice: ConflictChoice) => void;
}) {
  const picks = resolutions[entry.providerId] ?? {};
  const unresolved = unresolvedConflicts(entry, resolutions);
  const additions: string[] = [];
  if (entry.addGroupIds.length > 0)
    additions.push(`${entry.addGroupIds.length} group assignment(s)`);
  if (entry.addFacilityIds.length > 0)
    additions.push(`${entry.addFacilityIds.length} facility assignment(s)`);
  if (entry.licenseInserts.length > 0)
    additions.push(`${entry.licenseInserts.length} new license(s)`);
  return (
    <div className="rounded-md border border-[#E8E5E0] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{entry.displayName}</span>
        {additions.length > 0 ? (
          <span className="text-[12px] text-muted-foreground">proposes {additions.join(", ")}</span>
        ) : null}
        {entry.conflicts.length > 0 ? (
          <Badge
            className={`ml-auto rounded-full border-0 ${
              unresolved.length > 0
                ? "bg-[var(--mp-danger-tint)] text-[var(--mp-danger-ink)]"
                : "bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]"
            }`}
          >
            {unresolved.length > 0
              ? `${unresolved.length} unresolved conflict${unresolved.length === 1 ? "" : "s"}`
              : "conflicts resolved"}
          </Badge>
        ) : null}
      </div>
      {entry.conflicts.length > 0 ? (
        <div className="mt-2">
          {entry.conflicts.map((c) => (
            <ConflictPicker
              key={c.key}
              conflict={c}
              choice={picks[c.key]}
              onChoose={(choice) => onResolve(entry.providerId, c.key, choice)}
            />
          ))}
        </div>
      ) : null}
      {entry.notes.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {entry.notes.map((n, i) => (
            <li key={i} className="text-[11px] text-muted-foreground">
              • {n}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function DrilldownSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" aria-expanded={open} className="w-full justify-start">
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
          {title} ({count})
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function downloadErrorReport(run: ImportRun) {
  downloadCsv("roster-import-errors.csv", errorReportCsvRows(run.errorReport ?? []));
}

export function ImportPreviewContent({ runId }: { runId: string }) {
  const preview = useImportPreview(runId);
  const isAdmin = useIsAdmin();
  const commit = useCommitImportRun();
  const [resolutions, setResolutions] = useState<RunResolutions>({});
  const [confirmCommit, setConfirmCommit] = useState(false);

  const dispositions = preview.dispositions;
  const run = preview.run;

  const summary = useMemo(
    () =>
      dispositions ? summarizeImportPreview(dispositions, resolutions, run?.errorRows ?? 0) : null,
    [dispositions, resolutions, run?.errorRows],
  );

  if (preview.isError) {
    return <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load the import run.</p>;
  }
  if (preview.isLoading || !run || !dispositions || !summary) {
    return <Skeleton className="h-40 w-full" />;
  }

  // A committed run has no staged rows left (purged, TE-8): show the outcome +
  // the one-step batch assignment (F3.1.5) instead of the review dashboard.
  if (run.state === "committed") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#E8E5E0] bg-white p-4">
          <ImportRunStatePill state={run.state} />
          <span className="text-[13px]">
            {(run.createdProviderIds ?? []).length} provider
            {(run.createdProviderIds ?? []).length === 1 ? "" : "s"} created ·{" "}
            {(run.updatedProviderIds ?? []).length} updated
          </span>
          <Button asChild variant="outline" size="sm" className="ml-auto h-8">
            <Link to="/onboarding/wizard">Verify providers on the roster</Link>
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Imported providers are <strong>Pending Verification</strong> — they do not appear in
          readiness or case generation until you verify them on the roster (Providers section of the
          onboarding wizard). Assign the whole batch to a group and facilities in one step below.
        </p>
        <BatchAssignPanel run={run} />
      </div>
    );
  }

  const creates = dispositions.filter((d) => d.kind === "create");
  const updates = dispositions.filter((d): d is UpdateDisposition => d.kind === "update");
  const skips = dispositions.filter((d) => d.kind === "skip");

  const resolve = (providerId: string, key: string, choice: ConflictChoice) =>
    setResolutions((prev) => ({
      ...prev,
      [providerId]: { ...(prev[providerId] ?? {}), [key]: choice },
    }));

  const reconciles = summary.stagedRowsCovered === (run.stagedRows ?? 0);
  const totalReconciles = summary.stagedRowsCovered + (run.errorRows ?? 0) === (run.totalRows ?? 0);

  const runCommit = () => {
    if (!dispositions) return;
    const plan = buildCommitPlan(dispositions, resolutions);
    commit.mutate(
      { runId: run.id, plan },
      {
        onSuccess: (result) => {
          setConfirmCommit(false);
          if (result.alreadyCommitted) {
            toast.info("This run was already committed.");
            return;
          }
          // E6.4 F6.4.6 — the unified relationship summary: what the commit
          // resolved across providers, groups, facilities, and enrollments.
          const rel = result.relationships;
          const relText =
            rel.facilityAssignments + rel.groupAssignments + rel.enrollmentFacts > 0
              ? ` Relationships attached: ${rel.facilityAssignments} facility, ${rel.groupAssignments} group, ${rel.enrollmentFacts} enrollment fact${rel.enrollmentFacts === 1 ? "" : "s"}.`
              : "";
          toast.success(
            `${result.created} provider${result.created === 1 ? "" : "s"} created · ${result.updated} updated. Imported providers are Pending Verification.${relText}`,
          );
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Couldn't commit the import run."),
      },
    );
  };

  const canReview = run.state === "ready_for_review";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="New providers to create" value={summary.createProviders} tone="brand" />
        <MetricCard
          label="Existing providers to update"
          value={summary.updateProviders}
          tone="neutral"
        />
        <MetricCard label="Rows with blocked errors" value={summary.blockedRows} tone="danger" />
      </div>

      <p className="text-[12px] text-muted-foreground">
        {summary.skippedProviders} exact duplicate
        {summary.skippedProviders === 1 ? "" : "s"} will be skipped ("already exists").{" "}
        {reconciles && totalReconciles ? (
          <span>Counts reconcile with the {run.totalRows ?? 0} staged rows.</span>
        ) : (
          <span className="text-[#B91C1C]">
            Counts do not reconcile with the run — reload the preview.
          </span>
        )}
      </p>

      {creates.length > 0 ? (
        <DrilldownSection title="New providers" count={creates.length}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>NPI</TableHead>
                <TableHead>Groups</TableHead>
                <TableHead>Facilities</TableHead>
                <TableHead>Licenses</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {creates.map((d) =>
                d.kind === "create" ? (
                  <TableRow key={`c-${d.line}`}>
                    <TableCell className="text-[13px] font-medium">{d.displayName}</TableCell>
                    <TableCell className="text-[13px] tabular-nums">{d.npi}</TableCell>
                    <TableCell className="text-[13px]">{d.groupIds.length}</TableCell>
                    <TableCell className="text-[13px]">{d.facilityIds.length}</TableCell>
                    <TableCell className="text-[13px]">{d.licenses.length}</TableCell>
                  </TableRow>
                ) : null,
              )}
            </TableBody>
          </Table>
        </DrilldownSection>
      ) : null}

      {updates.length > 0 ? (
        <DrilldownSection title="Updates & conflict review" count={updates.length}>
          <div className="space-y-2">
            {updates.map((entry) => (
              <UpdateRow
                key={`u-${entry.providerId}`}
                entry={entry}
                resolutions={resolutions}
                onResolve={resolve}
              />
            ))}
          </div>
        </DrilldownSection>
      ) : null}

      {summary.blockedRows > 0 ? (
        <DrilldownSection title="Blocked rows" count={summary.blockedRows}>
          <div className="space-y-2 text-[13px]">
            <p className="text-muted-foreground">
              Rows with scan errors and rows with unresolved conflicts are not committed. Scan
              errors are detailed in the downloadable report; resolve conflicts above to unblock
              those rows.
            </p>
            {(run.errorRows ?? 0) > 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => downloadErrorReport(run)}
              >
                <Download className="mr-1 h-4 w-4" />
                Download error report ({run.errorRows} scan error
                {(run.errorRows ?? 0) === 1 ? "" : "s"})
              </Button>
            ) : null}
          </div>
        </DrilldownSection>
      ) : null}

      {skips.length > 0 ? (
        <DrilldownSection title="Skipped (already exists)" count={skips.length}>
          <ul className="space-y-1 text-[13px]">
            {skips.map((d) =>
              d.kind === "skip" ? (
                <li key={`s-${d.line}`} className="text-muted-foreground">
                  {d.displayName} — {d.reason}
                </li>
              ) : null,
            )}
          </ul>
        </DrilldownSection>
      ) : null}

      {canReview ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-[#E8E5E0] pt-4">
          {isAdmin ? (
            confirmCommit ? (
              <>
                <span className="text-[13px] font-medium text-[#B91C1C]">
                  Commit is final and cannot be undone. Continue?
                </span>
                <Button
                  className="h-9 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                  disabled={commit.isPending}
                  onClick={runCommit}
                >
                  {commit.isPending ? "Committing…" : "Yes, commit changes"}
                </Button>
                <Button
                  variant="outline"
                  className="h-9"
                  disabled={commit.isPending}
                  onClick={() => setConfirmCommit(false)}
                >
                  Back
                </Button>
              </>
            ) : (
              <>
                <Button
                  className="h-9 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
                  disabled={
                    commit.isPending || summary.createProviders + summary.updateProviders === 0
                  }
                  onClick={() => setConfirmCommit(true)}
                >
                  Commit Changes
                </Button>
                <CancelImportButton runId={run.id} />
                <span className="text-[12px] text-muted-foreground">
                  Nothing is written to live records until you commit.
                </span>
              </>
            )
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Reviewing and committing an import run is available to admins.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Cancel purges the staged rows (TE-8) — split out so the confirm state stays
// local and doesn't wedge the commit affordance.
function CancelImportButton({ runId }: { runId: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancelMut = useCancelImportRun();
  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-[12px] text-muted-foreground">Discard the staged run?</span>
        <Button
          variant="outline"
          size="sm"
          className="h-9 border-[#FCA5A5] text-[#B91C1C]"
          disabled={cancelMut.isPending}
          onClick={() =>
            cancelMut.mutate(runId, {
              onSuccess: () => toast.success("Import cancelled — staged rows removed"),
              onError: (e) =>
                toast.error(e instanceof Error ? e.message : "Couldn't cancel the run"),
            })
          }
        >
          {cancelMut.isPending ? "Cancelling…" : "Yes, cancel import"}
        </Button>
        <Button variant="outline" size="sm" className="h-9" onClick={() => setConfirming(false)}>
          Back
        </Button>
      </span>
    );
  }
  return (
    <Button variant="outline" className="h-9" onClick={() => setConfirming(true)}>
      Cancel Import
    </Button>
  );
}
