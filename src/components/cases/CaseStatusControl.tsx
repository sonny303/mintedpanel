// E6.0 — THE case-status control: the one place a person moves a case's
// unified status. Canonical pill + last-change attribution + a legal-moves
// menu (spine-forward, RFI return, the three closes, reapply) + the evidence
// dialogs (Approved / Denied / Not Pursuing) + the admin-only append-only
// correction (F6.0.4). Replaces both the E4.0 PayerPipelineControl and the
// internal ChangeStatusDialog — one status, one control.
import { useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import {
  ApprovedDialog,
  DeniedDialog,
  NotPursuingDialog,
  StatusCorrectionDialog,
  StatusTransitionDialog,
} from "@/components/cases/CaseStatusDialogs";
import { useSetCaseStatus } from "@/hooks/useCases";
import { resolveReferenceProvenance } from "@/lib/referenceProvenance";
import { CaseStatusError } from "@/services/cases";
import {
  allowedCaseStatusTransitions,
  caseStatusLabel,
  isReapplyCaseTransition,
  isTerminalCaseStatus,
  type CaseStatus,
} from "@/lib/caseStatus";
import type { CaseDetail, DenialReasonCode } from "@/types";

type DialogState =
  | { kind: "transition"; to: CaseStatus }
  | { kind: "approved" }
  | { kind: "denied" }
  | { kind: "not_pursuing" }
  | { kind: "correct" }
  | null;

export function CaseStatusControl({
  c,
  reasonCodes,
  canEdit,
  isAdmin,
}: {
  c: CaseDetail;
  reasonCodes: DenialReasonCode[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const status = c.caseStatus;
  const setStatusM = useSetCaseStatus();
  const [dialog, setDialog] = useState<DialogState>(null);

  // S4.5 / C3: the stored payer reference + where it came from, so approving
  // doesn't mean retyping a number the Workbench already captured.
  const referenceProvenance = useMemo(
    () => resolveReferenceProvenance(c.payerReferenceId, c.touches),
    [c.payerReferenceId, c.touches],
  );

  const targets = allowedCaseStatusTransitions(status);
  const openTargets = targets.filter((t) => !isTerminalCaseStatus(t));
  const closeTargets = targets.filter((t) => isTerminalCaseStatus(t));

  const latest = useMemo(() => {
    const rows = c.caseStatusHistory ?? [];
    if (rows.length === 0) return null;
    return rows
      .slice()
      .sort((a, b) => parseISO(b.changedAt).getTime() - parseISO(a.changedAt).getTime())[0];
  }, [c.caseStatusHistory]);

  function handleError(e: unknown) {
    if (e instanceof CaseStatusError && e.code === "case_status_conflict") {
      toast.error(
        e.conflictStatus
          ? `This case is now ${caseStatusLabel(e.conflictStatus)} — refresh to continue.`
          : e.message,
      );
      return;
    }
    toast.error(e instanceof Error ? e.message : "Could not update the case status.");
  }

  function openTargetDialog(to: CaseStatus) {
    if (to === "approved") setDialog({ kind: "approved" });
    else if (to === "denied") setDialog({ kind: "denied" });
    else if (to === "not_pursuing") setDialog({ kind: "not_pursuing" });
    else setDialog({ kind: "transition", to });
  }

  async function confirm(input: Parameters<typeof setStatusM.mutateAsync>[0], done: string) {
    try {
      await setStatusM.mutateAsync(input);
      toast.success(done);
      setDialog(null);
    } catch (e) {
      handleError(e);
    }
  }

  const saving = setStatusM.isPending;
  const hasMenu = canEdit && (targets.length > 0 || isAdmin);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
        Status
      </span>
      <div className="flex items-center gap-2">
        <CaseStatusPill status={status} />
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-6 text-[11px] px-2">
                Update <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {openTargets.length > 0 ? (
                <>
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Move to
                  </DropdownMenuLabel>
                  {openTargets.map((t) => (
                    <DropdownMenuItem key={t} onSelect={() => openTargetDialog(t)}>
                      {isReapplyCaseTransition(status, t)
                        ? "Reapply (back to In Progress)"
                        : caseStatusLabel(t)}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              {closeTargets.length > 0 ? (
                <>
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Close as
                  </DropdownMenuLabel>
                  {closeTargets.map((t) => (
                    <DropdownMenuItem key={t} onSelect={() => openTargetDialog(t)}>
                      {caseStatusLabel(t)}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              {targets.length === 0 && !isAdmin ? (
                <DropdownMenuItem disabled>
                  {isTerminalCaseStatus(status) ? "Case closed — no changes" : "No changes"}
                </DropdownMenuItem>
              ) : null}
              {isAdmin ? (
                <>
                  {targets.length > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "correct" })}>
                    Correct status…
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {latest ? (
        <span className="text-[11px] text-muted-foreground">
          {latest.actorKind === "system"
            ? "Set by system"
            : `Updated by ${latest.changedByName ?? "someone"}`}{" "}
          · {formatDistanceToNow(parseISO(latest.changedAt), { addSuffix: true })}
        </span>
      ) : null}

      {dialog?.kind === "transition" ? (
        <StatusTransitionDialog
          open
          from={status}
          to={dialog.to}
          isReapply={isReapplyCaseTransition(status, dialog.to)}
          saving={saving}
          onCancel={() => setDialog(null)}
          onConfirm={({ note }) =>
            confirm(
              {
                caseId: c.id,
                toStatus: dialog.to,
                expectedStatus: status,
                note,
              },
              `Status updated — ${caseStatusLabel(dialog.to)}`,
            )
          }
        />
      ) : null}
      {dialog?.kind === "approved" ? (
        <ApprovedDialog
          open
          payer={c.payer}
          referenceProvenance={referenceProvenance}
          caseSummary={[
            c.provider ? `${c.provider.firstName} ${c.provider.lastName}`.trim() : null,
            c.payer?.name ?? null,
            c.state,
          ]
            .filter(Boolean)
            .join(" · ")}
          saving={saving}
          onCancel={() => setDialog(null)}
          onConfirm={(v) =>
            confirm(
              {
                caseId: c.id,
                toStatus: "approved",
                expectedStatus: status,
                effectiveDate: v.effectiveDate,
                individualProviderId: v.individualProviderId,
                groupProviderId: v.groupProviderId,
                contractExecutedDate: v.contractExecutedDate,
                // E6.8 F6.8.3 — the "Didn't receive" escape rides the RPC's
                // ack params; the acked ID stays NULL (Awaiting ID, derived).
                providerIdMissingAck: v.providerIdMissingAck,
                groupIdMissingAck: v.groupIdMissingAck,
              },
              "Case approved",
            )
          }
        />
      ) : null}
      {dialog?.kind === "denied" ? (
        <DeniedDialog
          open
          reasonCodes={reasonCodes}
          saving={saving}
          onCancel={() => setDialog(null)}
          onConfirm={(v) =>
            confirm(
              {
                caseId: c.id,
                toStatus: "denied",
                expectedStatus: status,
                reasonCodeId: v.reasonCodeId,
                note: v.context,
              },
              "Denial recorded",
            )
          }
        />
      ) : null}
      {dialog?.kind === "not_pursuing" ? (
        <NotPursuingDialog
          open
          saving={saving}
          onCancel={() => setDialog(null)}
          onConfirm={({ note }) =>
            confirm(
              {
                caseId: c.id,
                toStatus: "not_pursuing",
                expectedStatus: status,
                note,
              },
              "Marked Not Pursuing",
            )
          }
        />
      ) : null}
      {dialog?.kind === "correct" ? (
        <StatusCorrectionDialog
          open
          current={status}
          payer={c.payer}
          reasonCodes={reasonCodes}
          saving={saving}
          onCancel={() => setDialog(null)}
          onConfirm={(v) =>
            confirm(
              {
                caseId: c.id,
                toStatus: v.toStatus,
                expectedStatus: status,
                isCorrection: true,
                note: v.note,
                reasonCodeId: v.reasonCodeId,
                effectiveDate: v.effectiveDate,
                individualProviderId: v.individualProviderId,
                groupProviderId: v.groupProviderId,
              },
              "Correction recorded",
            )
          }
        />
      ) : null}
    </div>
  );
}
