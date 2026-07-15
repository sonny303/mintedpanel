// E4.0 F4.0.1–F4.0.4 — the payer-pipeline control on case detail: the state
// badge (distinct from the internal credentialing pill), last-updated
// attribution, and the transition menu offering only the LEGAL next states,
// with the admin-only correction path. Self-contained: owns the dialogs, the
// atomic advance_payer_pipeline mutation, the optional submit-time tracking-ID
// write, and the RFI→task bridge follow-up. Writers only; billing sees the
// badge + attribution read-only (no menu).
import { useState } from "react";
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
import { PayerPipelineBadge } from "./PayerPipelineBadge";
import {
  ApprovalDialog,
  CorrectionDialog,
  DenialDialog,
  OonDialog,
  RfiTaskBridgeDialog,
  TransitionConfirmDialog,
  type ApprovalValues,
  type CorrectionValues,
  type DenialValues,
  type TransitionConfirmValues,
} from "./PipelineDialogs";
import {
  allowedTransitions,
  isTerminalPipelineState,
  pipelineLabel,
  type PayerPipelineState,
} from "@/lib/payerPipeline";
import { useAdvancePayerPipeline, useSetPayerReference } from "@/hooks/useCases";
import { useCreateFollowUpTask } from "@/hooks/useTasks";
import { useLogTouch } from "@/hooks/useTouches";
import { PipelineTransitionError, type AdvancePipelineInput } from "@/services/cases";
import type { TouchInput } from "@/services/touches";
import { retryTouchOnly, runTransitionWithTouch } from "@/lib/actionBridge";
import type { CaseDetail, DenialReasonCode } from "@/types";

const TERMINAL_TARGETS: readonly PayerPipelineState[] = ["approved", "denied", "oon"];

type DialogState =
  | { kind: "transition"; target: PayerPipelineState }
  | { kind: "approve" }
  | { kind: "deny" }
  | { kind: "oon" }
  | { kind: "correct" }
  | { kind: "rfiTask"; reasonLabel: string | null }
  | null;

export function PayerPipelineControl({
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
  // Default an absent state (narrow/mock case objects) to the DB default so the
  // control never calls allowedTransitions(undefined); the real getCase always
  // provides it.
  const state = c.payerPipelineState ?? "not_started";
  const [dialog, setDialog] = useState<DialogState>(null);

  const advanceM = useAdvancePayerPipeline();
  const setReferenceM = useSetPayerReference();
  const createTaskM = useCreateFollowUpTask();
  const logTouchM = useLogTouch();

  // E4.1 F4.1.8 — retry ONLY the touch after a successful transition whose touch
  // failed (the transition is never re-run).
  async function retryTouch(input: TouchInput) {
    const r = await retryTouchOnly(
      { logTouch: (i: TouchInput) => logTouchM.mutateAsync({ caseId: c.id, input: i }) },
      input,
    );
    if (r.touch === "logged") toast.success("Touch logged");
    else handleError(r.touchError);
  }

  const latest = [...(c.payerPipelineHistory ?? [])].sort((a, b) =>
    b.changedAt.localeCompare(a.changedAt),
  )[0];

  const targets = allowedTransitions(state);
  const advanceTargets = targets.filter((t) => !TERMINAL_TARGETS.includes(t));
  const closeTargets = targets.filter((t) => TERMINAL_TARGETS.includes(t));

  function handleError(e: unknown) {
    if (e instanceof PipelineTransitionError) {
      toast.error(e.message);
    } else {
      toast.error((e as Error).message);
    }
  }

  function openTargetDialog(target: PayerPipelineState) {
    if (target === "approved") setDialog({ kind: "approve" });
    else if (target === "denied") setDialog({ kind: "deny" });
    else if (target === "oon") setDialog({ kind: "oon" });
    else setDialog({ kind: "transition", target });
  }

  // Generic forward transition (assigned/drafting/submitted/in_review/RFI/reapply).
  // F4.1.8 Action Bridge: sequence the transition, then (only on success) the
  // optional touch. A failed transition writes no touch; a failed touch after a
  // successful transition offers a touch-only retry — never re-runs the move.
  async function confirmTransition(target: PayerPipelineState, v: TransitionConfirmValues) {
    const result = await runTransitionWithTouch(
      {
        advance: (args: AdvancePipelineInput) => advanceM.mutateAsync(args),
        logTouch: (input: TouchInput) => logTouchM.mutateAsync({ caseId: c.id, input }),
      },
      {
        advanceArgs: {
          caseId: c.id,
          toState: target,
          expectedState: state,
          reasonCodeId: v.reasonCodeId ?? null,
        },
        touchArgs: v.touch ?? null,
      },
    );
    if (result.transition === "failed") {
      handleError(result.transitionError);
      return;
    }
    // Transition succeeded. Submit-time tracking ID is a separate audited write.
    if (target === "submitted" && v.trackingId) {
      try {
        await setReferenceM.mutateAsync({ caseId: c.id, value: v.trackingId });
      } catch (e) {
        handleError(e);
      }
    }
    if (result.touch === "failed") {
      toast.error("Pipeline moved, but logging the touch failed.", {
        action: { label: "Retry touch", onClick: () => void retryTouch(v.touch as TouchInput) },
      });
    } else if (result.touch === "logged") {
      toast.success(`Pipeline moved to ${pipelineLabel(target)} · touch logged`);
    } else {
      toast.success(`Pipeline moved to ${pipelineLabel(target)}`);
    }
    // RFI→task bridge: offer to spawn an internal task so the case never stalls.
    if (target === "action_required") {
      const reasonLabel = v.reasonCodeId
        ? (reasonCodes.find((r) => r.id === v.reasonCodeId)?.label ?? null)
        : null;
      setDialog({ kind: "rfiTask", reasonLabel });
    } else {
      setDialog(null);
    }
  }

  async function confirmApproval(v: ApprovalValues) {
    try {
      await advanceM.mutateAsync({
        caseId: c.id,
        toState: "approved",
        expectedState: state,
        effectiveDate: v.effectiveDate,
        individualProviderId: v.individualProviderId,
        groupProviderId: v.groupProviderId,
      });
      toast.success("Case approved");
      setDialog(null);
    } catch (e) {
      handleError(e);
    }
  }

  async function confirmDenial(v: DenialValues) {
    try {
      await advanceM.mutateAsync({
        caseId: c.id,
        toState: "denied",
        expectedState: state,
        reasonCodeId: v.reasonCodeId,
        justification: v.context,
      });
      toast.success("Case denied");
      setDialog(null);
    } catch (e) {
      handleError(e);
    }
  }

  async function confirmOon() {
    try {
      await advanceM.mutateAsync({ caseId: c.id, toState: "oon", expectedState: state });
      toast.success("Case closed Out-of-Network");
      setDialog(null);
    } catch (e) {
      handleError(e);
    }
  }

  async function confirmCorrection(v: CorrectionValues) {
    try {
      await advanceM.mutateAsync({
        caseId: c.id,
        toState: v.toState,
        expectedState: state,
        isCorrection: true,
        justification: v.justification,
        reasonCodeId: v.reasonCodeId,
        effectiveDate: v.effectiveDate,
        individualProviderId: v.individualProviderId,
        groupProviderId: v.groupProviderId,
      });
      toast.success("Pipeline corrected");
      setDialog(null);
    } catch (e) {
      handleError(e);
    }
  }

  async function createRfiTask(title: string) {
    try {
      await createTaskM.mutateAsync({
        caseId: c.id,
        providerId: c.providerId,
        title,
        dueDate: null,
      });
      toast.success("Task created");
      setDialog(null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const saving = advanceM.isPending || setReferenceM.isPending || logTouchM.isPending;
  const hasMenu = canEdit && (targets.length > 0 || isAdmin);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
        Payer Pipeline
      </span>
      <div className="flex items-center gap-2">
        <PayerPipelineBadge state={state} />
        {hasMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-6 text-[11px] px-2">
                Update <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {advanceTargets.length > 0 ? (
                <>
                  <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Advance to
                  </DropdownMenuLabel>
                  {advanceTargets.map((t) => (
                    <DropdownMenuItem key={t} onSelect={() => openTargetDialog(t)}>
                      {state === "denied" && t === "drafting"
                        ? "Reapply (reopen at Drafting)"
                        : pipelineLabel(t)}
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
                      {pipelineLabel(t)}
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              {targets.length === 0 && !isAdmin ? (
                <DropdownMenuItem disabled>
                  {isTerminalPipelineState(state) ? "Case closed — no changes" : "No changes"}
                </DropdownMenuItem>
              ) : null}
              {isAdmin ? (
                <>
                  {targets.length > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuItem onSelect={() => setDialog({ kind: "correct" })}>
                    Correct state…
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {latest ? (
        <span className="text-[11px] text-muted-foreground">
          Updated by {latest.changedByName ?? "someone"} ·{" "}
          {formatDistanceToNow(parseISO(latest.changedAt), { addSuffix: true })}
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">No updates yet</span>
      )}

      {dialog?.kind === "transition" ? (
        <TransitionConfirmDialog
          open
          from={state}
          to={dialog.target}
          saving={saving}
          reasonCodes={reasonCodes}
          currentTrackingId={c.payerReferenceId}
          onConfirm={(v) => confirmTransition(dialog.target, v)}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "approve" ? (
        <ApprovalDialog
          open
          saving={saving}
          payer={c.payer}
          onConfirm={confirmApproval}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "deny" ? (
        <DenialDialog
          open
          saving={saving}
          reasonCodes={reasonCodes}
          onConfirm={confirmDenial}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "oon" ? (
        <OonDialog open saving={saving} onConfirm={confirmOon} onCancel={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === "correct" ? (
        <CorrectionDialog
          open
          saving={saving}
          currentState={state}
          reasonCodes={reasonCodes}
          payer={c.payer}
          onConfirm={confirmCorrection}
          onCancel={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "rfiTask" ? (
        <RfiTaskBridgeDialog
          open
          saving={createTaskM.isPending}
          defaultTitle={dialog.reasonLabel ? `RFI: ${dialog.reasonLabel}` : "Respond to payer RFI"}
          onCreate={createRfiTask}
          onSkip={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}
