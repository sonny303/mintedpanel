// Create cases from a launch (launch PRD v2.1): prefilled provider +
// location, admin picks payers from a checklist of the group's payer list
// ordered by MSO routing (pre-cred first, then direct, then MSO-routed, then
// unconfigured). One case per selected payer, each linked to the location via
// credential_cases.facility_id. Payers the provider already holds a case with
// in this state are shown disabled — the (provider, payer, state) key is
// unique. Creation runs through the existing createCase path
// (create_case_with_tasks RPC) so audit rows and SOP task seeding behave
// exactly like manual creation.
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useCases } from "@/hooks/useCases";
import { usePayers, useMsos, useSops } from "@/hooks/useAdmin";
import { useProviderGroups } from "@/hooks/useLookups";
import { useGenerateLaunchCases } from "@/hooks/useLaunches";
import { getMsoRoutingRule } from "@/services/lookups";
import { resolveTemplate } from "@/lib/sopResolver";
import { PRE_CRED_PAYER_NAME } from "@/lib/statusLabels";
import type { GenerationEntry } from "@/services/launches";
import type { Facility, MsoRoutingRule, Provider, SOPTemplate } from "@/types";

// Same matcher as NewCaseModal.pickTemplate — duplicated because the modal
// keeps it module-local and lib code must not import from components.
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

interface ChecklistRow {
  payerId: string;
  payerName: string;
  isPreCred: boolean;
  /** resolved routing rule; null = no routing configured for this state */
  rule: MsoRoutingRule | null;
  msoName: string | null;
  caseExists: boolean;
}

export function CreateCasesDialog({
  location,
  linkedProviders,
  onClose,
}: {
  location: Facility;
  linkedProviders: Provider[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const casesQ = useCases();
  const payersQ = usePayers();
  const msosQ = useMsos();
  const templatesQ = useSops();
  const groupsQ = useProviderGroups();
  const generate = useGenerateLaunchCases();

  const [providerChoice, setProviderChoice] = useState("");
  const [rows, setRows] = useState<ChecklistRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ created: number; failed: number } | null>(null);

  // Derived so a dialog mounted before the assignments query settles (the
  // ?createCases=true deep link) still picks up the first linked provider.
  const providerId = providerChoice || (linkedProviders[0]?.id ?? "");
  const provider = linkedProviders.find((p) => p.id === providerId) ?? null;
  const state = location.state;

  useEffect(() => {
    let cancelled = false;
    async function buildChecklist() {
      setRows(null);
      if (!provider || !state) return;
      const activePayers = (payersQ.data ?? []).filter((p) => p.isActive);
      const cases = casesQ.data ?? [];
      const msoById = new Map((msosQ.data ?? []).map((m) => [m.id, m]));
      const built: ChecklistRow[] = [];
      for (const payer of activePayers) {
        const isPreCred = payer.name === PRE_CRED_PAYER_NAME;
        const rule = isPreCred
          ? null
          : await qc.fetchQuery({
              queryKey: [
                "mso-routing-rule",
                location.orgId,
                payer.id,
                state,
                provider.specialty ?? "",
              ] as const,
              queryFn: () => getMsoRoutingRule(payer.id, state, provider.specialty ?? null),
            });
        built.push({
          payerId: payer.id,
          payerName: payer.name,
          isPreCred,
          rule,
          msoName:
            rule?.routeType === "mso" && rule.msoId
              ? (msoById.get(rule.msoId)?.name ?? "MSO")
              : null,
          caseExists: cases.some(
            (c) => c.providerId === provider.id && c.payerId === payer.id && c.state === state,
          ),
        });
      }
      if (cancelled) return;
      // Group's payer list ordered by MSO routing: pre-cred, direct,
      // MSO-routed (by MSO name), then payers with no routing for this state.
      const bucket = (r: ChecklistRow) =>
        r.isPreCred ? 0 : r.rule?.routeType === "direct" ? 1 : r.rule ? 2 : 3;
      built.sort(
        (a, b) =>
          bucket(a) - bucket(b) ||
          (a.msoName ?? "").localeCompare(b.msoName ?? "") ||
          a.payerName.localeCompare(b.payerName),
      );
      setRows(built);
      // Suggest payers the provider isn't yet enrolled with here: routing
      // resolves (or pre-cred) and no case exists.
      setSelected(
        new Set(
          built
            .filter((r) => !r.caseExists && (r.isPreCred || r.rule !== null))
            .map((r) => r.payerId),
        ),
      );
    }
    void buildChecklist();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild only when the inputs that shape the checklist change
  }, [providerId, state, payersQ.data, casesQ.data, msosQ.data, linkedProviders.length]);

  function toggle(payerId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(payerId)) next.delete(payerId);
      else next.add(payerId);
      return next;
    });
  }

  async function createCases() {
    if (!provider || !state || !rows) return;
    const group = (groupsQ.data ?? []).find((g) => g.id === location.groupId) ?? null;
    const entries: GenerationEntry[] = [];
    for (const row of rows) {
      if (!selected.has(row.payerId) || row.caseExists) continue;
      const msoId = row.rule?.routeType === "mso" ? (row.rule.msoId ?? null) : null;
      const mso = msoId ? ((msosQ.data ?? []).find((m) => m.id === msoId) ?? null) : null;
      const template = pickTemplate(
        templatesQ.data ?? [],
        row.payerId,
        state,
        provider.groupId ?? null,
      );
      const tasks = template
        ? resolveTemplate(template, provider, group, location, mso ? { mso } : null, null)
        : [];
      entries.push({
        input: {
          providerId: provider.id,
          payerId: row.payerId,
          state,
          groupId: provider.groupId ?? location.groupId,
          facilityId: location.id,
          specialty: provider.specialty ?? null,
          msoId,
        },
        tasks: tasks.map((t) => ({
          title: t.title,
          description: t.description,
          sopContent: t.sopContent,
          sortOrder: t.sortOrder,
          dueDate: t.dueDate,
        })),
        providerName: `${provider.firstName} ${provider.lastName}`,
        payerName: row.payerName,
      });
    }
    const res = await generate.mutateAsync({ location, entries });
    setResult({ created: res.created.length, failed: res.failed.length });
    if (res.failed.length > 0) {
      toast.error(`${res.failed.length} case(s) failed to create`);
    } else {
      toast.success(`Created ${res.created.length} case(s)`);
    }
  }

  const selectableCount = (rows ?? []).filter(
    (r) => selected.has(r.payerId) && !r.caseExists,
  ).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create cases for {location.name}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink)] space-y-1">
            <p>{result.created} created</p>
            {result.failed > 0 ? (
              <p className="text-[color:var(--mp-danger)]">{result.failed} failed</p>
            ) : null}
          </div>
        ) : !state ? (
          <div className="py-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
            Set a state on this location before creating cases.
          </div>
        ) : linkedProviders.length === 0 ? (
          <div className="py-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
            No provider is assigned to this launch yet. Assign one first.
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-[length:var(--mp-text-xs)] font-medium text-[color:var(--mp-ink-secondary)]">
                Provider
              </div>
              <Select value={providerId} onValueChange={setProviderChoice}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {linkedProviders.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-1 text-[length:var(--mp-text-xs)] font-medium text-[color:var(--mp-ink-secondary)]">
                Payers · one case per selection, linked to {location.name}
              </div>
              {rows === null ? (
                <div className="py-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-ink-faint)]">
                  Resolving payers through routing rules…
                </div>
              ) : (
                <ul className="max-h-72 overflow-y-auto rounded-md border border-mp-border divide-y divide-[color:var(--mp-border)]">
                  {rows.map((r) => (
                    <li key={r.payerId} className="flex items-center gap-2.5 px-3 py-2">
                      <Checkbox
                        checked={selected.has(r.payerId) && !r.caseExists}
                        disabled={r.caseExists}
                        onCheckedChange={() => toggle(r.payerId)}
                        aria-label={`Select ${r.payerName}`}
                      />
                      <span
                        className={`flex-1 min-w-0 truncate text-[length:var(--mp-text-sm)] ${
                          r.caseExists
                            ? "text-[color:var(--mp-ink-faint)] line-through"
                            : "text-[color:var(--mp-ink)]"
                        }`}
                      >
                        {r.payerName}
                      </span>
                      <span className="text-[length:var(--mp-text-xs)] text-[color:var(--mp-ink-faint)] whitespace-nowrap">
                        {r.caseExists
                          ? "Case exists"
                          : r.isPreCred
                            ? "Pre-cred"
                            : r.msoName
                              ? `via ${r.msoName}`
                              : r.rule
                                ? "Direct"
                                : "No routing for this state"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {result ? "Close" : "Cancel"}
          </Button>
          {!result && state && linkedProviders.length > 0 ? (
            <Button
              disabled={generate.isPending || rows === null || selectableCount === 0}
              onClick={() =>
                createCases().catch((e: unknown) =>
                  toast.error(e instanceof Error ? e.message : "Case creation failed"),
                )
              }
            >
              {generate.isPending
                ? "Creating…"
                : `Create ${selectableCount} case${selectableCount === 1 ? "" : "s"}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
