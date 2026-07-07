// Touchlog card on case detail: the single case-activity timeline. Renders every
// entry_type (touchpoint / note / system_event / task_update) and offers inline
// "Add touch" (channel-aware, Story 3) and "Add note" (Story 1) forms. The
// mutation hooks stay with the parent route (onSave*).
import { useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmptyState } from "@/components/EmptyState";
import { fmtDate } from "@/lib/format";
import {
  CHANNELS,
  outcomeLabel,
  outcomesForChannel,
  REFERENCE_NUMBER_OUTCOME,
  touchTypeForChannel,
  type Channel,
} from "@/lib/touchOutcomes";
import {
  Calendar,
  CheckSquare,
  Globe,
  Info,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  Send,
  StickyNote,
  User,
} from "lucide-react";
import type { Profile } from "@/types";
import type { Touch, TouchOutcome, TouchType } from "@/types";

const TOUCH_TYPE_ICON: Record<TouchType, typeof Phone> = {
  call: Phone,
  email: Mail,
  portal: Globe,
  fax: Printer,
  mail: Send,
};
const TOUCH_TYPE_LABEL: Record<TouchType, string> = {
  call: "Phone",
  email: "Email",
  portal: "Portal",
  fax: "Fax",
  mail: "Mail",
};

export interface TouchInput {
  touchDate: string;
  touchType: TouchType;
  outcome: TouchOutcome;
  notes: string | null;
  nextFollowUpDate: string | null;
}

export function CaseTouchesPanel({
  touches,
  coordinators,
  canEdit,
  savingTouch,
  savingNote,
  onSaveTouch,
  onSaveNote,
  onSetReference,
}: {
  touches: Touch[];
  coordinators: Profile[];
  canEdit: boolean;
  savingTouch: boolean;
  savingNote: boolean;
  onSaveTouch: (input: TouchInput) => Promise<void> | void;
  onSaveNote: (content: string) => Promise<void> | void;
  onSetReference: (value: string) => Promise<void> | void;
}) {
  const [openForm, setOpenForm] = useState<"none" | "touch" | "note">("none");

  const coordName = (id: string | null) => {
    const coord = coordinators.find((x) => x.id === id);
    return coord?.fullName ?? coord?.email ?? "—";
  };

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between">
        <CardTitle className="text-[14px] font-semibold">Touchlog</CardTitle>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setOpenForm((v) => (v === "note" ? "none" : "note"))}
            >
              <StickyNote className="w-4 h-4 mr-1" /> Add note
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setOpenForm((v) => (v === "touch" ? "none" : "touch"))}
            >
              <Plus className="w-4 h-4 mr-1" /> Add touch
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {openForm === "touch" && canEdit ? (
          <AddTouchForm
            onCancel={() => setOpenForm("none")}
            onSave={async (input, reference) => {
              await onSaveTouch(input);
              if (reference) await onSetReference(reference);
              setOpenForm("none");
            }}
            saving={savingTouch}
          />
        ) : null}
        {openForm === "note" && canEdit ? (
          <AddNoteForm
            onCancel={() => setOpenForm("none")}
            onSave={async (content) => {
              await onSaveNote(content);
              setOpenForm("none");
            }}
            saving={savingNote}
          />
        ) : null}
        {touches.length === 0 ? (
          <EmptyState
            icon={
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
              </div>
            }
            message="No activity logged yet"
            description="Calls, emails, portal updates, and notes all show here"
          />
        ) : (
          <div className="p-4 space-y-6">
            {touches.map((t, idx) => (
              <TouchlogRow
                key={t.id}
                touch={t}
                isLatest={idx === 0}
                authorName={coordName(t.coordinatorId)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TouchlogRow({
  touch: t,
  isLatest,
  authorName,
}: {
  touch: Touch;
  isLatest: boolean;
  authorName: string;
}) {
  const batchChip = t.communicationEventId ? (
    <Badge
      variant="secondary"
      className="text-[11px] h-5 px-1.5 font-medium border border-border bg-muted/30"
    >
      {t.batchSummary
        ? `Part of ${t.batchSummary.payerName} ${t.batchSummary.channelLabel} call, ${t.batchSummary.caseCount} case${
            t.batchSummary.caseCount === 1 ? "" : "s"
          }`
        : "Part of a batch call"}
    </Badge>
  ) : null;

  let leftBadge: React.ReactNode;
  let heading: React.ReactNode = null;
  if (t.entryType === "touchpoint" && t.touchType) {
    const Icon = TOUCH_TYPE_ICON[t.touchType] ?? Phone;
    leftBadge = (
      <Badge
        variant="outline"
        className="text-[11px] h-5 px-1.5 font-medium bg-background gap-1 text-muted-foreground"
      >
        <Icon className="w-3 h-3" /> {TOUCH_TYPE_LABEL[t.touchType]}
      </Badge>
    );
    heading = (
      <span className="text-[13px] text-foreground font-medium">· {outcomeLabel(t.outcome)}</span>
    );
  } else if (t.entryType === "note") {
    leftBadge = <EntryBadge icon={StickyNote} label="Note" />;
  } else if (t.entryType === "task_update") {
    leftBadge = <EntryBadge icon={CheckSquare} label="Task update" />;
  } else {
    leftBadge = <EntryBadge icon={Info} label="System" />;
  }

  return (
    <div className="relative pl-6 border-l-2 border-muted pb-2">
      <div
        className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-background border-2 ${
          isLatest ? "border-primary" : "border-muted"
        } flex items-center justify-center`}
      >
        {isLatest ? <div className="w-1.5 h-1.5 rounded-full bg-primary" /> : null}
      </div>
      <div className="flex items-start justify-between mb-1 gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-semibold text-foreground tabular-nums">
            {fmtDate(t.touchDate)}
          </span>
          {leftBadge}
          {batchChip}
          {heading}
        </div>
        <span className="text-[12px] text-muted-foreground flex items-center gap-1 shrink-0">
          <User className="w-3 h-3" /> {authorName}
        </span>
      </div>
      {t.notes ? (
        <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-wrap">
          {t.notes}
        </p>
      ) : null}
      {t.nextFollowUpDate ? (
        <div className="mt-2 text-[12px] text-[#D97706] inline-flex items-center gap-1 font-medium bg-[#FEF3C7] px-2 py-0.5 rounded">
          <Calendar className="w-3 h-3" /> Next follow-up: {fmtDate(t.nextFollowUpDate)}
        </div>
      ) : null}
    </div>
  );
}

function EntryBadge({ icon: Icon, label }: { icon: typeof Phone; label: string }) {
  return (
    <Badge
      variant="outline"
      className="text-[11px] h-5 px-1.5 font-medium bg-background gap-1 text-muted-foreground"
    >
      <Icon className="w-3 h-3" /> {label}
    </Badge>
  );
}

function AddTouchForm({
  onCancel,
  onSave,
  saving,
}: {
  onCancel: () => void;
  onSave: (input: TouchInput, reference: string | null) => void;
  saving: boolean;
}) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [touchDate, setTouchDate] = useState(today);
  const [channel, setChannel] = useState<Channel>("phone");
  const [outcome, setOutcome] = useState<TouchOutcome>(outcomesForChannel("phone")[0].value);
  const [notes, setNotes] = useState("");
  const [nextFollowUpDate, setNextFollowUpDate] = useState("");
  const [reference, setReference] = useState("");

  const outcomeOptions = outcomesForChannel(channel);
  const showReference = outcome === REFERENCE_NUMBER_OUTCOME;

  const onChannelChange = (next: Channel) => {
    setChannel(next);
    // Reset to a valid outcome for the new channel.
    setOutcome(outcomesForChannel(next)[0].value);
  };

  return (
    <div className="p-4 bg-muted/30 border-b border-border space-y-4">
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
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Channel
          </Label>
          <Select value={channel} onValueChange={(v) => onChannelChange(v as Channel)}>
            <SelectTrigger className="h-8 text-[13px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c.channel} value={c.channel}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Outcome</Label>
        <Select value={outcome} onValueChange={(v) => setOutcome(v as TouchOutcome)}>
          <SelectTrigger className="h-8 text-[13px] bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {outcomeOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showReference ? (
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Payer reference / submission ID
          </Label>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Reference number from the rep"
            className="h-8 text-[13px] bg-background"
          />
          <p className="text-[11px] text-muted-foreground">Saved to the case, latest wins.</p>
        </div>
      ) : null}
      <div className="space-y-1.5">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Notes</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Enter details about this touch..."
          className="min-h-[80px] text-[13px] bg-background resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Next follow-up
          </Label>
          <Input
            type="date"
            value={nextFollowUpDate}
            onChange={(e) => setNextFollowUpDate(e.target.value)}
            className="h-8 text-[13px] bg-background"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving}
          onClick={() =>
            onSave(
              {
                touchDate,
                touchType: touchTypeForChannel(channel),
                outcome,
                notes: notes.trim() ? notes.trim() : null,
                nextFollowUpDate: nextFollowUpDate || null,
              },
              showReference && reference.trim() ? reference.trim() : null,
            )
          }
        >
          {saving ? "Saving…" : "Save touch"}
        </Button>
      </div>
    </div>
  );
}

function AddNoteForm({
  onCancel,
  onSave,
  saving,
}: {
  onCancel: () => void;
  onSave: (content: string) => void;
  saving: boolean;
}) {
  const [content, setContent] = useState("");
  return (
    <div className="p-4 bg-muted/30 border-b border-border space-y-2">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Note</Label>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Add an internal note..."
        className="min-h-[80px] text-[13px] bg-background resize-none"
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saving || !content.trim()}
          onClick={() => onSave(content.trim())}
        >
          {saving ? "Saving…" : "Save note"}
        </Button>
      </div>
    </div>
  );
}
