// The ONE structured Add-touch form (E4.1 F4.1.1/F4.1.4/F4.1.5/F4.1.2 +
// E6.0 F6.0.3 bump suggestion), extracted by E6.6 F6.6.5 so case detail's
// inline entry and the multi-case AddTouchDialog share it — one verb, one
// form, one rule table. Also serves corrections when `correctionOf` is set
// (corrections never suggest a bump).
//
// Bump generalization: `bumpTargets` carries the case(s) the touch will be
// logged on with their current statuses. Per target the closed F6.0.3 rule
// table (suggestStatusBump) decides whether the live type/outcome implies a
// status; targets grouped by suggested status render one checkbox each. A
// touch that implies nothing renders no suggestion — the dialog never
// pressures a bump; declining logs the touch alone.
import { useState } from "react";
import { format } from "date-fns";
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
import { fmtDate } from "@/lib/format";
import { CANONICAL_TOUCH_TYPES, TOUCH_TYPE_LABELS } from "@/lib/touchTypes";
import {
  dispositionRequiresContext,
  OTHER_DISPOSITION,
  TOUCH_DISPOSITIONS,
} from "@/lib/touchDispositions";
import { caseStatusLabel, suggestStatusBump, type CaseStatus } from "@/lib/caseStatus";
import type { TouchInput } from "@/services/touches";
import { RotateCcw } from "lucide-react";
import type { Touch, TouchOutcome, TouchType } from "@/types";

const NO_OUTCOME = "__none__";

export interface TouchBumpTarget {
  id: string;
  currentStatus: CaseStatus;
}

export interface AcceptedTouchBump {
  targetId: string;
  toStatus: CaseStatus;
}

export function AddTouchForm({
  correctionOf,
  saving,
  bumpTargets = [],
  variant = "inline",
  onCancel,
  onSave,
}: {
  correctionOf: Touch | null;
  saving: boolean;
  /** E6.0 F6.0.3 — the case(s) this touch logs on; a touch whose type/outcome
   * implies a status offers the bump in the same gesture (never for
   * corrections). Empty = no suggestions. */
  bumpTargets?: readonly TouchBumpTarget[];
  /** inline = the case-detail panel strip; dialog = inside AddTouchDialog. */
  variant?: "inline" | "dialog";
  onCancel: () => void;
  onSave: (input: TouchInput, acceptedBumps: AcceptedTouchBump[]) => void;
}) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [touchDate, setTouchDate] = useState(correctionOf?.touchDate ?? today);
  const [touchType, setTouchType] = useState<TouchType>(
    (correctionOf?.touchType as TouchType | undefined) ?? "call",
  );
  const [outcome, setOutcome] = useState<string>(correctionOf?.outcome ?? NO_OUTCOME);
  const [recipientName, setRecipientName] = useState(correctionOf?.recipientName ?? "");
  const [recipientContact, setRecipientContact] = useState(correctionOf?.recipientContact ?? "");
  const [notes, setNotes] = useState("");
  const [nextFollowUpDate, setNextFollowUpDate] = useState("");
  const [clearFollowUp, setClearFollowUp] = useState(false);
  const [acceptedStatuses, setAcceptedStatuses] = useState<Set<CaseStatus>>(new Set());

  const requiresContext = dispositionRequiresContext(outcome as TouchOutcome);
  const contextMissing = requiresContext && !notes.trim();
  const disableSave = saving || contextMissing;

  // The closed F6.0.3 rule table, applied per target against the LIVE
  // type/outcome; corrections never suggest.
  const suggestionGroups: { toStatus: CaseStatus; targets: TouchBumpTarget[] }[] = [];
  if (!correctionOf) {
    for (const target of bumpTargets) {
      const suggested = suggestStatusBump({
        touchType,
        outcome: outcome === NO_OUTCOME ? null : outcome,
        currentStatus: target.currentStatus,
      });
      if (!suggested) continue;
      const group = suggestionGroups.find((g) => g.toStatus === suggested);
      if (group) group.targets.push(target);
      else suggestionGroups.push({ toStatus: suggested, targets: [target] });
    }
  }

  const toggleAccepted = (status: CaseStatus, checked: boolean) => {
    setAcceptedStatuses((prev) => {
      const next = new Set(prev);
      if (checked) next.add(status);
      else next.delete(status);
      return next;
    });
  };

  const submit = () => {
    const acceptedBumps = suggestionGroups
      .filter((g) => acceptedStatuses.has(g.toStatus))
      .flatMap((g) => g.targets.map((t) => ({ targetId: t.id, toStatus: g.toStatus })));
    onSave(
      {
        touchDate,
        touchType,
        outcome: outcome === NO_OUTCOME ? null : (outcome as TouchOutcome),
        recipientName: recipientName.trim() ? recipientName.trim() : null,
        recipientContact: recipientContact.trim() ? recipientContact.trim() : null,
        notes: notes.trim() ? notes.trim() : null,
        nextFollowUpDate: clearFollowUp ? null : nextFollowUpDate || null,
        clearsFollowUp: clearFollowUp,
      },
      acceptedBumps,
    );
  };

  return (
    <div
      className={
        variant === "inline" ? "p-4 bg-muted/30 border-b border-border space-y-4" : "space-y-4"
      }
    >
      {correctionOf ? (
        <div className="text-[12px] text-[#92400E] bg-[#FEF3C7] border border-[#FDE68A] rounded px-2 py-1.5 inline-flex items-center gap-1.5">
          <RotateCcw className="w-3.5 h-3.5" />
          Logging a correction of the {TOUCH_TYPE_LABELS[correctionOf.touchType as TouchType]} touch
          from {fmtDate(correctionOf.touchDate)}. The original stays in the log.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Date</Label>
          <Input
            type="date"
            value={touchDate}
            onChange={(e) => setTouchDate(e.target.value)}
            className="h-8 text-[13px] bg-background"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Type</Label>
          <Select value={touchType} onValueChange={(v) => setTouchType(v as TouchType)}>
            <SelectTrigger className="h-8 text-[13px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CANONICAL_TOUCH_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TOUCH_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Recipient capture — optional but prominent (F4.1.5). */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Recipient
          </Label>
          <Input
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="Who you contacted"
            className="h-8 text-[13px] bg-background"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Recipient contact
          </Label>
          <Input
            value={recipientContact}
            onChange={(e) => setRecipientContact(e.target.value)}
            placeholder="Phone, email, portal…"
            className="h-8 text-[13px] bg-background"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Outcome <span className="normal-case text-muted-foreground/70">(optional)</span>
        </Label>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="h-8 text-[13px] bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_OUTCOME}>— No outcome —</SelectItem>
            {TOUCH_DISPOSITIONS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {outcome === OTHER_DISPOSITION ? "Context (required for Other)" : "Context"}
        </Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What happened on this touch…"
          className="min-h-[64px] text-[13px] bg-background resize-none"
        />
        {contextMissing ? (
          <p className="text-[11px] text-[#B91C1C]">A one-line context is required for “Other”.</p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Next follow-up
          </Label>
          <Input
            type="date"
            value={nextFollowUpDate}
            disabled={clearFollowUp}
            onChange={(e) => setNextFollowUpDate(e.target.value)}
            className="h-8 text-[13px] bg-background disabled:opacity-50"
          />
        </div>
        <label className="flex items-end gap-2 pb-1.5 cursor-pointer">
          <Checkbox checked={clearFollowUp} onCheckedChange={(v) => setClearFollowUp(Boolean(v))} />
          <span className="text-[12px] text-muted-foreground leading-tight">
            Clear the active follow-up
          </span>
        </label>
      </div>
      {!clearFollowUp && !nextFollowUpDate ? (
        <p className="-mt-2 text-[11px] text-muted-foreground">
          Leaving this blank keeps any existing follow-up (it carries forward).
        </p>
      ) : null}

      {suggestionGroups.map((g) => (
        <label
          key={g.toStatus}
          className="flex items-center gap-2 rounded-md border border-[#E8E5E0] bg-background px-3 py-2 cursor-pointer"
        >
          <Checkbox
            checked={acceptedStatuses.has(g.toStatus)}
            onCheckedChange={(v) => toggleAccepted(g.toStatus, Boolean(v))}
          />
          {bumpTargets.length === 1 ? (
            <span className="text-[12px] text-foreground leading-tight">
              Also move the case to{" "}
              <span className="font-medium">{caseStatusLabel(g.toStatus)}</span> — this touch is
              the evidence.
            </span>
          ) : (
            <span className="text-[12px] text-foreground leading-tight">
              Also move {g.targets.length} case{g.targets.length === 1 ? "" : "s"} to{" "}
              <span className="font-medium">{caseStatusLabel(g.toStatus)}</span> — these touches
              are the evidence.
            </span>
          )}
        </label>
      ))}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" disabled={disableSave} onClick={submit}>
          {saving ? "Saving…" : correctionOf ? "Log correction" : "Save touch"}
        </Button>
      </div>
    </div>
  );
}
