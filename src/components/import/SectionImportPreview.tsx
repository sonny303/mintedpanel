// E3.3 TE-8 — the staged-import preview + commit surface for the provider_group
// and facility sections. Same idiom as the provider ImportPreviewContent (E2.0
// counts + drill-down + explicit Commit / Cancel), but the group/facility grains
// are simpler — skip-on-match, no conflict review — so this is a lighter view.
// Everything is computed from live reads by the pure dedupeGroupRows /
// dedupeFacilityRows (nothing stored at preview time); Commit fans out through
// the existing createProviderGroup / createFacility services.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportRunStatePill } from "@/components/import/ImportRunPanel";
import {
  useCancelImportRun,
  useCommitSectionImportRun,
  useSectionImportPreview,
} from "@/hooks/useImportRuns";
import { useIsAdmin } from "@/lib/permissions";
import { downloadCsv } from "@/lib/csv";
import { errorReportCsvRows } from "@/lib/rosterImport";
import type { ImportRun } from "@/types";

type SectionKind = "provider_group" | "facility";

const KIND_LABEL: Record<SectionKind, { one: string; many: string }> = {
  provider_group: { one: "provider group", many: "provider groups" },
  facility: { one: "facility", many: "facilities" },
};

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

export function SectionImportPreview({
  runId,
  entityKind,
}: {
  runId: string;
  entityKind: SectionKind;
}) {
  const preview = useSectionImportPreview(runId, entityKind);
  const isAdmin = useIsAdmin();
  const commit = useCommitSectionImportRun();
  const [confirmCommit, setConfirmCommit] = useState(false);
  const label = KIND_LABEL[entityKind];

  const run = preview.run;
  const result = preview.result;

  if (preview.isError) {
    return <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load the import run.</p>;
  }
  if (preview.isLoading || !run || !result) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (run.state === "committed") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#E8E5E0] bg-white p-4">
          <ImportRunStatePill state={run.state} />
          <span className="text-[13px]">This {label.one} import has been committed.</span>
          <Button asChild variant="outline" size="sm" className="ml-auto h-8">
            <Link to="/onboarding/wizard">Back to onboarding</Link>
          </Button>
        </div>
        <p className="text-[13px] text-muted-foreground">
          The imported {label.many} are live in your workspace and appear in the wizard sections.
        </p>
      </div>
    );
  }

  const blockedRows = result.blocked.length + (run.errorRows ?? 0);

  const runCommit = () => {
    commit.mutate(
      {
        runId: run.id,
        entityKind,
        creates: result.creates,
        skippedCount: result.skips.length,
        blocked: result.blocked,
      },
      {
        onSuccess: (r) => {
          setConfirmCommit(false);
          if (r.alreadyCommitted) {
            toast.info("This run was already committed.");
            return;
          }
          toast.success(
            `${r.created} ${r.created === 1 ? label.one : label.many} created${
              r.skipped > 0 ? ` · ${r.skipped} skipped` : ""
            }.`,
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
        <MetricCard
          label={`New ${label.many} to create`}
          value={result.creates.length}
          tone="brand"
        />
        <MetricCard label="Already exists (skipped)" value={result.skips.length} tone="neutral" />
        <MetricCard label="Rows with blocked errors" value={blockedRows} tone="danger" />
      </div>

      {result.creates.length > 0 ? (
        <DrilldownSection title={`New ${label.many}`} count={result.creates.length}>
          <ul className="space-y-1 text-[13px]">
            {result.creates.map((c) => (
              <li key={`c-${c.line}`} className="text-foreground">
                {c.displayName}
              </li>
            ))}
          </ul>
        </DrilldownSection>
      ) : null}

      {blockedRows > 0 ? (
        <DrilldownSection title="Blocked rows" count={blockedRows}>
          <div className="space-y-2 text-[13px]">
            <p className="text-muted-foreground">
              Rows with scan errors or an unresolved parent group are not committed. Scan errors are
              detailed in the downloadable report.
            </p>
            {result.blocked.length > 0 ? (
              <ul className="space-y-1">
                {result.blocked.map((b) => (
                  <li key={`b-${b.line}`} className="text-[#B91C1C]">
                    Row {b.line}: {b.displayName} — {b.reason}
                  </li>
                ))}
              </ul>
            ) : null}
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

      {result.skips.length > 0 ? (
        <DrilldownSection title="Skipped (already exists)" count={result.skips.length}>
          <ul className="space-y-1 text-[13px]">
            {result.skips.map((s) => (
              <li key={`s-${s.line}`} className="text-muted-foreground">
                {s.displayName} — {s.reason}
              </li>
            ))}
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
                  disabled={commit.isPending || result.creates.length === 0}
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
