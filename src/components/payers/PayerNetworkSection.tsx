// Payer Network wizard section body (E1.5) — the second R3 preview to go
// live. Org-level intent over a curated shortlist: the picker offers ONLY
// payers the org is subscribed to via org_payer_assignments (F1.5.1 — never
// the full catalog), the system expands intent into group×state targets for
// review (F1.5.2, pure src/lib/payerExpansion.ts), and removal archives with
// one-click restore (F1.5.3 — history kept, deny-then-reapply supported).
// "New expansion available" is DERIVED by diffing the current expansion
// against existing targets (TE-7 — no stored flag). Writes are admin-only
// (RLS enforces it; the UI gates on useIsAdmin).
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArchiveRestore, ArrowRight, Building2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/components/StatusPill";
import { AttachPayerDialog } from "@/components/payers/AttachPayerDialog";
import { payerMetaSummary } from "@/components/payers/payerDisplay";
import { openSection } from "@/components/onboarding/openSection";
import { usePayers } from "@/hooks/useAdmin";
import { useOrgPayerAssignments } from "@/hooks/useOrgPayerAssignments";
import {
  useArchivePayerTargets,
  useArchiveTarget,
  useRestoreTarget,
} from "@/hooks/usePayerNetworkTargets";
import { useIsAdmin } from "@/lib/permissions";
import { expandTargets, newExpansionRows } from "@/lib/payerExpansion";
import { ONBOARDING_SECTIONS } from "@/lib/onboardingProgress";
import type { Payer } from "@/types";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

const FACILITIES_DEF = ONBOARDING_SECTIONS.find((s) => s.key === "facilities");

interface DialogState {
  initialPayerId: string | null;
}

export function PayerNetworkSection({ wizard }: SectionBodyProps) {
  const payersQ = usePayers();
  const assignmentsQ = useOrgPayerAssignments();
  const isAdmin = useIsAdmin();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const archiveTargetMut = useArchiveTarget();
  const archivePayerMut = useArchivePayerTargets();
  const restoreMut = useRestoreTarget();

  const targets = wizard.payerNetworkTargets;
  const groupNameById = new Map(wizard.providerGroups.map((g) => [g.id, g.name]));

  // The curated shortlist (F1.5.1/TE-4): listPayers returns own-org rows plus
  // ASSIGNED global rows, intersected here with org_payer_assignments so an
  // unassigned payer is never offered — the subscription layer, not the
  // catalog, defines what this org attaches from.
  const curated = useMemo(() => {
    const assignedIds = new Set((assignmentsQ.data ?? []).map((a) => a.payerId));
    return (payersQ.data ?? []).filter((p) => assignedIds.has(p.id));
  }, [payersQ.data, assignmentsQ.data]);

  const activeTargetPayerIds = new Set(
    targets.filter((t) => t.status === "active").map((t) => t.payerId),
  );
  const attachedPayers = curated.filter((p) => activeTargetPayerIds.has(p.id));
  // Fresh AND fully-archived payers are both offered — attaching the latter
  // IS the re-attach flow (previously archived rows arrive pre-unchecked).
  const selectablePayers = curated.filter((p) => !activeTargetPayerIds.has(p.id));
  const archivedTargets = targets.filter((t) => t.status === "archived");

  // TE-7: rows the CURRENT facility set derives that no target row covers.
  const freshRowsByPayer = useMemo(() => {
    const map = new Map<string, number>();
    for (const payer of curated) {
      const expansion = expandTargets({
        payerStates: payer.states,
        groups: wizard.providerGroups,
        facilities: wizard.facilities,
      });
      const fresh = newExpansionRows(
        expansion,
        targets.filter((t) => t.payerId === payer.id),
      );
      if (fresh.length > 0) map.set(payer.id, fresh.length);
    }
    return map;
  }, [curated, targets, wizard.providerGroups, wizard.facilities]);

  if (payersQ.isLoading || assignmentsQ.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-16 rounded-md" />
      </div>
    );
  }

  if (payersQ.isError || assignmentsQ.isError) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3">
        <span className="text-[13px] text-[#B91C1C]">We couldn't load the payer shortlist.</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (payersQ.isError) payersQ.refetch();
            if (assignmentsQ.isError) assignmentsQ.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (curated.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <p className="text-[13px] text-muted-foreground">
          No payers are enabled for this organization yet. The Minted team curates the payer
          shortlist during onboarding; once payers are enabled they appear here to attach.
        </p>
      </div>
    );
  }

  const hasFacilityStates = wizard.facilities.some((f) => f.isActive && f.groupId && f.state);
  const archiveTargetRow = (id: string, payerName: string, state: string) =>
    archiveTargetMut.mutate(id, {
      onSuccess: () => toast.success(`Archived ${payerName} in ${state}`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't archive the target"),
    });

  return (
    <div className="space-y-4">
      {attachedPayers.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Attach the payers this organization intends to pursue. The system expands each payer into
          group and state targets based on where your facilities are — you review the expansion
          before anything is saved.
        </p>
      ) : (
        <ul className="space-y-2">
          {attachedPayers.map((payer) => {
            const payerTargets = targets.filter(
              (t) => t.payerId === payer.id && t.status === "active",
            );
            const freshCount = freshRowsByPayer.get(payer.id);
            const meta = payerMetaSummary(payer);
            return (
              <li key={payer.id} className="rounded-md border border-[#E8E5E0] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-foreground">{payer.name}</span>
                    {meta ? (
                      <span className="ml-2 text-[12px] text-muted-foreground">{meta}</span>
                    ) : null}
                    {freshCount ? (
                      <span className="ml-2 align-middle">
                        <StatusPill status="amber" label="New expansion available" />
                      </span>
                    ) : null}
                  </div>
                  {isAdmin ? (
                    <div className="flex flex-none items-center gap-2">
                      {freshCount ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => setDialog({ initialPayerId: payer.id })}
                        >
                          Review new expansion
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        aria-label={`Archive ${payer.name} attachment`}
                        disabled={archivePayerMut.isPending}
                        onClick={() =>
                          archivePayerMut.mutate(payer.id, {
                            onSuccess: (rows) =>
                              toast.success(
                                `Archived ${payer.name} (${rows.length} ${rows.length === 1 ? "target" : "targets"})`,
                              ),
                            onError: (e) =>
                              toast.error(
                                e instanceof Error ? e.message : "Couldn't archive the payer",
                              ),
                          })
                        }
                      >
                        Archive payer
                      </Button>
                    </div>
                  ) : null}
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {payerTargets.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-1.5 rounded-[4px] bg-[var(--mp-neutral-tint)] px-2 py-1 text-[12px] text-[var(--mp-neutral-ink)]"
                    >
                      <span>
                        {groupNameById.get(t.groupId) ?? "Unknown group"} · {t.state}
                      </span>
                      {isAdmin ? (
                        <button
                          type="button"
                          aria-label={`Archive ${payer.name} target for ${groupNameById.get(t.groupId) ?? "group"} in ${t.state}`}
                          disabled={archiveTargetMut.isPending}
                          onClick={() => archiveTargetRow(t.id, payer.name, t.state)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {isAdmin ? (
          <Button
            className="bg-[#1B4D3E]"
            onClick={() => setDialog({ initialPayerId: null })}
            disabled={selectablePayers.length === 0}
          >
            Attach payer
          </Button>
        ) : null}
        {archivedTargets.length > 0 ? (
          <Button variant="outline" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide archived" : `Archived (${archivedTargets.length})`}
          </Button>
        ) : null}
      </div>

      {!hasFacilityStates && FACILITIES_DEF ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[13px] text-muted-foreground">
            Targets derive from where each group's facilities are — add facilities first and the
            expansion fills in.
          </p>
          <Button variant="outline" onClick={() => openSection(FACILITIES_DEF)}>
            <ArrowRight className="h-4 w-4" />
            Go to Facilities
          </Button>
        </div>
      ) : null}

      {showArchived && archivedTargets.length > 0 ? (
        <ul className="space-y-1.5">
          {archivedTargets.map((t) => {
            const payer = curated.find((p) => p.id === t.payerId);
            return (
              <li
                key={t.id}
                className="flex h-10 items-center justify-between gap-3 rounded-md border border-[#E8E5E0] px-3"
              >
                <span className="min-w-0 truncate text-[13px] text-muted-foreground">
                  {payer?.name ?? "Payer"} — {groupNameById.get(t.groupId) ?? "Unknown group"} ·{" "}
                  {t.state}
                </span>
                {isAdmin ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-none px-2 text-[11px]"
                    aria-label={`Restore ${payer?.name ?? "payer"} target for ${t.state}`}
                    disabled={restoreMut.isPending}
                    onClick={() =>
                      restoreMut.mutate(t.id, {
                        onSuccess: () => toast.success("Target restored"),
                        onError: (e) =>
                          toast.error(
                            e instanceof Error ? e.message : "Couldn't restore the target",
                          ),
                      })
                    }
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    Restore
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {dialog ? (
        <AttachPayerDialog
          wizard={wizard}
          payers={curated}
          selectablePayers={selectablePayers}
          targets={targets}
          initialPayerId={dialog.initialPayerId}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
