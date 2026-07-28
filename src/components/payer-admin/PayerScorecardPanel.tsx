// Payer & Cases design bundle, screen 3 Scorecard (Slice C) — §2.10 FOLD: the
// standalone /admin/payers/$id/scorecard page's body moved here verbatim (same
// pure computePayerScorecard derivation over the same existing caches, same
// admin-&-billing gate), and that route became a redirect into this tab. One
// scorecard, not two; old links never dead-end.
import { useMemo } from "react";
import { EmptyState } from "@/components/EmptyState";
import { useStatusConfigs } from "@/hooks/useAdmin";
import { useCases } from "@/hooks/useCases";
import { usePortalFieldMaps, usePortals, useRecentFills } from "@/hooks/usePortals";
import { useRole } from "@/lib/auth-store";
import {
  computePayerScorecard,
  type BucketDuration,
  type ScorecardIndicator,
} from "@/lib/payerScorecard";
import type { Payer } from "@/types";

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
    <div className="rounded-md border border-[#E8E5E0] bg-white p-4">
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
              <span className="text-muted-foreground">{BUCKET_LABELS[b.bucket] ?? b.bucket}</span>
              <span className="tabular-nums text-foreground">{days(b.avgDays)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Tile>
  );
}

export function PayerScorecardPanel({ payer }: { payer: Payer }) {
  const role = useRole();
  const portalsQ = usePortals();
  const fieldMapsQ = usePortalFieldMaps();
  const casesQ = useCases();
  const statusConfigsQ = useStatusConfigs("credentialing");
  const fillsQ = useRecentFills();

  const loading =
    portalsQ.isLoading ||
    fieldMapsQ.isLoading ||
    casesQ.isLoading ||
    statusConfigsQ.isLoading ||
    fillsQ.isLoading;
  const failed =
    portalsQ.isError ||
    fieldMapsQ.isError ||
    casesQ.isError ||
    statusConfigsQ.isError ||
    fillsQ.isError;

  const scorecard = useMemo(
    () =>
      computePayerScorecard({
        payerId: payer.id,
        portals: portalsQ.data ?? [],
        fieldMaps: fieldMapsQ.data ?? [],
        cases: casesQ.data ?? [],
        statusConfigs: statusConfigsQ.data ?? [],
        // No bulk status-history reader on this surface; the indicator degrades
        // to n/a rather than firing a per-case query.
        statusHistory: [],
        fillSessions: fillsQ.data ?? [],
      }),
    [payer.id, portalsQ.data, fieldMapsQ.data, casesQ.data, statusConfigsQ.data, fillsQ.data],
  );

  const byKey = useMemo(
    () => new Map(scorecard.indicators.map((ind) => [ind.key, ind])),
    [scorecard],
  );

  if (role !== "admin" && role !== "billing") {
    return (
      <section className="rounded-[6px] border border-[#E8E5E0] bg-white p-6">
        <EmptyState message="The payer scorecard is available to admin and billing users." />
      </section>
    );
  }

  return (
    <section className="rounded-[6px] border border-[#E8E5E0] bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#E8E5E0] px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-foreground">Scorecard</h2>
          <p className="text-[12.5px] text-muted-foreground">
            How well this payer is working. Derived from cases and fills — nothing to configure.
          </p>
        </div>
        <span className="inline-flex h-[22px] flex-none items-center rounded-[4px] border border-[#E8E5E0] bg-[#F5F4F1] px-2.5 text-[12px] font-medium text-muted-foreground">
          Admin &amp; billing
        </span>
      </div>
      <div className="p-5">
        {failed ? (
          <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
            Couldn&apos;t load the scorecard. Refresh to retry.
          </div>
        ) : loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map((n) => (
              <div key={n} className="h-32 animate-pulse rounded-md bg-[#F5F5F4]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <MappingCoverageTile i={byKey.get("mapping_coverage")!} />
            <FirstPassTile i={byKey.get("first_pass_rate")!} />
            <TimeInBucketTile i={byKey.get("avg_time_in_bucket")!} />
          </div>
        )}
      </div>
    </section>
  );
}
