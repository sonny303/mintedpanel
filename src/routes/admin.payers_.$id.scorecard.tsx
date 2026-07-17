// Admin → Payer scorecard: a read-only, owner-facing quality view for one
// payer. Gated to admin + billing (like Client Progress). All numbers are a
// pure client-side derivation (src/lib/payerScorecard.ts) over rows already in
// the app's existing caches — no new endpoint, no mutations.
import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { usePayer, useStatusConfigs } from "@/hooks/useAdmin";
import { usePortals, usePortalFieldMaps, useRecentFills } from "@/hooks/usePortals";
import { useCases } from "@/hooks/useCases";
import { useRole } from "@/lib/auth-store";
import {
  computePayerScorecard,
  type ScorecardIndicator,
  type BucketDuration,
} from "@/lib/payerScorecard";

export const Route = createFileRoute("/admin/payers_/$id/scorecard")({
  component: PayerScorecardPage,
});

const BUCKET_LABELS: Record<string, string> = {
  ours: "Our court",
  waiting_payer: "With payer",
  waiting_provider: "With provider",
  complete: "Complete",
};

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function days(value: number): string {
  return `${value.toFixed(1)} d`;
}

function bucketLabel(bucket: string): string {
  return BUCKET_LABELS[bucket] ?? bucket;
}

function Tile({
  label,
  value,
  detail,
  na,
  children,
}: {
  label: string;
  value: string;
  detail: string;
  na: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="border border-[#E8E5E0] rounded-md bg-white p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`mt-2 text-[28px] font-semibold tabular-nums ${na ? "text-[#A8A29E]" : "text-[#1B4D3E]"}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[12px] text-muted-foreground">{detail}</div>
      {children}
    </div>
  );
}

function MappingCoverageTile({ i }: { i: ScorecardIndicator }) {
  return (
    <Tile
      label="Mapping coverage"
      na={!i.available}
      value={i.available && i.ratio != null ? pct(i.ratio) : "n/a"}
      detail={
        i.available
          ? `${i.numerator} mapped of ${i.denominator} captured fields`
          : "No captured fields for this payer's portals"
      }
    />
  );
}

function FirstPassTile({ i }: { i: ScorecardIndicator }) {
  return (
    <Tile
      label="First-pass submission"
      na={!i.available}
      value={i.available && i.ratio != null ? pct(i.ratio) : "n/a"}
      detail={
        i.available
          ? `${i.numerator} of ${i.denominator} cases filled without a re-fill`
          : "No fills logged for this payer's cases"
      }
    />
  );
}

function TimeInBucketTile({ i }: { i: ScorecardIndicator }) {
  const buckets: BucketDuration[] = i.buckets ?? [];
  return (
    <Tile
      label="Avg time in bucket"
      na={!i.available}
      value={i.available && i.overallAvgDays != null ? days(i.overallAvgDays) : "n/a"}
      detail={
        i.available
          ? "Average across credentialing status changes"
          : "Status history isn't loaded on this view"
      }
    >
      {buckets.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-[#E8E5E0] pt-3 text-[12px]">
          {buckets.map((b) => (
            <li key={b.bucket} className="flex items-center justify-between">
              <span className="text-muted-foreground">{bucketLabel(b.bucket)}</span>
              <span className="tabular-nums text-foreground">{days(b.avgDays)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Tile>
  );
}

function PayerScorecardPage() {
  const { id } = Route.useParams();
  const role = useRole();

  const payerQ = usePayer(id);
  const portalsQ = usePortals();
  const fieldMapsQ = usePortalFieldMaps();
  const casesQ = useCases();
  const statusConfigsQ = useStatusConfigs("credentialing");
  const fillsQ = useRecentFills();

  const loading =
    payerQ.isLoading ||
    portalsQ.isLoading ||
    fieldMapsQ.isLoading ||
    casesQ.isLoading ||
    statusConfigsQ.isLoading ||
    fillsQ.isLoading;
  const failed =
    payerQ.isError ||
    portalsQ.isError ||
    fieldMapsQ.isError ||
    casesQ.isError ||
    statusConfigsQ.isError ||
    fillsQ.isError;

  const scorecard = useMemo(
    () =>
      computePayerScorecard({
        payerId: id,
        portals: portalsQ.data ?? [],
        fieldMaps: fieldMapsQ.data ?? [],
        cases: casesQ.data ?? [],
        statusConfigs: statusConfigsQ.data ?? [],
        // No bulk status-history reader on this surface; the indicator degrades
        // to n/a rather than firing a per-case query.
        statusHistory: [],
        fillSessions: fillsQ.data ?? [],
      }),
    [id, portalsQ.data, fieldMapsQ.data, casesQ.data, statusConfigsQ.data, fillsQ.data],
  );

  const byKey = useMemo(
    () => new Map(scorecard.indicators.map((ind) => [ind.key, ind])),
    [scorecard],
  );

  // E4.2 TE-19 — /admin/payers is a redirect shell now; link the workspace
  // the scorecard is reached from instead.
  const backButton = (
    <Button variant="outline" size="sm" asChild>
      <Link to="/admin/payer-admin">
        <ArrowLeft className="w-4 h-4 mr-1" /> Payer Setup
      </Link>
    </Button>
  );

  if (role !== "admin" && role !== "billing") {
    return (
      <div className="space-y-6">
        <PageHeader title="Payer scorecard" actions={backButton} />
        <div className="border border-[#E8E5E0] rounded-md bg-white p-6">
          <EmptyState message="The payer scorecard is available to admin and billing users." />
        </div>
      </div>
    );
  }

  const payerName = payerQ.data?.name ?? "Payer";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${payerName} scorecard`}
        description="Read-only quality indicators for this payer."
        actions={backButton}
      />

      {failed ? (
        <div className="border border-[#FCA5A5] bg-[#FEF2F2] rounded-md px-4 py-3 text-[13px] text-[#B91C1C]">
          Couldn't load the scorecard. Refresh to retry.
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-32 rounded-md bg-[#F5F5F4] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MappingCoverageTile i={byKey.get("mapping_coverage")!} />
          <FirstPassTile i={byKey.get("first_pass_rate")!} />
          <TimeInBucketTile i={byKey.get("avg_time_in_bucket")!} />
        </div>
      )}
    </div>
  );
}
