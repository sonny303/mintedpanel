// E4.0 F4.0.1–F4.0.4 — the payer-pipeline transition dialogs. Each collects the
// inputs a target state needs and calls onConfirm; PayerPipelineControl owns the
// advance_payer_pipeline mutation, toasts, and the RFI→task follow-up. Stock
// shadcn compositions (Dialog/Select/Input/Textarea/DatePicker) styled by tokens.
import { useState } from "react";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/DatePicker";
import { PAYER_PIPELINE_STATES, pipelineLabel, type PayerPipelineState } from "@/lib/payerPipeline";
import { GROUP_PROVIDER_ID_LABEL, resolveIdentifierConfig } from "@/lib/payerResolutionIdentifier";
import { useOrgPayerSetting } from "@/hooks/useOrgPayerSettings";
import {
  initialPipelineTouchState,
  PipelineTouchSection,
  pipelineTouchBlocked,
  pipelineTouchInput,
  type PipelineTouchState,
} from "./PipelineTouchSection";
import type { TouchInput } from "@/services/touches";
import type { DenialReasonCode, Payer, TouchType } from "@/types";

const FIELD_LABEL = "text-[11px] uppercase tracking-wide text-muted-foreground";

function OtherContextHint() {
  return (
    <p className="text-[12px] text-muted-foreground">
      A short context is required when the reason is “Other”.
    </p>
  );
}

// ---- Reason-code select (shared by denial / RFI / correction) ----
function ReasonCodeSelect({
  reasonCodes,
  value,
  onChange,
  placeholder,
}: {
  reasonCodes: DenialReasonCode[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {reasonCodes.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---- Provider-ID fields (shared by approval / correction-to-approved) ----
function ProviderIdFields({
  payer,
  individualId,
  groupId,
  onIndividual,
  onGroup,
}: {
  payer: Payer | null;
  individualId: string;
  groupId: string;
  onIndividual: (v: string) => void;
  onGroup: (v: string) => void;
}) {
  // E4.2 governance: the org's own setting (org_payer_settings) wins, then the
  // Minted-curated global label on the payers row, then the generic default.
  const orgSetting = useOrgPayerSetting(payer?.id);
  const config = resolveIdentifierConfig(payer, orgSetting);
  return (
    <>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>{config.individualLabel} (individual)</Label>
        <Input
          value={individualId}
          onChange={(e) => onIndividual(e.target.value)}
          placeholder="Type 1 / NPI-linked ID"
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>{GROUP_PROVIDER_ID_LABEL}</Label>
        <Input
          value={groupId}
          onChange={(e) => onGroup(e.target.value)}
          placeholder="Type 2 / Tax-ID-linked billing ID"
          className="h-9"
        />
      </div>
    </>
  );
}

// ---- Generic forward transition (assigned/drafting/submitted/in_review/RFI/reapply) ----
export interface TransitionConfirmValues {
  trackingId?: string | null;
  reasonCodeId?: string | null;
  // E4.1 F4.1.8 — the optional touch to log alongside the transition (null when
  // the "Log this as a touch" section is off). PayerPipelineControl sequences
  // the transition, then this touch on success.
  touch?: TouchInput | null;
}

// A sensible default touch type per target: portal-facing transitions preselect
// Portal Check; everything else a Call.
function defaultTouchTypeFor(to: PayerPipelineState): TouchType {
  return to === "action_required" || to === "in_review" || to === "submitted" ? "portal" : "call";
}

export function TransitionConfirmDialog({
  open,
  from,
  to,
  saving,
  reasonCodes,
  currentTrackingId,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  from: PayerPipelineState;
  to: PayerPipelineState;
  saving: boolean;
  reasonCodes: DenialReasonCode[];
  currentTrackingId: string | null;
  onConfirm: (v: TransitionConfirmValues) => void;
  onCancel: () => void;
}) {
  const [trackingId, setTrackingId] = useState(currentTrackingId ?? "");
  const [reasonCodeId, setReasonCodeId] = useState("");

  const isSubmit = to === "submitted";
  const isRfi = to === "action_required";
  const isReapply = from === "denied" && to === "drafting";

  const [touchState, setTouchState] = useState<PipelineTouchState>(() =>
    initialPipelineTouchState(
      defaultTouchTypeFor(to),
      isRfi
        ? "Payer requested action (RFI)"
        : `Pipeline moved from ${pipelineLabel(from)} to ${pipelineLabel(to)}`,
    ),
  );
  const touchBlocked = pipelineTouchBlocked(touchState);

  const title = isReapply ? "Reapply — reopen at Drafting" : `Move to ${pipelineLabel(to)}`;
  const description = isReapply
    ? "Reopens a fresh pipeline cycle on this case. The prior Denied history stays."
    : isRfi
      ? "The payer requested action (RFI). You can optionally record a reason."
      : `Advance the payer pipeline from ${pipelineLabel(from)} to ${pipelineLabel(to)}.`;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isSubmit ? (
            <div className="space-y-1.5">
              <Label className={FIELD_LABEL}>Reference / Tracking ID (optional)</Label>
              <Input
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value)}
                placeholder="Payer portal reference"
                className="h-9"
              />
              <p className="text-[12px] text-muted-foreground">
                Some channels issue this later — you can add or edit it any time while the case is
                open.
              </p>
            </div>
          ) : null}

          {isRfi ? (
            <div className="space-y-1.5">
              <Label className={FIELD_LABEL}>RFI reason (optional)</Label>
              <ReasonCodeSelect
                reasonCodes={reasonCodes}
                value={reasonCodeId}
                onChange={setReasonCodeId}
                placeholder="No reason"
              />
            </div>
          ) : null}

          {/* E4.1 F4.1.8 — Action Bridge: optionally log a touch with this move. */}
          <PipelineTouchSection state={touchState} onChange={setTouchState} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            disabled={saving || touchBlocked}
            onClick={() =>
              onConfirm({
                trackingId: isSubmit && trackingId.trim() ? trackingId.trim() : null,
                reasonCodeId: isRfi && reasonCodeId ? reasonCodeId : null,
                touch: pipelineTouchInput(touchState, format(new Date(), "yyyy-MM-dd")),
              })
            }
          >
            {saving ? "Saving…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Approval (effective date required + two provider IDs) ----
export interface ApprovalValues {
  effectiveDate: string;
  individualProviderId: string | null;
  groupProviderId: string | null;
}

export function ApprovalDialog({
  open,
  saving,
  payer,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  saving: boolean;
  payer: Payer | null;
  onConfirm: (v: ApprovalValues) => void;
  onCancel: () => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState("");
  const [individualId, setIndividualId] = useState("");
  const [groupId, setGroupId] = useState("");

  const noIds = !individualId.trim() && !groupId.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Approve — record enrollment</DialogTitle>
          <DialogDescription>
            The effective date is required. Capture the payer-issued IDs separately (Type 1
            individual and Type 2 group/billing) — either, both, or neither.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Effective date</Label>
            <DatePicker
              value={effectiveDate}
              onChange={setEffectiveDate}
              ariaLabel="Network effective date"
              invalid={!effectiveDate}
            />
          </div>
          <ProviderIdFields
            payer={payer}
            individualId={individualId}
            groupId={groupId}
            onIndividual={setIndividualId}
            onGroup={setGroupId}
          />
          {noIds ? (
            <div className="rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3 text-[12px] text-[#92400E]">
              No payer-issued IDs captured — welcome letters can lag. You can add them later via an
              admin correction.
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            disabled={saving || !effectiveDate}
            onClick={() =>
              onConfirm({
                effectiveDate,
                individualProviderId: individualId.trim() || null,
                groupProviderId: groupId.trim() || null,
              })
            }
          >
            {saving ? "Saving…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Denial (reason code required; Other requires context) ----
export interface DenialValues {
  reasonCodeId: string;
  context: string | null;
}

export function DenialDialog({
  open,
  saving,
  reasonCodes,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  saving: boolean;
  reasonCodes: DenialReasonCode[];
  onConfirm: (v: DenialValues) => void;
  onCancel: () => void;
}) {
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [context, setContext] = useState("");
  const selected = reasonCodes.find((r) => r.id === reasonCodeId);
  const isOther = selected?.code === "other";
  const canSave = Boolean(reasonCodeId) && (!isOther || context.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Deny — record structured reason</DialogTitle>
          <DialogDescription>
            A reason code is required. It is stored structured, not folded into a note.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Reason code</Label>
            <ReasonCodeSelect
              reasonCodes={reasonCodes}
              value={reasonCodeId}
              onChange={setReasonCodeId}
              placeholder="Select a reason…"
            />
          </div>
          {isOther ? (
            <div className="space-y-1.5">
              <Label className={FIELD_LABEL}>Context</Label>
              <Input
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Short single-line context"
                className="h-9"
              />
              <OtherContextHint />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="bg-[#B91C1C] text-white hover:bg-[#991B1B]"
            disabled={saving || !canSave}
            onClick={() => onConfirm({ reasonCodeId, context: isOther ? context.trim() : null })}
          >
            {saving ? "Saving…" : "Deny case"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- OON (simple terminal close) ----
export function OonDialog({
  open,
  saving,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close as Out-of-Network</DialogTitle>
          <DialogDescription>
            The working relationship ends without joining the network. This is a terminal close (an
            admin can correct it later).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="outline" disabled={saving} onClick={onConfirm}>
            {saving ? "Saving…" : "Close Out-of-Network"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Admin correction (any target, justification required, backwards allowed) ----
export interface CorrectionValues {
  toState: PayerPipelineState;
  justification: string;
  reasonCodeId: string | null;
  effectiveDate: string | null;
  individualProviderId: string | null;
  groupProviderId: string | null;
}

export function CorrectionDialog({
  open,
  saving,
  currentState,
  reasonCodes,
  payer,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  saving: boolean;
  currentState: PayerPipelineState;
  reasonCodes: DenialReasonCode[];
  payer: Payer | null;
  onConfirm: (v: CorrectionValues) => void;
  onCancel: () => void;
}) {
  const [toState, setToState] = useState<PayerPipelineState | "">("");
  const [justification, setJustification] = useState("");
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [individualId, setIndividualId] = useState("");
  const [groupId, setGroupId] = useState("");

  const selected = reasonCodes.find((r) => r.id === reasonCodeId);
  const isOther = selected?.code === "other";
  const targetApproved = toState === "approved";
  const targetDenied = toState === "denied";

  const canSave =
    Boolean(toState) &&
    justification.trim().length > 0 &&
    (!targetApproved || Boolean(effectiveDate)) &&
    (!targetDenied || (Boolean(reasonCodeId) && (!isOther || justification.trim().length > 0)));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correct pipeline state (admin)</DialogTitle>
          <DialogDescription>
            A correction writes a new, flagged history row (never edits the old one) and may move
            backwards. A justification is required. Correcting away from Approved clears the
            recorded enrollment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-[#FDE68A] bg-[#FEF3C7] p-3 text-[12px] text-[#92400E]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Current state: {pipelineLabel(currentState)}. Corrections are audited.</span>
          </div>

          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Correct to</Label>
            <Select value={toState} onValueChange={(v) => setToState(v as PayerPipelineState)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select the true state…" />
              </SelectTrigger>
              <SelectContent>
                {PAYER_PIPELINE_STATES.filter((s) => s !== currentState).map((s) => (
                  <SelectItem key={s} value={s}>
                    {pipelineLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {targetDenied ? (
            <div className="space-y-1.5">
              <Label className={FIELD_LABEL}>Reason code</Label>
              <ReasonCodeSelect
                reasonCodes={reasonCodes}
                value={reasonCodeId}
                onChange={setReasonCodeId}
                placeholder="Select a reason…"
              />
              {isOther ? <OtherContextHint /> : null}
            </div>
          ) : null}

          {targetApproved ? (
            <>
              <div className="space-y-1.5">
                <Label className={FIELD_LABEL}>Effective date</Label>
                <DatePicker
                  value={effectiveDate}
                  onChange={setEffectiveDate}
                  ariaLabel="Network effective date"
                  invalid={!effectiveDate}
                />
              </div>
              <ProviderIdFields
                payer={payer}
                individualId={individualId}
                groupId={groupId}
                onIndividual={setIndividualId}
                onGroup={setGroupId}
              />
            </>
          ) : null}

          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Justification</Label>
            <Textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Why is this correction needed?"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            disabled={saving || !canSave}
            onClick={() =>
              onConfirm({
                toState: toState as PayerPipelineState,
                justification: justification.trim(),
                reasonCodeId: targetDenied && reasonCodeId ? reasonCodeId : null,
                effectiveDate: targetApproved ? effectiveDate : null,
                individualProviderId: targetApproved ? individualId.trim() || null : null,
                groupProviderId: targetApproved ? groupId.trim() || null : null,
              })
            }
          >
            {saving ? "Saving…" : "Save correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- RFI → task bridge (F4.0.4) ----
export function RfiTaskBridgeDialog({
  open,
  saving,
  defaultTitle,
  onCreate,
  onSkip,
}: {
  open: boolean;
  saving: boolean;
  defaultTitle: string;
  onCreate: (title: string) => void;
  onSkip: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onSkip()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create a task for this RFI?</DialogTitle>
          <DialogDescription>
            The payer needs action. Spawn an internal task so the case never stalls — or skip it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className={FIELD_LABEL}>Task title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-9"
            placeholder="e.g. Obtain updated COI from provider"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onSkip} disabled={saving}>
            Skip
          </Button>
          <Button
            className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
            disabled={saving || !title.trim()}
            onClick={() => onCreate(title.trim())}
          >
            {saving ? "Creating…" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
