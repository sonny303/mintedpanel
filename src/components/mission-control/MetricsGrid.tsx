// Mission Control Home tiles: six cross-org counts from platform_metrics()
// (tile wording and arithmetic in src/lib/platformMetricTiles.ts). Counts only,
// no PHI. One column at phone width, two on tablets, three on desktop.
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformMetrics } from "@/hooks/usePlatformAdmin";
import { fmtDateTime } from "@/lib/format";
import { platformMetricTiles } from "@/lib/platformMetricTiles";

const GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";
const TILE = "rounded-md border border-[var(--mp-border)] bg-[var(--mp-card)] p-4";
const TILE_COUNT = 6;

export function MetricsGrid() {
  const metricsQ = usePlatformMetrics();

  if (metricsQ.isError) {
    return (
      <div className={`${TILE} py-8`}>
        <EmptyState
          message="The counts didn't load"
          description="Something went wrong while counting across organizations. Try again."
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={metricsQ.isFetching}
              onClick={() => void metricsQ.refetch()}
            >
              {metricsQ.isFetching ? "Retrying…" : "Retry"}
            </Button>
          }
        />
      </div>
    );
  }

  if (!metricsQ.data) {
    return (
      <div className={GRID} aria-busy="true" aria-label="Loading counts">
        {Array.from({ length: TILE_COUNT }).map((_, i) => (
          <div key={i} className={`${TILE} space-y-3`}>
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
    );
  }

  const tiles = platformMetricTiles(metricsQ.data);
  return (
    <div className="space-y-3">
      <div className={GRID}>
        {tiles.map((tile) => (
          <div
            key={tile.key}
            role="group"
            aria-labelledby={`mc-tile-${tile.key}`}
            className={`${TILE} flex flex-col gap-2`}
          >
            <span
              id={`mc-tile-${tile.key}`}
              className="text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground"
            >
              {tile.label}
            </span>
            <span className="text-[26px] font-bold leading-none tabular-nums text-foreground">
              {tile.value}
            </span>
            <span className="text-[12.5px] text-muted-foreground">{tile.detail}</span>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">
        Generated {fmtDateTime(metricsQ.data.generatedAt)}
      </p>
    </div>
  );
}
