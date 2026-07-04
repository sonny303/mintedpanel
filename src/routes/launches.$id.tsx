// Launch-location detail (launch PRD v2.1): the launch IS a facilities row.
// Shows the location's pipeline status, its assigned providers (via
// provider_facility_assignments) with per-location case rollups, provider
// attach, and the explicit generate-cases flow — preview first, then confirm.
// Cases and SOP checklists are created through the existing createCase service
// path (create_case_with_tasks RPC), so audit and task seeding match manual
// creation exactly. Idempotent: existing provider-payer-state combos skip.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Pencil, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { AssignProviderDialog } from "@/components/launches/AssignProviderDialog";
import { LaunchEditModal } from "@/components/launches/LaunchEditModal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/triage/StatusPill";
import { ProgressBar } from "@/components/triage/ProgressBar";
import {
  useFacilityAssignments,
  useGenerateLaunchCases,
  useLaunchLocation,
  useLaunchLocations,
} from "@/hooks/useLaunches";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useContracts } from "@/hooks/useContracts";
import { usePayers, useStatusConfigs, useMsos, useTemplates } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import { getMsoRoutingRule } from "@/services/lookups";
import { resolveTemplate } from "@/lib/sopResolver";
import { useCanWrite } from "@/lib/permissions";
import { isNewStateLaunch, launchDateDisplay, type LocationRow } from "@/lib/launchLocations";
import { launchReadiness } from "@/lib/launchReadiness";
import type { GenerationEntry } from "@/services/launches";
import type { Payer, Provider, SOPTemplate } from "@/types";

export const Route = createFileRoute("/launches/$id")({
  component: LaunchDetailPage,
});

const PRE_CRED_PAYER_NAME = "Pre-Credentialing Setup";
const NONE = "__none__";

// Same matcher as NewCaseModal.pickTemplate — duplicated here because the
// modal keeps it module-local and lib code must not import from components.
function pickTemplate(
  templates: SOPTemplate[],
  payerId: string,
  state: string,
  groupId: string | null,
): SOPTemplate | null {
  const active = templates.filter((t) => {
    const row = t as SOPTemplate & { archived?: boolean; isArchived?: boolean };
    return !(row.archived ?? row.isArchived ?? false);
  });
  const exact = active.find(
    (t) =>
      t.payerId === payerId && t.state === state && (t.groupId === groupId || t.groupId === null),
  );
  if (exact) return exact;
  return active.find((t) => t.payerId === payerId && t.state === state) ?? null;
}

interface PlanLine {
  provider: Provider;
  creates: Payer[];
  skips: { payer: Payer; reason: string }[];
}

function LaunchDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
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
  const groupsQ = useProviderGroups();
  const msosQ = useMsos();
  const templatesQ = useTemplates();
  const generate = useGenerateLaunchCases();

  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [plan, setPlan] = useState<PlanLine[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const [genResult, setGenResult] = useState<{
    created: number;
    skipped: number;
    failed: number;
  } | null>(null);

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
  const preCredPayer = useMemo(
    () => (payersQ.data ?? []).find((p) => p.name === PRE_CRED_PAYER_NAME) ?? null,
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

  async function buildPlan() {
    if (!location || !location.state) return;
    const state = location.state;
    setPlanning(true);
    try {
      const cases = casesQ.data ?? [];
      const activePayers = (payersQ.data ?? []).filter(
        (p) => p.isActive && p.name !== PRE_CRED_PAYER_NAME,
      );
      // A payer is configured for the launch state when an existing routing
      // rule (direct or MSO, BCBS geo-routing included) resolves for it.
      const lines: PlanLine[] = [];
      for (const provider of linked) {
        const creates: Payer[] = [];
        const skips: { payer: Payer; reason: string }[] = [];
        const resolved: Payer[] = [];
        for (const payer of activePayers) {
          const rule = await qc.fetchQuery({
            queryKey: [
              "mso-routing-rule",
              location.orgId,
              payer.id,
              state,
              provider.specialty ?? "",
            ] as const,
            queryFn: () => getMsoRoutingRule(payer.id, state, provider.specialty ?? null),
          });
          if (rule) resolved.push(payer);
        }
        const candidates = resolved.length > 0 && preCredPayer ? [preCredPayer, ...resolved] : [];
        for (const payer of candidates) {
          const exists = cases.some(
            (c) => c.providerId === provider.id && c.payerId === payer.id && c.state === state,
          );
          if (exists) skips.push({ payer, reason: "Case exists" });
          else creates.push(payer);
        }
        lines.push({ provider, creates, skips });
      }
      setPlan(lines);
    } finally {
      setPlanning(false);
    }
  }

  async function confirmGenerate() {
    if (!location || !location.state || !plan) return;
    const state = location.state;
    const group = (groupsQ.data ?? []).find((g) => g.id === location.groupId) ?? null;
    const entries: GenerationEntry[] = [];
    for (const line of plan) {
      for (const payer of line.creates) {
        const isPreCred = payer.name === PRE_CRED_PAYER_NAME;
        const rule = isPreCred
          ? null
          : await getMsoRoutingRule(payer.id, state, line.provider.specialty ?? null);
        const msoId = rule?.routeType === "mso" ? (rule.msoId ?? null) : null;
        const mso = msoId ? ((msosQ.data ?? []).find((m) => m.id === msoId) ?? null) : null;
        const template = pickTemplate(
          templatesQ.data ?? [],
          payer.id,
          state,
          line.provider.groupId ?? null,
        );
        const tasks = template
          ? resolveTemplate(template, line.provider, group, null, mso ? { mso } : null, null)
          : [];
        entries.push({
          input: {
            providerId: line.provider.id,
            payerId: payer.id,
            state,
            groupId: line.provider.groupId ?? location.groupId,
            facilityId: location.id,
            specialty: line.provider.specialty ?? null,
            msoId,
          },
          tasks: tasks.map((t) => ({
            title: t.title,
            description: t.description,
            sopContent: t.sopContent,
            sortOrder: t.sortOrder,
            dueDate: t.dueDate,
          })),
          providerName: `${line.provider.firstName} ${line.provider.lastName}`,
          payerName: payer.name,
        });
      }
    }
    const skippedCount = plan.reduce((n, l) => n + l.skips.length, 0);
    const result = await generate.mutateAsync({ location, entries });
    setGenResult({
      created: result.created.length,
      skipped: skippedCount,
      failed: result.failed.length,
    });
    if (result.failed.length > 0) {
      toast.error(`${result.failed.length} case(s) failed to create`);
    } else {
      toast.success(`Created ${result.created.length} case(s)`);
    }
  }

  if (locationQ.isLoading) {
    return <div className="h-32 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />;
  }
  if (!location) {
    return (
      <div className="p-8 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
        Launch not found.
      </div>
    );
  }

  const totalCreates = plan?.reduce((n, l) => n + l.creates.length, 0) ?? 0;
  const nothingConfigured =
    plan !== null && plan.every((l) => l.creates.length + l.skips.length === 0);
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
              <Button
                className="h-9 gap-2"
                onClick={() => {
                  setGenResult(null);
                  setPlan(null);
                  setGenOpen(true);
                  void buildPlan();
                }}
              >
                <Wand2 className="w-4 h-4" />
                Generate cases
              </Button>
            </div>
          ) : null
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        {status ? <StatusPill label={status.label} color={status.color} /> : null}
        {newState && location.state ? (
          <span className="inline-flex items-center gap-1.5 rounded-[var(--mp-radius-pill)] bg-mp-warn/15 px-2 py-0.5 text-[var(--mp-text-2xs)] font-bold tracking-wide text-[color:var(--mp-warn)]">
            NEW STATE — payer contracts for {location.state} may not exist yet
          </span>
        ) : null}
        {readiness && readiness.denominator > 0 ? (
          <span className="flex items-center gap-2">
            <span className="w-24">
              <ProgressBar value={readiness.inNetwork} max={readiness.denominator} />
            </span>
            <span className="tabular-nums text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
              {readiness.inNetwork} of {readiness.denominator} in-network
            </span>
          </span>
        ) : (
          <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
            No cases yet
          </span>
        )}
        {readiness?.contractGap && !newState && location.state ? (
          <span className="flex items-center gap-1 text-[var(--mp-text-xs)] text-[color:var(--mp-warn)]">
            <AlertTriangle className="w-3.5 h-3.5" />
            Contract gap in {location.state}
          </span>
        ) : null}
      </div>

      <section className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card overflow-hidden">
        <div className="border-b border-mp-border bg-mp-muted/60 px-4 py-2.5 text-[var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
          Providers ({linked.length})
        </div>
        {linked.length === 0 ? (
          <div className="px-4 py-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
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
                  <span className="flex-1 min-w-0 truncate text-[var(--mp-text-base)] font-medium text-[color:var(--mp-ink)]">
                    {p.firstName} {p.lastName}
                    {p.credentials ? (
                      <span className="ml-1.5 text-[var(--mp-text-xs)] font-normal text-[color:var(--mp-ink-faint)]">
                        {p.credentials}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
                    {pCases.length} {pCases.length === 1 ? "case" : "cases"} here
                  </span>
                  {countable.length > 0 ? (
                    <span className="flex items-center gap-2">
                      <span className="w-16">
                        <ProgressBar value={inNet} max={countable.length} />
                      </span>
                      <span className="tabular-nums text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)] whitespace-nowrap">
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
      {addOpen ? <AssignProviderDialog location={location} onClose={() => setAddOpen(false)} /> : null}

      {/* Generate cases */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate cases for {location.name}</DialogTitle>
          </DialogHeader>
          {genResult ? (
            <div className="text-[var(--mp-text-sm)] text-[color:var(--mp-ink)] space-y-1">
              <p>{genResult.created} created</p>
              <p>{genResult.skipped} skipped (already existed)</p>
              {genResult.failed > 0 ? (
                <p className="text-[color:var(--mp-danger)]">{genResult.failed} failed</p>
              ) : null}
            </div>
          ) : !location.state ? (
            <div className="py-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
              Set a state on this location before generating cases.
            </div>
          ) : planning || plan === null ? (
            <div className="py-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
              Resolving payers through routing rules…
            </div>
          ) : linked.length === 0 ? (
            <div className="py-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
              No providers are linked to this launch.
            </div>
          ) : nothingConfigured ? (
            <div className="py-6 text-center text-[var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
              No payers are configured for {location.state}. Nothing to generate.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-3">
              {plan.map((line) => (
                <div key={line.provider.id}>
                  <div className="text-[var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
                    {line.provider.firstName} {line.provider.lastName}
                  </div>
                  {line.creates.length === 0 && line.skips.length === 0 ? (
                    <div className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
                      Nothing to create.
                    </div>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {line.creates.map((p) => (
                        <li
                          key={p.id}
                          className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]"
                        >
                          + {p.name} · {location.state}
                          {p.name === PRE_CRED_PAYER_NAME ? " (pre-cred)" : ""}
                        </li>
                      ))}
                      {line.skips.map(({ payer, reason }) => (
                        <li
                          key={payer.id}
                          className="text-[var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] line-through"
                        >
                          {payer.name} — {reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)}>
              {genResult ? "Close" : "Cancel"}
            </Button>
            {!genResult && plan !== null && totalCreates > 0 ? (
              <Button disabled={generate.isPending} onClick={() => void confirmGenerate()}>
                {generate.isPending ? "Creating…" : `Create ${totalCreates} case(s)`}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
