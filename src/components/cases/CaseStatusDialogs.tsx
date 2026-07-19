// E6.0 F6.0.2/F6.0.4 — the unified-status transition dialogs. Each collects
// exactly the evidence its target status requires and calls onConfirm;
// CaseStatusControl owns the set_case_status mutation and toasts. Stock
// shadcn compositions (Dialog/Select/Input/Textarea/DatePicker) styled by
// tokens — no new primitives.
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
import { GROUP_PROVIDER_ID_LABEL, resolveIdentifierConfig } from "@/lib/payerResolutionIdentifier";
import { useOrgPayerSetting } from "@/hooks/useOrgPayerSettings";
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

// ---- Payer-labeled provider-ID fields (Approved / correction-to-Approved).
// The org's own setting (org_payer_settings) wins, then the Minted-curated
// global label on the payers row, then the generic default — so the input is
// labeled with the payer's OWN term ("Provider ID" for Anthem, "PTAN" for
// Medicare). F6.0.2. ----
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
  const orgSetting = useOrgPayerSetting(payer?.id);
  const config = resolveIdentifierConfig(payer, orgSetting);
  return (
    <>
      <div className="space-y-1.5">
        <Label className={FIELD_LABEL}>{config.individualLabel} (required)</Label>
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
              ? "Reapply reopens this SAME case with a fresh task cycle — the prior denial stays visible in its history."
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
  individualProviderId: string;
  groupProviderId: string | null;
  contractExecutedDate: string | null;
}

// ---- Approved: the terminal facts are captured at the moment the letter is
// in hand — effective date AND the payer-labeled ID are REQUIRED (F6.0.2). ----
export function ApprovedDialog({
  open,
  payer,
  saving,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  payer: Payer | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (values: ApprovedValues) => void;
}) {
  const [effectiveDate, setEffectiveDate] = useState("");
  const [individualId, setIndividualId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [contractExecutedDate, setContractExecutedDate] = useState("");
  const ready = Boolean(effectiveDate) && individualId.trim().length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Approved</DialogTitle>
          <DialogDescription>
            The effective date and the payer's provider ID come from the approval letter — both are
            required.
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
          <ProviderIdFields
            payer={payer}
            individualId={individualId}
            groupId={groupId}
            onIndividual={setIndividualId}
            onGroup={setGroupId}
          />
          <div className="space-y-1.5">
            <Label className={FIELD_LABEL}>Contract executed (optional)</Label>
            <DatePicker
              value={contractExecutedDate}
              onChange={(v) => setContractExecutedDate(v ?? "")}
              ariaLabel="Contract executed date"
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
                effectiveDate,
                individualProviderId: individualId.trim(),
                groupProviderId: groupId.trim() ? groupId.trim() : null,
                contractExecutedDate: contractExecutedDate || null,
              })
            }
          >
            Mark Approved
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
            <Label className={FIELD_LABEL}>Context{needsContext ? " (required)" : ""}</Label>
            <Textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={2}
              placeholder="e.g. panel closed for the county"
            />
            {needsContext ? (
              <p className="text-[12px] text-muted-foreground">
                A short context is required when the reason is “Other”.
              </p>
            ) : null}
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
            A note is required — say why this combination is being dropped.
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
