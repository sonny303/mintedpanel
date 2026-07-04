// Launches at /launches (launch PRD v2.1). A launch is a location in a
// pre-active status, so this page is a filtered view of facilities: a
// Recently Launched strip (Live, started within 30 days) and the Pipeline
// (every pre-Live status, dated rows first). Statuses come from the
// location track in Admin > Statuses.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, Plus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusPill } from "@/components/triage/StatusPill";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AssignProviderDialog } from "@/components/launches/AssignProviderDialog";
import { LaunchEditModal } from "@/components/launches/LaunchEditModal";
import { useFacilityAssignments, useLaunchLocations } from "@/hooks/useLaunches";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useStatusConfigs } from "@/hooks/useAdmin";
import { useCanWrite } from "@/lib/permissions";
import {
  isNewStateLaunch,
  launchDateDisplay,
  needsGoLiveNudge,
  splitLaunchSections,
  type LocationRow,
} from "@/lib/launchLocations";
import type { Facility } from "@/types";

export const Route = createFileRoute("/launches/")({
  component: LaunchesPage,
});

interface LaunchRow extends LocationRow {
  providerNames: string[];
  caseCount: number;
  newState: boolean;
}

function LaunchesPage() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const locationsQ = useLaunchLocations();
  const statusConfigsQ = useStatusConfigs("location");
  const assignmentsQ = useFacilityAssignments();
  const providersQ = useProviders();
  const casesQ = useCases();
  const [modal, setModal] = useState<{ location: Facility | null } | null>(null);
  const [assignFor, setAssignFor] = useState<Facility | null>(null);

  const loading = locationsQ.isLoading || statusConfigsQ.isLoading || casesQ.isLoading;
  const failed = locationsQ.isError || statusConfigsQ.isError;

  const { recentlyLaunched, pipeline } = useMemo(() => {
    const statusById = new Map((statusConfigsQ.data ?? []).map((s) => [s.id, s]));
    const providerById = new Map((providersQ.data ?? []).map((p) => [p.id, p]));
    const rows: LocationRow[] = (locationsQ.data ?? []).map((facility) => ({
      facility,
      status: facility.statusId ? (statusById.get(facility.statusId) ?? null) : null,
    }));
    const sections = splitLaunchSections(rows, new Date());

    const decorate = (row: LocationRow): LaunchRow => ({
      ...row,
      providerNames: (assignmentsQ.data ?? [])
        .filter((a) => a.facilityId === row.facility.id && a.providerId)
        .map((a) => providerById.get(a.providerId as string))
        .filter((p) => p != null)
        .map((p) => `${p.firstName} ${p.lastName}`),
      caseCount: (casesQ.data ?? []).filter((c) => c.facilityId === row.facility.id).length,
      newState: isNewStateLaunch(row.facility, rows),
    });

    return {
      recentlyLaunched: sections.recentlyLaunched.map(decorate),
      pipeline: sections.pipeline.map(decorate),
    };
  }, [locationsQ.data, statusConfigsQ.data, assignmentsQ.data, providersQ.data, casesQ.data]);

  const total = recentlyLaunched.length + pipeline.length;

  function launchRow(r: LaunchRow) {
    const nudge = needsGoLiveNudge(r.status?.label, r.facility.effectiveDate, new Date());
    return (
      <div
        key={r.facility.id}
        role="link"
        tabIndex={0}
        onClick={() => navigate({ to: "/launches/$id", params: { id: r.facility.id } })}
        onKeyDown={(e) => {
          if (e.key === "Enter") navigate({ to: "/launches/$id", params: { id: r.facility.id } });
        }}
        className="cursor-pointer px-4 py-3 hover:bg-mp-muted/50 transition-colors"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
          <div className="flex items-center gap-2 md:w-56 md:flex-shrink-0">
            {r.status ? <StatusPill label={r.status.label} color={r.status.color} /> : null}
            {r.newState ? (
              <span className="inline-flex items-center rounded-[var(--mp-radius-pill)] bg-mp-warn/15 px-1.5 py-0.5 text-[var(--mp-text-2xs)] font-bold tracking-wide text-[color:var(--mp-warn)]">
                NEW STATE
              </span>
            ) : null}
          </div>
          <div className="flex-1 min-w-0">
            <div className="truncate text-[var(--mp-text-base)] font-medium text-[color:var(--mp-ink)]">
              {r.facility.name}
            </div>
            <div className="truncate text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
              {[r.facility.city, r.facility.state].filter(Boolean).join(", ")}
            </div>
          </div>
          <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)] md:w-36">
            <span className="block">
              {launchDateDisplay(r.status?.label, r.facility.effectiveDate)}
            </span>
            {nudge ? (
              canWrite ? (
                <button
                  type="button"
                  className="mt-0.5 block text-left text-[var(--mp-text-2xs)] font-semibold text-[color:var(--mp-warn)] hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModal({ location: r.facility });
                  }}
                >
                  Start date passed. Mark Live?
                </button>
              ) : (
                <span className="mt-0.5 block text-[var(--mp-text-2xs)] font-semibold text-[color:var(--mp-warn)]">
                  Start date passed
                </span>
              )
            ) : null}
          </span>
          <span className="truncate text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)] md:w-40">
            {r.providerNames.length > 0 ? r.providerNames.join(", ") : "—"}
          </span>
          <span className="md:w-24 text-[var(--mp-text-xs)]">
            {r.caseCount > 0 ? (
              <span className="tabular-nums text-[color:var(--mp-ink-secondary)]">
                {r.caseCount} {r.caseCount === 1 ? "case" : "cases"}
              </span>
            ) : (
              <span className="text-[color:var(--mp-warn)]">No cases yet</span>
            )}
          </span>
          {canWrite ? (
            <span onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Row actions">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setModal({ location: r.facility })}>
                    Edit launch
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAssignFor(r.facility)}>
                    Assign provider
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      navigate({
                        to: "/launches/$id",
                        params: { id: r.facility.id },
                        search: { createCases: true },
                      })
                    }
                  >
                    Create cases
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Launches"
        description={`${total} launches · ${pipeline.length} in pipeline`}
        actions={
          canWrite ? (
            <Button className="h-9 gap-2" onClick={() => setModal({ location: null })}>
              <Plus className="w-4 h-4" />
              New Launch
            </Button>
          ) : null
        }
      />

      {failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-danger)]">
          Couldn't load launches. Refresh to retry.
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          message="No launches yet"
          description="Locations in a pipeline status appear here."
          action={
            canWrite ? (
              <Button className="h-9 gap-2" onClick={() => setModal({ location: null })}>
                <Plus className="w-4 h-4" />
                New Launch
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-5">
          {recentlyLaunched.length > 0 ? (
            <section>
              <h2 className="mb-2 text-[var(--mp-text-xs)] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
                Recently launched
              </h2>
              <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card divide-y divide-[color:var(--mp-border)]">
                {recentlyLaunched.map(launchRow)}
              </div>
            </section>
          ) : null}
          <section>
            <h2 className="mb-2 text-[var(--mp-text-xs)] font-semibold uppercase tracking-wider text-[color:var(--mp-ink-faint)]">
              Pipeline
            </h2>
            <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card divide-y divide-[color:var(--mp-border)]">
              {pipeline.length > 0 ? (
                pipeline.map(launchRow)
              ) : (
                <div className="px-4 py-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
                  Nothing in the pipeline.
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {modal ? <LaunchEditModal location={modal.location} onClose={() => setModal(null)} /> : null}
      {assignFor ? (
        <AssignProviderDialog location={assignFor} onClose={() => setAssignFor(null)} />
      ) : null}
    </div>
  );
}
