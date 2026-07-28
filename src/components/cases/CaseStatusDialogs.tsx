// E6.0 F6.0.2/F6.0.4 — the unified-status transition dialogs. Each collects
// exactly the evidence its target status requires and calls onConfirm;
// CaseStatusControl owns the set_case_status mutation and toasts. Stock
// shadcn compositions (Dialog/Select/Input/Textarea/Checkbox/DatePicker)
// styled by tokens — no new primitives.
//
// Slice D (payer-and-cases screen 5, 2026-07-27): the Approved dialog asks for
// EXACTLY the IDs the payer's E6.7 expectation flags say it issues — under the
// payer's own wording — and every ID field carries the E6.8 "Didn't receive"
// escape (approve anyway; the enrollment reads Awaiting ID). There is NO hard
// client-side ID requirement anymore (handoff §2.1, PM-approved): silence is
// rejected by the RPC's named errors, which surface — never pre-blocked here.
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CASE_STATUSES, caseStatusLabel, type CaseStatus } from "@/lib/caseStatus";
import {
  resolveGroupIdentifierConfig,
  resolveIdentifierConfig,
} from "@/lib/payerResolutionIdentifier";
import type { DenialReasonCode, Payer } from "@/types";

const FIELD_LABEL = "text-[11px] uppercase tracking-wide text-muted-foreground";

const CONFIRM_CLASSES = "bg-[#1B4D3E] text-white hover:bg-[#163F33]";

// ---- Reason-code select (Denied / correction-to-Denied) ----
function ReasonCodeSelect({
  reasonCodes,
  value,
  onChange,
}: {
  reasonCodes: DenialReasonCode[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9">
        <SelectValue placeholder="Select a reason" />
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

// ---- Payer-labeled provider-ID fields (correction-to-Approved only — the
// Approved close itself renders the expectation-driven rows below). Labels
// come from the payer's OWN wording via the resolver seams ("Provider ID" for
// Anthem, "PTAN" for Medicare, "Group PIN" for the Type 2 side); corrections
// never require either value — the RPC skips the expectation checks for
// corrections, so both fields stay plain optional inputs. ----
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
  const config = resolveIdentifierConfig(payer);
  const groupConfig = resolveGroupIdentifierConfig(payer);
  return (
    <>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>{config.individualLabel}</Label>
        <Input
          value={individualId}
          onChange={(e) => onIndividual(e.target.value)}
          placeholder="Type 1 / NPI-linked ID"
          className="h-9"
        />
      </div>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>{groupConfig.groupLabel}</Label>
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

// ---- Plain forward transition (In Progress / Submitted / In Review /
// Action Required / reapply) — a confirm with an optional note. ----
export function StatusTransitionDialog({
  open,
  from,
  to,
  isReapply,
  saving,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  from: CaseStatus;
  to: CaseStatus;
  isReapply: boolean;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (values: { note: string | null }) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {caseStatusLabel(from)} → {caseStatusLabel(to)}
          </DialogTitle>
          <DialogDescription>
            {isReapply
              ? "Reapply reopens this SAME case — the prior denial stays visible in its history. This records the status change only; to also regenerate the checklist from the current SOP, use the Reapply button on this case."
              : "Record what you learned; the change is appended to the case's history."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className={FIELD_LABEL}>Note (optional)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. payer confirmed receipt on the phone"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className={CONFIRM_CLASSES}
            disabled={saving}
            onClick={() => onConfirm({ note: note.trim() ? note.trim() : null })}
          >
            {isReapply ? "Reapply" : `Mark ${caseStatusLabel(to)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ApprovedValues {
  effectiveDate: string;
  individualProviderId: string | null;
  groupProviderId: string | null;
  contractExecutedDate: string | null;
  /** E6.8 F6.8.3 — the per-ID "Didn't receive" escape. True means the field
   * was explicitly acknowledged missing; the ID stays NULL and the enrollment
   * reads Awaiting ID until back-filled via the existing set-later paths. */
  providerIdMissingAck: boolean;
  groupIdMissingAck: boolean;
}

// ---- One expectation-driven ID row: the payer's own label + scope hint, a
// mono value input, and the "Didn't receive" escape (checked → the input is
// disabled, the value is dropped, and the amber Awaiting-ID note shows). ----
function IdCaptureRow({
  label,
  scope,
  value,
  missing,
  onValue,
  onMissing,
}: {
  label: string;
  scope: string;
  value: string;
  missing: boolean;
  onValue: (v: string) => void;
  onMissing: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className={FIELD_LABEL}>
        {label}{" "}
        <span className="normal-case tracking-normal font-normal text-muted-foreground">
          — {scope}
        </span>
      </Label>
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          value={value}
          onChange={(e) => onValue(e.target.value)}
          placeholder={`Enter the ${label}`}
          aria-label={label}
          disabled={missing}
          className="h-9 min-w-[200px] flex-1 font-mono"
        />
        <label className="flex flex-none cursor-pointer items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <Checkbox
            checked={missing}
            onCheckedChange={(v) => onMissing(v === true)}
            aria-label={`Didn't receive the ${label}`}
          />
          Didn&apos;t receive
        </label>
      </div>
      {missing ? (
        <p className="text-[12px] text-[#B45309]">
          Flagged as outstanding — the enrollment will show “Awaiting ID” until it&apos;s added.
        </p>
      ) : null}
    </div>
  );
}

// ---- Approved: the effective date comes from the approval letter (required);
// the ID fields are EXACTLY what this payer issues per its E6.7 expectation
// flags, worded the payer's way — both / one / neither. Every ID field has the
// "Didn't receive" escape (F6.8.3): a missing ID must never block a close, so
// the confirm is NEVER gated on an ID. An expected ID left empty WITHOUT the
// ack is the RPC's call to reject (surfaced, not pre-blocked — handoff §2.1).
export function ApprovedDialog({
  open,
  payer,
  caseSummary,
  saving,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  payer: Payer | null;
  /** "Provider · Payer · State" header line, composed by the control. */
  caseSummary?: string | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (values: ApprovedValues) => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState("");
  const [individualId, setIndividualId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [individualMissing, setIndividualMissing] = useState(false);
  const [groupMissing, setGroupMissing] = useState(false);
  const [contractExecutedDate, setContractExecutedDate] = useState("");

  const providerConfig = resolveIdentifierConfig(payer);
  const groupConfig = resolveGroupIdentifierConfig(payer);
  const payerName = payer?.name ?? "This payer";
  const anyIds = groupConfig.expected || providerConfig.expected;
  const flagged =
    (groupConfig.expected && groupMissing ? 1 : 0) +
    (providerConfig.expected && individualMissing ? 1 : 0);
  // The one client-side gate is the effective date — never an ID (§2.1).
  const ready = Boolean(effectiveDate);
  const footerNote = !anyIds
    ? "Approving records the effective date."
    : flagged > 0
      ? `${flagged} ${flagged === 1 ? "ID" : "IDs"} flagged as outstanding.`
      : "Leave blank and tick “Didn't receive” if the payer hasn't issued it yet.";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve case</DialogTitle>
          <DialogDescription>
            {caseSummary || "The effective date comes from the approval letter."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Effective date (required)</Label>
            <DatePicker
              value={effectiveDate}
              onChange={(v) => setEffectiveDate(v ?? "")}
              ariaLabel="Effective date"
            />
          </div>
          {anyIds ? (
            <div className="space-y-4 border-t border-[#F0EEE9] pt-4">
              <div>
                <p className={FIELD_LABEL}>IDs {payerName} issues</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  Read these off the payer&apos;s approval letter. You can approve without them.
                </p>
              </div>
              {groupConfig.expected ? (
                <IdCaptureRow
                  label={groupConfig.groupLabel}
                  scope="one per group"
                  value={groupId}
                  missing={groupMissing}
                  onValue={setGroupId}
                  onMissing={setGroupMissing}
                />
              ) : null}
              {providerConfig.expected ? (
                <IdCaptureRow
                  label={providerConfig.individualLabel}
                  scope="one per provider"
                  value={individualId}
                  missing={individualMissing}
                  onValue={setIndividualId}
                  onMissing={setIndividualMissing}
                />
              ) : null}
            </div>
          ) : (
            <p className="rounded-md border border-[#E8E5E0] bg-[#FBFBF9] p-3 text-[13px] text-muted-foreground">
              {payerName} issues no enrollment ID, so there&apos;s nothing else to capture.
            </p>
          )}
          <div className="space-y-1.5 border-t border-[#F0EEE9] pt-4">
            <Label className={FIELD_LABEL}>Contract executed (optional)</Label>
            <DatePicker
              value={contractExecutedDate}
              onChange={(v) => setContractExecutedDate(v ?? "")}
              ariaLabel="Contract executed date"
            />
          </div>
        </div>
        <DialogFooter className="sm:items-center">
          <span className="mr-auto text-[12.5px] text-muted-foreground">{footerNote}</span>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className={CONFIRM_CLASSES}
            disabled={!ready || saving}
            onClick={() =>
              onConfirm({
                effectiveDate,
                individualProviderId:
                  providerConfig.expected && !individualMissing && individualId.trim()
                    ? individualId.trim()
                    : null,
                groupProviderId:
                  groupConfig.expected && !groupMissing && groupId.trim() ? groupId.trim() : null,
                contractExecutedDate: contractExecutedDate || null,
                providerIdMissingAck: providerConfig.expected && individualMissing,
                groupIdMissingAck: groupConfig.expected && groupMissing,
              })
            }
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface DeniedValues {
  reasonCodeId: string;
  context: string | null;
}

// ---- Denied: the reason is REQUIRED from the governed word-list; "Other"
// additionally requires a one-line context (F6.0.2). ----
export function DeniedDialog({
  open,
  reasonCodes,
  saving,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  reasonCodes: DenialReasonCode[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (values: DeniedValues) => void;
}) {
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [context, setContext] = useState("");
  const selected = reasonCodes.find((r) => r.id === reasonCodeId) ?? null;
  const needsContext = selected?.code === "other";
  const ready = Boolean(reasonCodeId) && (!needsContext || context.trim().length > 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Denied</DialogTitle>
          <DialogDescription>
            A reason from the fixed list is required — the denial is reportable the moment it
            exists.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Denial reason (required)</Label>
            <ReasonCodeSelect
              reasonCodes={reasonCodes}
              value={reasonCodeId}
              onChange={setReasonCodeId}
            />
          </div>
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>
              Context{" "}
              <span
                className={`normal-case tracking-normal font-normal ${
                  needsContext ? "text-[#B45309]" : "text-muted-foreground"
                }`}
              >
                — {needsContext ? "required for “Other”" : "optional"}
              </span>
            </Label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={2}
              placeholder="e.g. panel closed for the county"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className={CONFIRM_CLASSES}
            disabled={!ready || saving}
            onClick={() =>
              onConfirm({ reasonCodeId, context: context.trim() ? context.trim() : null })
            }
          >
            Mark Denied
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Not Pursuing: the deliberate opt-out, note REQUIRED (F6.0.1/TS-117). ----
export function NotPursuingDialog({
  open,
  saving,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (values: { note: string }) => void;
}) {
  const [note, setNote] = useState("");
  const ready = note.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Not Pursuing</DialogTitle>
          <DialogDescription>
            The deliberate opt-out — say why this combination is being dropped.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label className={FIELD_LABEL}>Note (required)</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. group decided against this payer in SC"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className={CONFIRM_CLASSES}
            disabled={!ready || saving}
            onClick={() => onConfirm({ note: note.trim() })}
          >
            Mark Not Pursuing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface CorrectionValues {
  toStatus: CaseStatus;
  note: string;
  reasonCodeId: string | null;
  effectiveDate: string | null;
  individualProviderId: string | null;
  groupProviderId: string | null;
}

// ---- Admin correction (F6.0.4): may move to ANY status including backwards;
// note required; appends to history — the original entry stands. ----
export function StatusCorrectionDialog({
  open,
  current,
  payer,
  reasonCodes,
  saving,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  current: CaseStatus;
  payer: Payer | null;
  reasonCodes: DenialReasonCode[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: (values: CorrectionValues) => void;
}) {
  const [toStatus, setToStatus] = useState<CaseStatus | "">("");
  const [note, setNote] = useState("");
  const [reasonCodeId, setReasonCodeId] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [individualId, setIndividualId] = useState("");
  const [groupId, setGroupId] = useState("");
  const targets = CASE_STATUSES.filter((s) => s !== current);
  const ready = Boolean(toStatus) && note.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct status</DialogTitle>
          <DialogDescription>
            Corrections append to history with your name and note — the original entry stands.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Correct to</Label>
            <Select value={toStatus} onValueChange={(v) => setToStatus(v as CaseStatus)}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select the true status" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((s) => (
                  <SelectItem key={s} value={s}>
                    {caseStatusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {toStatus === "denied" ? (
            <div className="space-y-1.5">
              <Label className={FIELD_LABEL}>Denial reason</Label>
              <ReasonCodeSelect
                reasonCodes={reasonCodes}
                value={reasonCodeId}
                onChange={setReasonCodeId}
              />
            </div>
          ) : null}
          {toStatus === "approved" ? (
            <>
              <div className="space-y-1.5">
                <Label className={FIELD_LABEL}>Effective date</Label>
                <DatePicker
                  value={effectiveDate}
                  onChange={(v) => setEffectiveDate(v ?? "")}
                  ariaLabel="Corrected effective date"
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
            <Label className={FIELD_LABEL}>Correction note (required)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="e.g. approval letter was for the sibling case — reverting"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            className={CONFIRM_CLASSES}
            disabled={!ready || saving}
            onClick={() =>
              onConfirm({
                toStatus: toStatus as CaseStatus,
                note: note.trim(),
                reasonCodeId: reasonCodeId || null,
                effectiveDate: effectiveDate || null,
                individualProviderId: individualId.trim() ? individualId.trim() : null,
                groupProviderId: groupId.trim() ? groupId.trim() : null,
              })
            }
          >
            Save correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
