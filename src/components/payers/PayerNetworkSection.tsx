// Payer Network wizard section body (E1.5) — OPA-RETIRE: the attach shortlist
// is the visible catalog (listPayers / globals), not org_payer_assignments.
// Each attachment is shown with its live group×state target chips. Archive is
// a status flip (per-target X or payer-level Archive; TE-5 — never a DELETE);
// archived targets sit in a collapsible view with one-click Restore, and a
// fully archived payer offers Re-attach (re-runs the expansion with archived
// rows pre-unchecked). "New expansion available" is DERIVED by re-running the
// pure expansion against current facilities (TE-7) — never a stored flag.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArchiveRestore, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/StatusPill";
import { AttachPayerDialog } from "@/components/payers/AttachPayerDialog";
import {
  useArchivePayerTargets,
  useArchiveTarget,
  useRestoreTarget,
} from "@/hooks/usePayerNetworkTargets";
import { expandTargets, newExpansionRows } from "@/lib/payerExpansion";
import { PRE_CRED_PAYER_NAME } from "@/lib/statusLabels";
import { PAYER_KIND_LABELS, formatStates } from "@/lib/payerDirectory";
import type { Payer, PayerNetworkTarget } from "@/types";
import type { SectionBodyProps } from "@/components/onboarding/sectionBodies";

interface DialogState {
  initialPayer: Payer | null;
}

export function PayerNetworkSection({ wizard }: SectionBodyProps) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const archiveTargetMut = useArchiveTarget();
  const archivePayerMut = useArchivePayerTargets();
  const restoreMut = useRestoreTarget();

  const groupById = new Map(wizard.providerGroups.map((g) => [g.id, g]));

  // OPA-RETIRE shortlist: active, non-archived catalog payers (globals via
  // widened payers_select). Retired/merged/Pre-Cred excluded.
  const shortlist = useMemo(
    () =>
      wizard.payers.filter(
        (p) =>
          p.name !== PRE_CRED_PAYER_NAME &&
          (p.status ?? "active") === "active" &&
          p.archivedAt == null,
      ),
    [wizard.payers],
  );
  const shortlistIds = useMemo(() => new Set(shortlist.map((p) => p.id)), [shortlist]);

  const targetsByPayer = useMemo(() => {
    const map = new Map<string, PayerNetworkTarget[]>();
    for (const t of wizard.payerNetworkTargets) {
      map.set(t.payerId, [...(map.get(t.payerId) ?? []), t]);
    }
    return map;
  }, [wizard.payerNetworkTargets]);

  const attached = shortlist.filter((p) =>
    (targetsByPayer.get(p.id) ?? []).some((t) => t.status === "active"),
  );
  const pickerPayers = shortlist.filter(
    (p) => !(targetsByPayer.get(p.id) ?? []).some((t) => t.status === "active"),
  );
  // Archived targets for payers still on the shortlist (active + not
  // catalog-archived). A catalog-archived payer drops out of shortlistIds, so
  // its targets leave the wizard until reactivation.
  const archivedTargets = wizard.payerNetworkTargets.filter(
    (t) => t.status === "archived" && shortlistIds.has(t.payerId),
  );

  if (shortlist.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-[13px] text-muted-foreground">
          No payers in the catalog yet. Set up a payer first, then attach it here to record which
          networks each group is pursuing.
        </p>
        <Button asChild size="sm" className="h-8 bg-[#1B4D3E] px-3 text-[12px] text-white">
          <Link to="/admin/payers/new">Set up a payer</Link>
        </Button>
      </div>
    );
  }

  const targetLabel = (t: PayerNetworkTarget) =>
    `${groupById.get(t.groupId)?.name ?? "Unknown group"} × ${t.state}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          Attach the payers this organization is pursuing — the system expands each into group and
          state targets for review.
        </p>
        <Button
          className="flex-none bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          size="sm"
          onClick={() => setDialog({ initialPayer: null })}
        >
          <Plus className="h-4 w-4" />
          Attach payer
        </Button>
      </div>

      {attached.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No payers attached yet. {shortlist.length} enabled payer
          {shortlist.length === 1 ? " is" : "s are"} ready to attach.
        </p>
      ) : (
        <ul className="space-y-2">
          {attached.map((p) => {
            const targets = targetsByPayer.get(p.id) ?? [];
            const active = targets.filter((t) => t.status === "active");
            // TE-7: derived, never stored — re-run the expansion and diff.
            const fresh = newExpansionRows(
              expandTargets(p.states, wizard.providerGroups, wizard.facilities),
              targets,
            );
            return (
              <li key={p.id} className="rounded-md border border-[#E8E5E0] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-[13px] font-medium text-foreground">{p.name}</span>
                    <span className="ml-2 text-[12px] text-muted-foreground">
                      {PAYER_KIND_LABELS[p.payerKind ?? "commercial"]} · {formatStates(p.states)}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 flex-none px-2 text-[11px]"
                    disabled={archivePayerMut.isPending}
                    onClick={() =>
                      archivePayerMut.mutate(p.id, {
                        onSuccess: () => toast.success(`${p.name} archived`),
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
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {active.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center gap-1.5 rounded-[4px] bg-[var(--mp-neutral-tint)] px-2 py-1 text-[12px] text-[var(--mp-neutral-ink)]"
                    >
                      <span>{targetLabel(t)}</span>
                      <button
                        type="button"
                        aria-label={`Archive target ${targetLabel(t)} for ${p.name}`}
                        disabled={archiveTargetMut.isPending}
                        onClick={() =>
                          archiveTargetMut.mutate(t.id, {
                            onSuccess: () => toast.success("Target archived"),
                            onError: (e) =>
                              toast.error(
                                e instanceof Error ? e.message : "Couldn't archive the target",
                              ),
                          })
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
                {fresh.length > 0 ? (
                  <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-[#FDE68A] bg-[#FEF3C7] px-3 py-1.5 text-[12px] text-[#92400E]">
                    <span>
                      New expansion available — {fresh.length} group/state
                      {fresh.length === 1 ? " row" : " rows"} not yet targeted.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 flex-none px-2 text-[11px]"
                      onClick={() => setDialog({ initialPayer: p })}
                    >
                      Review
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {archivedTargets.length > 0 ? (
        <div className="space-y-2">
          <button
            type="button"
            className="text-[12px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide archived" : `Show archived (${archivedTargets.length})`}
          </button>
          {showArchived ? (
            <ul className="space-y-1.5">
              {archivedTargets.map((t) => {
                const payer = wizard.payers.find((p) => p.id === t.payerId);
                const fullyArchived = !(targetsByPayer.get(t.payerId) ?? []).some(
                  (x) => x.status === "active",
                );
                return (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-[#E8E5E0] px-3 py-1.5"
                  >
                    <div className="min-w-0 text-[12px] text-muted-foreground">
                      <span className="text-foreground">{payer?.name ?? "Unknown payer"}</span> —{" "}
                      {targetLabel(t)} <StatusPill status="neutral" label="Archived" />
                    </div>
                    <div className="flex flex-none items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-[11px]"
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
                        <ArchiveRestore className="h-3 w-3" />
                        Restore
                      </Button>
                      {fullyArchived && payer ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setDialog({ initialPayer: payer })}
                        >
                          Re-attach payer
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {dialog ? (
        <AttachPayerDialog
          wizard={wizard}
          pickerPayers={pickerPayers}
          initialPayer={dialog.initialPayer}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
