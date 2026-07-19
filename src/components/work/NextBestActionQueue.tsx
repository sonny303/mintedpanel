// E2.3 F2.3.1/F2.3.2/F2.3.3 — the "My Cases" next-best-action queue: one
// entry per open case, ordered by the earliest applicable deadline (pure
// derivation in src/lib/nextBestActions.ts), each stating its action, the
// driving deadline, and WHY it ranks where it does. Post-generation landing
// (F2.3.2): ?run=<uuid> filters to the batch with a created/skipped summary
// banner read from the immutable case_generation_runs row; the batch/all
// toggle is URL-state (clearing = param removal, never component state).
// Read-only surface (TE-10): the queue writes nothing — no stored priority,
// no snooze, no audit rows.
import { useMemo } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useCasePortalKeys,
  useGenerationRun,
  useNextBestActions,
} from "@/hooks/useNextBestActions";
import { usePortals } from "@/hooks/usePortals";
import { DEADLINE_SOURCE_LABELS, filterQueueToRun, type QueueEntry } from "@/lib/nextBestActions";
import { resolvePortalTargets, type CasePortalTarget } from "@/lib/casePortals";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { WorkInPortalButton } from "@/components/cases/WorkInPortalButton";
import { fmtDate } from "@/lib/format";

function DeadlinePill({ entry }: { entry: QueueEntry }) {
  if (!entry.deadline) {
    return (
      <Badge className="rounded-full border-0 bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]">
        No deadline
      </Badge>
    );
  }
  // Destructive tint ONLY for overdue items (TE-9) — everything else neutral.
  const tone = entry.deadline.overdue
    ? "bg-[var(--mp-danger-tint)] text-[var(--mp-danger-ink)]"
    : "bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]";
  return (
    <Badge className={`rounded-full border-0 whitespace-nowrap ${tone}`}>
      {entry.deadline.overdue ? "Overdue · " : ""}
      {fmtDate(entry.deadline.date)} · {DEADLINE_SOURCE_LABELS[entry.deadline.source]}
    </Badge>
  );
}

function QueueRow({
  entry,
  portalTargets,
}: {
  entry: QueueEntry;
  portalTargets: CasePortalTarget[];
}) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-md border border-[#E8E5E0] p-4">
      <Link
        to="/cases/$id"
        params={{ id: entry.caseId }}
        className="min-w-0 flex-1 space-y-0.5 rounded-sm transition-colors hover:opacity-80"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">{entry.action}</span>
          {/* E6.0 — THE unified case status on the queue row. */}
          {entry.caseStatus ? <CaseStatusPill status={entry.caseStatus} /> : null}
          {entry.actionKind === "readiness_gap" ? (
            <Badge className="rounded-full border-0 bg-[var(--mp-warn-tint)] text-[var(--mp-warn-ink)]">
              Readiness gap
            </Badge>
          ) : null}
        </span>
        <span className="block text-[12.5px] text-muted-foreground">
          {entry.providerName} · {entry.payerName} · {entry.state} · {entry.groupName}
        </span>
        <span className="block text-[12px] text-muted-foreground">{entry.reason}</span>
      </Link>
      {/* E4.3 F4.3.1 — deadline + "Work in portal" launcher(s), a sibling of
          the case Link (never nested, so a launch never navigates the row).
          Only for cases with a resolvable portal-linked open task. */}
      <div className="flex shrink-0 flex-col items-end gap-2">
        <DeadlinePill entry={entry} />
        {portalTargets.map((target) => (
          <WorkInPortalButton
            key={target.portalKey}
            caseId={entry.caseId}
            providerId={entry.providerId}
            target={target}
          />
        ))}
      </div>
    </li>
  );
}

export function NextBestActionQueue({ run }: { run?: string }) {
  const navigate = useNavigate();
  const queue = useNextBestActions();
  const runQ = useGenerationRun(run);
  const casePortalKeysQ = useCasePortalKeys();
  const portalsQ = usePortals();

  // caseId → resolvable portal launch targets (from open tasks' portal steps).
  const portalTargetsByCase = useMemo(() => {
    const portals = portalsQ.data ?? [];
    const map = new Map<string, CasePortalTarget[]>();
    for (const row of casePortalKeysQ.data ?? []) {
      const targets = resolvePortalTargets(row.portalKeys, portals);
      if (targets.length > 0) map.set(row.caseId, targets);
    }
    return map;
  }, [casePortalKeysQ.data, portalsQ.data]);

  if (queue.isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load the queue inputs.</p>
        <Button variant="outline" size="sm" onClick={queue.refetch}>
          Retry
        </Button>
      </div>
    );
  }
  if (!queue.entries || (run && runQ.data === undefined && !runQ.isError)) {
    return <Skeleton className="h-24 w-full" />;
  }

  const entries = filterQueueToRun(queue.entries, run);
  const showAll = () => navigate({ to: "/work", search: {} });

  return (
    <div className="space-y-4">
      {run ? (
        // Batch summary banner (F2.3.2/TE-9) — composed from card tokens (no
        // alert primitive exists); counts come from the immutable run row.
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-[#E8E5E0] p-3 text-[13px]">
          <span>
            {runQ.data
              ? `Generation run ${fmtDate(runQ.data.createdAt)}: ${runQ.data.createdCount} created · ${
                  runQ.data.skippedExistingCount
                } skipped (existing) · ${runQ.data.excludedCount} excluded`
              : "This generation run isn't visible in this organization."}
          </span>
          <div className="ml-auto">
            <Tabs value="batch" onValueChange={(v) => v === "all" && showAll()}>
              <TabsList className="h-8">
                <TabsTrigger className="text-[12.5px]" value="batch">
                  This batch
                </TabsTrigger>
                <TabsTrigger className="text-[12.5px]" value="all">
                  All work
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="rounded-md border border-[#E8E5E0] p-6 text-center">
          <ClipboardCheck className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-[13px] font-medium">
            {run ? "No open cases from this generation run" : "No open cases to work"}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {run
              ? "Every case this batch created is closed, or the run created none."
              : "Open cases rank here by their next deadline the moment they exist."}
          </p>
          {run ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={showAll}>
              Show all work
            </Button>
          ) : (
            <Button asChild size="sm" className="mt-3 bg-[#1B4D3E] text-white hover:bg-[#163F33]">
              <Link to="/generation">Generate applications</Link>
            </Button>
          )}
        </div>
      ) : (
        <ol className="space-y-2" aria-label="Next best actions, most urgent first">
          {entries.map((entry) => (
            <QueueRow
              key={entry.caseId}
              entry={entry}
              portalTargets={portalTargetsByCase.get(entry.caseId) ?? []}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
