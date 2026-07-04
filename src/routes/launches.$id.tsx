// Launch detail (M4): linked providers with case rollups, provider attach,
// and the explicit generate-cases flow — preview first, then confirm. Cases
// and SOP checklists are created through the existing createCase service path
// (create_case_with_tasks RPC), so audit and task seeding match manual
// creation exactly. Idempotent: existing provider-payer-state combos skip.
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { AlertTriangle, Plus, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/triage/StatusPill";
import { ProgressBar } from "@/components/triage/ProgressBar";
import { useLaunch, useAttachProviderToLaunch, useGenerateLaunchCases } from "@/hooks/useLaunches";
import { useProviders } from "@/hooks/useProviders";
import { useCases } from "@/hooks/useCases";
import { useContracts } from "@/hooks/useContracts";
import { usePayers, useStatusConfigs, useMsos, useTemplates } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import { getMsoRoutingRule } from "@/services/lookups";
import { resolveTemplate } from "@/lib/sopResolver";
import { useCanWrite } from "@/lib/permissions";
import { LAUNCH_STATUS_META } from "@/lib/launchDisplay";
import { launchReadiness, isNewState } from "@/lib/launchReadiness";
import type { GenerationEntry } from "@/services/launches";
import type { Launch, Payer, Provider, SOPTemplate } from "@/types";

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
  const launchQ = useLaunch(id);
  const providersQ = useProviders();
  const casesQ = useCases();
  const contractsQ = useContracts();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs();
  const groupsQ = useProviderGroups();
  const msosQ = useMsos();
  const templatesQ = useTemplates();
  const attach = useAttachProviderToLaunch();
  const generate = useGenerateLaunchCases();

  const [addOpen, setAddOpen] = useState(false);
  const [addProviderId, setAddProviderId] = useState(NONE);
  const [genOpen, setGenOpen] = useState(false);
  const [plan, setPlan] = useState<PlanLine[] | null>(null);
  const [planning, setPlanning] = useState(false);
  const [genResult, setGenResult] = useState<{
    created: number;
    skipped: number;
    failed: number;
  } | null>(null);

  const launch = launchQ.data ?? null;

  const linked = useMemo(
    () => (providersQ.data ?? []).filter((p) => p.launchId === id),
    [providersQ.data, id],
  );
  const unlinked = useMemo(
    () => (providersQ.data ?? []).filter((p) => p.launchId !== id && p.status !== "terminated"),
    [providersQ.data, id],
  );

  const statusById = useMemo(
    () => new Map((statusConfigsQ.data ?? []).map((s) => [s.id, s])),
    [statusConfigsQ.data],
  );
  const payerById = useMemo(
    () => new Map((payersQ.data ?? []).map((p) => [p.id, p])),
    [payersQ.data],
  );
  const preCredPayer = useMemo(
    () => (payersQ.data ?? []).find((p) => p.name === PRE_CRED_PAYER_NAME) ?? null,
    [payersQ.data],
  );

  const contracted = useMemo(
    () =>
      new Set(
        (contractsQ.data ?? [])
          .filter(
            (c) => launch && c.groupId === launch.groupId && c.state === launch.state && c.payerId,
          )
          .map((c) => c.payerId as string),
      ),
    [contractsQ.data, launch],
  );

  const readiness = useMemo(() => {
    if (!launch) return null;
    const linkedIds = new Set(linked.map((p) => p.id));
    return launchReadiness({
      cases: (casesQ.data ?? [])
        .filter((c) => linkedIds.has(c.providerId))
        .map((c) => ({
          statusLabel: c.credentialingStatusId
            ? (statusById.get(c.credentialingStatusId)?.label ?? null)
            : null,
          isPreCred: payerById.get(c.payerId)?.name === PRE_CRED_PAYER_NAME,
        })),
      activePayerIds: (payersQ.data ?? [])
        .filter((p) => p.isActive && p.name !== PRE_CRED_PAYER_NAME)
        .map((p) => p.id),
      contractedPayerIdsInState: contracted,
    });
  }, [launch, linked, casesQ.data, statusById, payerById, payersQ.data, contracted]);

  async function buildPlan() {
    if (!launch) return;
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
              launch.orgId,
              payer.id,
              launch.state,
              provider.specialty ?? "",
            ] as const,
            queryFn: () => getMsoRoutingRule(payer.id, launch.state, provider.specialty ?? null),
          });
          if (rule) resolved.push(payer);
        }
        const candidates = resolved.length > 0 && preCredPayer ? [preCredPayer, ...resolved] : [];
        for (const payer of candidates) {
          const exists = cases.some(
            (c) =>
              c.providerId === provider.id && c.payerId === payer.id && c.state === launch.state,
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
    if (!launch || !plan) return;
    const group = (groupsQ.data ?? []).find((g) => g.id === launch.groupId) ?? null;
    const entries: GenerationEntry[] = [];
    for (const line of plan) {
      for (const payer of line.creates) {
        const isPreCred = payer.name === PRE_CRED_PAYER_NAME;
        const rule = isPreCred
          ? null
          : await getMsoRoutingRule(payer.id, launch.state, line.provider.specialty ?? null);
        const msoId = rule?.routeType === "mso" ? (rule.msoId ?? null) : null;
        const mso = msoId ? ((msosQ.data ?? []).find((m) => m.id === msoId) ?? null) : null;
        const template = pickTemplate(
          templatesQ.data ?? [],
          payer.id,
          launch.state,
          line.provider.groupId ?? null,
        );
        const tasks = template
          ? resolveTemplate(template, line.provider, group, null, mso ? { mso } : null, null)
          : [];
        entries.push({
          input: {
            providerId: line.provider.id,
            payerId: payer.id,
            state: launch.state,
            groupId: line.provider.groupId ?? launch.groupId,
            facilityId: launch.facilityId,
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
    const result = await generate.mutateAsync({ launch, entries });
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

  if (launchQ.isLoading) {
    return <div className="h-32 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />;
  }
  if (!launch) {
    return (
      <div className="p-8 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
        Launch not found.
      </div>
    );
  }

  const meta = LAUNCH_STATUS_META[launch.status];
  const director = launch.clinicDirectorProviderId
    ? ((providersQ.data ?? []).find((p) => p.id === launch.clinicDirectorProviderId) ?? null)
    : null;
  const directorLabel = director
    ? `${director.firstName} ${director.lastName}`
    : (launch.clinicDirectorName ?? "—");
  const newState = isNewState(contracted);
  const totalCreates = plan?.reduce((n, l) => n + l.creates.length, 0) ?? 0;
  const nothingConfigured =
    plan !== null && plan.every((l) => l.creates.length + l.skips.length === 0);

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={launch.name}
        description={[
          launch.gymName,
          [launch.city, launch.state].filter(Boolean).join(", "),
          launch.confirmedStartDate
            ? `starts ${format(parseISO(launch.confirmedStartDate), "MMM d, yyyy")}`
            : launch.targetMonth
              ? `target ${format(parseISO(launch.targetMonth), "MMM yyyy")}`
              : null,
          `Director: ${directorLabel}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          canWrite ? (
            <div className="flex items-center gap-2">
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
        <StatusPill label={meta.label} color={meta.color} />
        {newState ? (
          <StatusPill
            label="New state"
            color="var(--mp-warn)"
            suffix={`no group contracts in ${launch.state}`}
          />
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
        ) : null}
        {readiness?.contractGap && !newState ? (
          <span className="flex items-center gap-1 text-[length:var(--mp-text-xs)] text-[color:var(--mp-warn)]">
            <AlertTriangle className="w-3.5 h-3.5" />
            Contract gap in {launch.state}
          </span>
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
              const pCases = (casesQ.data ?? []).filter((c) => c.providerId === p.id);
              const countable = pCases.filter(
                (c) => payerById.get(c.payerId)?.name !== PRE_CRED_PAYER_NAME,
              );
              const inNet = countable.filter(
                (c) =>
                  c.credentialingStatusId &&
                  statusById.get(c.credentialingStatusId)?.label === "In-Network",
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
                  <span className="flex-1 min-w-0 truncate text-[length:var(--mp-text-sm)] font-medium text-[color:var(--mp-ink)]">
                    {p.firstName} {p.lastName}
                    {p.credentials ? (
                      <span className="ml-1.5 text-[length:var(--mp-text-xs)] font-normal text-[color:var(--mp-ink-faint)]">
                        {p.credentials}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]">
                    {pCases.length} {pCases.length === 1 ? "case" : "cases"}
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

      {/* Add provider */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add provider to {launch.name}</DialogTitle>
          </DialogHeader>
          <Select value={addProviderId} onValueChange={setAddProviderId}>
            <SelectTrigger>
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Select provider…</SelectItem>
              {unlinked.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={addProviderId === NONE || attach.isPending}
              onClick={async () => {
                await attach.mutateAsync({ providerId: addProviderId, launchId: launch.id });
                setAddProviderId(NONE);
                setAddOpen(false);
                toast.success("Provider linked");
              }}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generate cases */}
      <Dialog open={genOpen} onOpenChange={setGenOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate cases for {launch.name}</DialogTitle>
          </DialogHeader>
          {genResult ? (
            <div className="text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink)] space-y-1">
              <p>{genResult.created} created</p>
              <p>{genResult.skipped} skipped (already existed)</p>
              {genResult.failed > 0 ? (
                <p className="text-[color:var(--mp-danger)]">{genResult.failed} failed</p>
              ) : null}
            </div>
          ) : planning || plan === null ? (
            <div className="py-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
              Resolving payers through routing rules…
            </div>
          ) : linked.length === 0 ? (
            <div className="py-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
              No providers are linked to this launch.
            </div>
          ) : nothingConfigured ? (
            <div className="py-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-secondary)]">
              No payers are configured for {launch.state}. Nothing to generate.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-3">
              {plan.map((line) => (
                <div key={line.provider.id}>
                  <div className="text-[length:var(--mp-text-sm)] font-semibold text-[color:var(--mp-ink)]">
                    {line.provider.firstName} {line.provider.lastName}
                  </div>
                  {line.creates.length === 0 && line.skips.length === 0 ? (
                    <div className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)]">
                      Nothing to create.
                    </div>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {line.creates.map((p) => (
                        <li
                          key={p.id}
                          className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-secondary)]"
                        >
                          + {p.name} · {launch.state}
                          {p.name === PRE_CRED_PAYER_NAME ? " (pre-cred)" : ""}
                        </li>
                      ))}
                      {line.skips.map(({ payer, reason }) => (
                        <li
                          key={payer.id}
                          className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] line-through"
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
