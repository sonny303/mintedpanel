// E2.4 F2.4.1 — run detail: every candidate row's disposition and reason
// EXACTLY as recorded at confirm time (the immutable child rows — no
// recomputation, no update path). Created and blocking rows link their case;
// excluded rows link their exclusion record (voided, never deleted, so links
// never dangle — and the reason snapshot still renders if one ever did).
// Display names join at read time from the org caches (TE-8); the rows store
// FKs + reason only. Partial-batch honesty: a run whose recorded rows fall
// short of its confirm-time candidate total says so — there is no mutable
// run status to paper over it.
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useGenerationRun } from "@/hooks/useNextBestActions";
import { useCaseGenerationExclusions } from "@/hooks/useGenerationPreview";
import { useGenerationRunRows } from "@/hooks/useGenerationRuns";
import { useProviders } from "@/hooks/useProviders";
import { useProviderGroups } from "@/hooks/useLookups";
import { usePayers } from "@/hooks/useAdmin";
import { DISPOSITION_LABELS, deriveRunCounts, runRecordStatus } from "@/lib/generationRuns";
import { EXCLUSION_REASON_LABELS } from "@/lib/generationPreview";
import { fmtDateTime } from "@/lib/format";
import type { CaseGenerationRunRow, GenerationRowDisposition } from "@/types";

function DispositionPill({ disposition }: { disposition: GenerationRowDisposition }) {
  // Status semantics only (TE-7): created ok, failed destructive,
  // skipped/excluded neutral.
  const tone =
    disposition === "created"
      ? "bg-[var(--mp-ok-tint)] text-[var(--mp-ok-ink)]"
      : disposition === "failed"
        ? "bg-[var(--mp-danger-tint)] text-[var(--mp-danger-ink)]"
        : "bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]";
  return (
    <Badge className={`rounded-full border-0 whitespace-nowrap ${tone}`}>
      {DISPOSITION_LABELS[disposition]}
    </Badge>
  );
}

function RowLink({ row }: { row: CaseGenerationRunRow }) {
  const exclusionsQ = useCaseGenerationExclusions();
  if (row.caseId) {
    return (
      <Link
        to="/cases/$id"
        params={{ id: row.caseId }}
        className="text-[12px] font-medium text-[#1B4D3E] underline underline-offset-2"
      >
        {row.disposition === "created" ? "Open case" : "Open blocking case"}
      </Link>
    );
  }
  if (row.disposition === "excluded") {
    const exclusion = row.exclusionId
      ? (exclusionsQ.data ?? []).find((x) => x.id === row.exclusionId)
      : undefined;
    if (!exclusion) {
      // TE-5 degradation: the reason snapshot above still tells the story.
      return (
        <span className="text-[12px] text-muted-foreground">exclusion record unavailable</span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
        <Badge className="rounded-full border-0 bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]">
          {EXCLUSION_REASON_LABELS[exclusion.reason]} ·{" "}
          {exclusion.status === "active" ? "still excluded" : "since restored"}
        </Badge>
        <Link to="/generation" className="font-medium text-[#1B4D3E] underline underline-offset-2">
          View in preview
        </Link>
      </span>
    );
  }
  return null;
}

export function RunDetailContent({ runId }: { runId: string }) {
  const runQ = useGenerationRun(runId);
  const rowsQ = useGenerationRunRows(runId);
  const providersQ = useProviders();
  const groupsQ = useProviderGroups();
  const payersQ = usePayers();

  const sources = [runQ, rowsQ, providersQ, groupsQ, payersQ];
  if (sources.some((q) => q.isError)) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-[13px] text-[#B91C1C]">Couldn&apos;t load this run.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            for (const q of sources) if (q.isError) q.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  if (sources.some((q) => q.data === undefined)) {
    return <Skeleton className="h-24 w-full" />;
  }

  const run = runQ.data;
  if (!run) {
    return (
      <div className="rounded-md border border-[#E8E5E0] p-6 text-center">
        <p className="text-[13px] font-medium">Run not found</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          This generation run isn&apos;t visible in this organization.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to="/generation/runs">Back to run history</Link>
        </Button>
      </div>
    );
  }

  const rows = rowsQ.data ?? [];
  const counts = deriveRunCounts(run, rows);
  const record = runRecordStatus(run, rows);
  const providerName = new Map(
    (providersQ.data ?? []).map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]),
  );
  const groupName = new Map((groupsQ.data ?? []).map((g) => [g.id, g.name]));
  const payerName = new Map((payersQ.data ?? []).map((p) => [p.id, p.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-[#E8E5E0] p-3 text-[13px]">
        <span>
          Confirmed {fmtDateTime(run.createdAt)} · {counts.created} created ·{" "}
          {counts.skippedExisting} skipped (existing) · {counts.excluded} excluded · {counts.failed}{" "}
          failed
        </span>
        {counts.fromPlan ? (
          <Badge className="rounded-full border-0 bg-[var(--mp-neutral-tint)] text-[var(--mp-neutral-ink)]">
            plan counts — no per-row record
          </Badge>
        ) : null}
      </div>

      {!counts.fromPlan && record.endedEarly ? (
        <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3 text-[13px] text-[#92400E]">
          Run ended early — {record.recorded} of {record.expected} candidate outcomes were recorded
          before the batch stopped.
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No per-row dispositions were recorded for this run (it predates per-row recording, or it
          ended before any outcome was known). The counts above are its confirm-time plan.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Payer</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Disposition</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>
                <span className="sr-only">Linked record</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-[13px] font-medium">
                  {providerName.get(row.providerId) ?? "Unknown provider"}
                </TableCell>
                <TableCell className="text-[13px]">
                  {groupName.get(row.groupId) ?? "Unknown group"}
                </TableCell>
                <TableCell className="text-[13px]">
                  {payerName.get(row.payerId) ?? "Unknown payer"}
                </TableCell>
                <TableCell className="text-[13px]">{row.state}</TableCell>
                <TableCell>
                  <DispositionPill disposition={row.disposition} />
                </TableCell>
                <TableCell className="max-w-[320px] text-[12px] text-muted-foreground">
                  {row.reason ?? "—"}
                </TableCell>
                <TableCell>
                  <RowLink row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
