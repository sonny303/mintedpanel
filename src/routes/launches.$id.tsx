// Launch-location detail (launch PRD v2.1): the launch IS a facilities row.
// Shows the location's pipeline status, its assigned providers (via
// provider_facility_assignments) with per-location case rollups, provider
// attach, launch editing, and the Create-cases payer checklist. Opening with
// ?createCases=true (the row's one-click path) starts case creation directly.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Pencil, Plus, Wand2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AssignProviderDialog } from "@/components/launches/AssignProviderDialog";
import { CreateCasesDialog } from "@/components/launches/CreateCasesDialog";
import { LaunchEditModal } from "@/components/launches/LaunchEditModal";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/triage/StatusPill";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { useFacilityAssignments, useLaunchLocation, useLaunchLocations } from "@/hooks/useLaunches";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useContracts } from "@/hooks/useContracts";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useCanWrite } from "@/lib/permissions";
import {
  isNewStateLaunch,
  launchDateDisplay,
  needsGoLiveNudge,
  type LocationRow,
} from "@/lib/launchLocations";
import { launchReadiness } from "@/lib/launchReadiness";

export const Route = createFileRoute("/launches/$id")({
  validateSearch: (search: Record<string, unknown>): { createCases?: boolean } => ({
    createCases: search.createCases === true || search.createCases === "true" || undefined,
  }),
  component: LaunchDetailPage,
});

const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";

function LaunchDetailPage() {
  const { id } = Route.useParams();
  const { createCases } = Route.useSearch();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const locationQ = useLaunchLocation(id);
  const locationsQ = useLaunchLocations();
  const assignmentsQ = useFacilityAssignments();
  const providersQ = useProviders();
  const casesQ = useCases();
  const contractsQ = useContracts();
  const payersQ = usePayers();
  const locationStatusesQ = useStatusConfigs("location");
  const credStatusesQ = useStatusConfigs("credentialing");

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [casesOpen, setCasesOpen] = useState(createCases === true);

  const location = locationQ.data ?? null;
  const status = useMemo(
    () =>
      location?.statusId
        ? ((locationStatusesQ.data ?? []).find((s) => s.id === location.statusId) ?? null)
        : null,
    [location, locationStatusesQ.data],
  );

  const linked = useMemo(() => {
    const linkedIds = new Set(
      (assignmentsQ.data ?? [])
        .filter((a) => a.facilityId === id && a.providerId)
        .map((a) => a.providerId as string),
    );
    return (providersQ.data ?? []).filter((p) => linkedIds.has(p.id));
  }, [assignmentsQ.data, providersQ.data, id]);

  const credStatusById = useMemo(
    () => new Map((credStatusesQ.data ?? []).map((s) => [s.id, s])),
    [credStatusesQ.data],
  );
  const payerById = useMemo(
    () => new Map((payersQ.data ?? []).map((p) => [p.id, p])),
    [payersQ.data],
  );

  /** cases linked to this location (credential_cases.facility_id) */
  const locationCases = useMemo(
    () => (casesQ.data ?? []).filter((c) => c.facilityId === id),
    [casesQ.data, id],
  );

  const contracted = useMemo(
    () =>
      new Set(
        (contractsQ.data ?? [])
          .filter(
            (c) =>
              location &&
              location.state &&
              c.groupId === location.groupId &&
              c.state === location.state &&
              c.payerId,
          )
          .map((c) => c.payerId as string),
      ),
    [contractsQ.data, location],
  );

  const readiness = useMemo(() => {
    if (!location) return null;
    return launchReadiness({
      cases: locationCases.map((c) => ({
        statusLabel: c.credentialingStatusId
          ? (credStatusById.get(c.credentialingStatusId)?.label ?? null)
          : null,
        isPreCred: payerById.get(c.payerId)?.name === PRE_CRED_PAYER_NAME,
      })),
      activePayerIds: (payersQ.data ?? [])
        .filter((p) => p.isActive && p.name !== PRE_CRED_PAYER_NAME)
        .map((p) => p.id),
      contractedPayerIdsInState: contracted,
    });
  }, [location, locationCases, credStatusById, payerById, payersQ.data, contracted]);

  const newState = useMemo(() => {
    if (!location) return false;
    const statusById = new Map((locationStatusesQ.data ?? []).map((s) => [s.id, s]));
    const rows: LocationRow[] = (locationsQ.data ?? []).map((facility) => ({
      facility,
      status: facility.statusId ? (statusById.get(facility.statusId) ?? null) : null,
    }));
    return isNewStateLaunch(location, rows);
  }, [location, locationsQ.data, locationStatusesQ.data]);

  if (locationQ.isLoading) {
    return <div className="h-32 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />;
  }
  if (!location) {
    return (
      <div className="p-8 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
        Launch not found.
      </div>
    );
  }

  const dateText = launchDateDisplay(status?.label, location.effectiveDate);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={location.name}
        description={[
          [location.city, location.state].filter(Boolean).join(", "),
          dateText !== "—" ? dateText : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" className="h-9 gap-2" onClick={() => setEditOpen(true)}>
                <Pencil className="w-4 h-4" />
                Edit launch
              </Button>
              <Button variant="outline" className="h-9 gap-2" onClick={() => setAddOpen(true)}>
                <Plus className="w-4 h-4" />
                Add provider
              </Button>
              <Button className="h-9 gap-2" onClick={() => setCasesOpen(true)}>
                <Wand2 className="w-4 h-4" />
                Create cases
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        {status ? <StatusPill label={status.label} color={status.color} /> : null}
        {newState && location.state ? (
          <span className="flex items-center gap-1.5">
            <StatusPill label="New state" color="var(--mp-warn)" />
            <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-warn)]">
              Payer contracts for {location.state} may not exist yet
            </span>
          </span>
        ) : null}
        {readiness && readiness.denominator > 0 ? (
          <span className="flex items-center gap-2">
            <span className="w-24">
              <ProgressBar value={readiness.inNetwork} max={readiness.denominator} />
            </span>
            <span className="tabular-nums text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
              {readiness.inNetwork} of {readiness.denominator} in-network
            </span>
          </span>
        ) : locationCases.length === 0 ? (
          <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-warn)]">
            No cases yet
          </span>
        ) : null}
        {readiness?.contractGap && !newState && location.state ? (
          <span className="flex items-center gap-1 text-[length:var(--mp-text-xs)] text-[color:var(--mp-warn)]">
            <AlertTriangle className="w-3.5 h-3.5" />
            Contract gap in {location.state}
          </span>
        ) : null}
        {needsGoLiveNudge(status?.label, location.effectiveDate, new Date()) ? (
          canWrite ? (
            <button
              type="button"
              className="text-[length:var(--mp-text-xs)] font-semibold text-[color:var(--mp-warn)] hover:underline"
              onClick={() => setEditOpen(true)}
            >
              Start date passed. Mark Live?
            </button>
          ) : (
            <span className="text-[length:var(--mp-text-xs)] font-semibold text-[color:var(--mp-warn)]">
              Start date passed
            </span>
          )
        ) : null}
      </div>

      <section className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card overflow-hidden">
        <div className="border-b border-mp-border bg-mp-muted/60 px-4 py-2.5 text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
          Providers ({linked.length})
        </div>
        {linked.length === 0 ? (
          <div className="px-4 py-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
            No providers linked yet.
          </div>
        ) : (
          <ul className="divide-y divide-[color:var(--mp-border)]">
            {linked.map((p) => {
              const pCases = locationCases.filter((c) => c.providerId === p.id);
              const countable = pCases.filter(
                (c) => payerById.get(c.payerId)?.name !== PRE_CRED_PAYER_NAME,
              );
              const inNet = countable.filter(
                (c) =>
                  c.credentialingStatusId &&
                  credStatusById.get(c.credentialingStatusId)?.label === "In-Network",
              ).length;
              return (
                <li
                  key={p.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate({ to: "/providers/$id", params: { id: p.id } })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate({ to: "/providers/$id", params: { id: p.id } });
                  }}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-mp-muted/50 transition-colors"
                >
                  <span className="flex-1 min-w-0 truncate text-[length:var(--mp-text-base)] font-medium text-[color:var(--mp-ink)]">
                    {p.firstName} {p.lastName}
                    {p.credentials ? (
                      <span className="ml-1.5 text-[length:var(--mp-text-xs)] font-normal text-[color:var(--mp-ink-faint)]">
                        {p.credentials}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
                    {pCases.length} {pCases.length === 1 ? "case" : "cases"} here
                  </span>
                  {countable.length > 0 ? (
                    <span className="flex items-center gap-2">
                      <span className="w-16">
                        <ProgressBar value={inNet} max={countable.length} />
                      </span>
                      <span className="tabular-nums text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)] whitespace-nowrap">
                        {inNet} of {countable.length}
                      </span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {editOpen ? <LaunchEditModal location={location} onClose={() => setEditOpen(false)} /> : null}
      {addOpen ? (
        <AssignProviderDialog location={location} onClose={() => setAddOpen(false)} />
      ) : null}
      {canWrite && casesOpen && !assignmentsQ.isLoading && !providersQ.isLoading ? (
        <CreateCasesDialog
          location={location}
          linkedProviders={linked}
          onClose={() => setCasesOpen(false)}
        />
      ) : null}
    </div>
  );
}
