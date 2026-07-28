// Touchlog card on case detail: the single case-activity timeline. E4.1 gives it
// the structured entry form (type + optional disposition + prominent optional
// recipient + follow-up with an explicit clear), renders the type pill /
// disposition / recipient on each row, shows the correction pair, filters the
// timeline (type / outcome / recipient / follow-up status / date), surfaces the
// last payer communication, and exports the log to CSV. Corrections are appends
// (onCorrectTouch); the mutation hooks stay with the parent route.
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { EmptyState } from "@/components/EmptyState";
import { fmtDate } from "@/lib/format";
import { outcomeLabel } from "@/lib/touchOutcomes";
import { CANONICAL_TOUCH_TYPES, touchTypeDirection, TOUCH_TYPE_LABELS } from "@/lib/touchTypes";
import {
  dispositionRequiresContext,
  OTHER_DISPOSITION,
  TOUCH_DISPOSITIONS,
} from "@/lib/touchDispositions";
import { followUpStatus } from "@/lib/followUps";
import { buildTouchesCsv } from "@/lib/touchesExport";
import { downloadCsvText } from "@/lib/csv";
import { caseStatusLabel, type CaseStatus } from "@/lib/caseStatus";
import { evidencedTransitionsByTouch, type EvidencedTransition } from "@/lib/caseDetailView";
import { AddTouchForm } from "@/components/cases/AddTouchForm";
import type { TouchInput } from "@/services/touches";
import {
  Calendar,
  CheckSquare,
  Download,
  FileCheck,
  Filter,
  Globe,
  History,
  Info,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  RotateCcw,
  Send,
  Stethoscope,
  StickyNote,
  User,
  Users,
} from "lucide-react";
import type { CaseStatusHistoryEntry, Profile, Touch, TouchOutcome, TouchType } from "@/types";

const TOUCH_TYPE_ICON: Record<TouchType, typeof Phone> = {
  call: Phone,
  email: Mail,
  portal: Globe,
  fax: Printer,
  mail: Send,
  caqh_update: FileCheck,
  provider_outreach: Stethoscope,
  internal_sync: Users,
};

const NO_OUTCOME = "__none__";
const ALL = "__all__";

type FollowUpFilter = "any" | "overdue" | "active" | "none";

export function CaseTouchesPanel({
  touches,
  coordinators,
  canEdit,
  savingTouch,
  savingNote,
  onSaveTouch,
  onSaveNote,
  onCorrectTouch,
  currentStatus,
  onStatusBump,
  history,
  today = format(new Date(), "yyyy-MM-dd"),
}: {
  touches: Touch[];
  coordinators: Profile[];
  canEdit: boolean;
  savingTouch: boolean;
  savingNote: boolean;
  /** Returns the logged touch so an accepted status bump (F6.0.3) can link
   * it as the transition's evidence; null when the log failed. */
  onSaveTouch: (input: TouchInput) => Promise<Touch | null> | void;
  onSaveNote: (content: string) => Promise<void> | void;
  onCorrectTouch: (originalTouchId: string, input: TouchInput) => Promise<void> | void;
  /** E6.0 F6.0.3 — the case's unified status; when set, the Add-touch form
   * offers the implied status bump alongside the touch. */
  currentStatus?: CaseStatus;
  /** Accepting the bump records touch + transition together, the touch
   * linked as evidence. Declining logs the touch alone. */
  onStatusBump?: (toStatus: CaseStatus, evidenceTouchId: string) => Promise<void> | void;
  /** The case's status-history embed (already loaded by getCase) — used ONLY
   * to mark which touches evidenced a transition. No second fetch. */
  history?: CaseStatusHistoryEntry[];
  today?: string;
}) {
  const [openForm, setOpenForm] = useState<"none" | "touch" | "note">("none");
  const [correcting, setCorrecting] = useState<Touch | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>(ALL);
  const [outcomeFilter, setOutcomeFilter] = useState<string>(ALL);
  const [recipientFilter, setRecipientFilter] = useState("");
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>("any");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const coordName = (id: string | null) => {
    const coord = coordinators.find((x) => x.id === id);
    return coord?.fullName ?? coord?.email ?? "—";
  };

  // Correction linkage: which touch corrects which, and which have been corrected.
  const { correctedByOf, correctionTargetDate } = useMemo(() => {
    const correctedBy = new Map<string, Touch>();
    const targetDate = new Map<string, string>();
    const byId = new Map(touches.map((t) => [t.id, t]));
    for (const t of touches) {
      if (t.correctsTouchId) {
        correctedBy.set(t.correctsTouchId, t);
        const target = byId.get(t.correctsTouchId);
        if (target) targetDate.set(t.id, target.touchDate);
      }
    }
    return { correctedByOf: correctedBy, correctionTargetDate: targetDate };
  }, [touches]);

  // Last payer communication (TE): most recent payer-facing touchpoint.
  const lastPayerTouch = useMemo(() => {
    return (
      touches
        .filter((t) => t.entryType === "touchpoint" && t.touchType)
        .filter((t) => touchTypeDirection(t.touchType as TouchType) === "payer_facing")
        .slice()
        .sort((a, b) => (a.touchDate < b.touchDate ? 1 : a.touchDate > b.touchDate ? -1 : 0))[0] ??
      null
    );
  }, [touches]);

  // Reverse evidence link: which transitions each touch was cited for. Derived
  // from the FULL history, so filtering the timeline never changes a row's
  // marker — a hidden row simply isn't looked up.
  const evidencedBy = useMemo(() => evidencedTransitionsByTouch(history), [history]);

  const filterActive =
    typeFilter !== ALL ||
    outcomeFilter !== ALL ||
    recipientFilter.trim() !== "" ||
    followUpFilter !== "any" ||
    dateFrom !== "" ||
    dateTo !== "";

  const visibleTouches = useMemo(() => {
    const needle = recipientFilter.trim().toLowerCase();
    return touches.filter((t) => {
      if (typeFilter !== ALL && t.touchType !== typeFilter) return false;
      if (outcomeFilter !== ALL && (t.outcome ?? "") !== outcomeFilter) return false;
      if (needle) {
        const hay = `${t.recipientName ?? ""} ${t.recipientContact ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      if (followUpFilter !== "any") {
        const status = followUpStatus(t.nextFollowUpDate, today);
        if (followUpFilter === "overdue" && status !== "overdue") return false;
        if (followUpFilter === "active" && !(status === "overdue" || status === "upcoming"))
          return false;
        if (followUpFilter === "none" && t.nextFollowUpDate) return false;
      }
      if (dateFrom && t.touchDate < dateFrom) return false;
      if (dateTo && t.touchDate > dateTo) return false;
      return true;
    });
  }, [
    touches,
    typeFilter,
    outcomeFilter,
    recipientFilter,
    followUpFilter,
    dateFrom,
    dateTo,
    today,
  ]);

  const resetFilters = () => {
    setTypeFilter(ALL);
    setOutcomeFilter(ALL);
    setRecipientFilter("");
    setFollowUpFilter("any");
    setDateFrom("");
    setDateTo("");
  };

  const exportCsv = () => {
    const csv = buildTouchesCsv(touches, coordName);
    downloadCsvText(`touchlog-${today}.csv`, csv);
  };

  return (
    <Card className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-[14px] font-semibold">Touchlog</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Filter touchlog"
          >
            <Filter className="w-4 h-4 mr-1" /> Filter
            {filterActive ? <span className="ml-1 w-1.5 h-1.5 rounded-full bg-primary" /> : null}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={exportCsv}
            disabled={touches.length === 0}
            aria-label="Export touchlog to CSV"
          >
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          {canEdit && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  setCorrecting(null);
                  setOpenForm((v) => (v === "note" ? "none" : "note"));
                }}
              >
                <StickyNote className="w-4 h-4 mr-1" /> Add note
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => {
                  setCorrecting(null);
                  setOpenForm((v) => (v === "touch" ? "none" : "touch"));
                }}
              >
                <Plus className="w-4 h-4 mr-1" /> Add touch
              </Button>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {showFilters ? (
          <TouchFilters
            typeFilter={typeFilter}
            outcomeFilter={outcomeFilter}
            recipientFilter={recipientFilter}
            followUpFilter={followUpFilter}
            dateFrom={dateFrom}
            dateTo={dateTo}
            onType={setTypeFilter}
            onOutcome={setOutcomeFilter}
            onRecipient={setRecipientFilter}
            onFollowUp={setFollowUpFilter}
            onDateFrom={setDateFrom}
            onDateTo={setDateTo}
            onReset={resetFilters}
            resultCount={visibleTouches.length}
            totalCount={touches.length}
          />
        ) : null}

        {lastPayerTouch ? (
          <div className="px-4 py-2 border-b border-border bg-muted/20 text-[12px] text-muted-foreground flex items-center gap-1.5">
            <Phone className="w-3 h-3" />
            Last payer communication:{" "}
            <span className="font-medium text-foreground">
              {TOUCH_TYPE_LABELS[lastPayerTouch.touchType as TouchType]}
            </span>{" "}
            on <span className="tabular-nums">{fmtDate(lastPayerTouch.touchDate)}</span>
            {lastPayerTouch.outcome ? ` · ${outcomeLabel(lastPayerTouch.outcome)}` : ""}
          </div>
        ) : null}

        {openForm === "touch" && canEdit ? (
          <AddTouchForm
            key="new-touch"
            correctionOf={null}
            saving={savingTouch}
            bumpTargets={currentStatus ? [{ id: "case", currentStatus }] : []}
            onCancel={() => setOpenForm("none")}
            onSave={async (input, acceptedBumps) => {
              const touch = await onSaveTouch(input);
              // F6.0.3 — the same gesture writes both: the touch, then the
              // transition with the touch linked as its evidence. Declining
              // (no accepted bump) logs the touch alone.
              const acceptedBump = acceptedBumps[0]?.toStatus ?? null;
              if (acceptedBump && touch && onStatusBump) {
                await onStatusBump(acceptedBump, touch.id);
              }
              setOpenForm("none");
            }}
          />
        ) : null}
        {correcting && canEdit ? (
          <AddTouchForm
            key={`correct-${correcting.id}`}
            correctionOf={correcting}
            saving={savingTouch}
            onCancel={() => setCorrecting(null)}
            onSave={async (input) => {
              await onCorrectTouch(correcting.id, input);
              setCorrecting(null);
            }}
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
        ) : visibleTouches.length === 0 ? (
          <div className="p-6 text-center text-[13px] text-muted-foreground">
            No entries match these filters.
          </div>
        ) : (
          <div className="p-4 space-y-6">
            {visibleTouches.map((t) => (
              <TouchlogRow
                key={t.id}
                touch={t}
                isLatest={t.id === touches[0]?.id}
                authorName={coordName(t.coordinatorId)}
                correctedBy={correctedByOf.get(t.id) ?? null}
                correctionTargetDate={correctionTargetDate.get(t.id) ?? null}
                evidencedFor={evidencedBy.get(t.id) ?? null}
                canEdit={canEdit}
                today={today}
                onCorrect={() => {
                  setOpenForm("none");
                  setCorrecting(t);
                }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TouchFilters({
  typeFilter,
  outcomeFilter,
  recipientFilter,
  followUpFilter,
  dateFrom,
  dateTo,
  onType,
  onOutcome,
  onRecipient,
  onFollowUp,
  onDateFrom,
  onDateTo,
  onReset,
  resultCount,
  totalCount,
}: {
  typeFilter: string;
  outcomeFilter: string;
  recipientFilter: string;
  followUpFilter: FollowUpFilter;
  dateFrom: string;
  dateTo: string;
  onType: (v: string) => void;
  onOutcome: (v: string) => void;
  onRecipient: (v: string) => void;
  onFollowUp: (v: FollowUpFilter) => void;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  onReset: () => void;
  resultCount: number;
  totalCount: number;
}) {
  return (
    <div className="p-4 bg-muted/20 border-b border-border space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <FilterField label="Type">
          <Select value={typeFilter} onValueChange={onType}>
            <SelectTrigger className="h-8 text-[13px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              {CANONICAL_TOUCH_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TOUCH_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label="Outcome">
          <Select value={outcomeFilter} onValueChange={onOutcome}>
            <SelectTrigger className="h-8 text-[13px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All outcomes</SelectItem>
              {TOUCH_DISPOSITIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label="Follow-up">
          <Select value={followUpFilter} onValueChange={(v) => onFollowUp(v as FollowUpFilter)}>
            <SelectTrigger className="h-8 text-[13px] bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="active">Has follow-up</SelectItem>
              <SelectItem value="none">No follow-up</SelectItem>
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label="Recipient">
          <Input
            value={recipientFilter}
            onChange={(e) => onRecipient(e.target.value)}
            placeholder="Name or contact"
            className="h-8 text-[13px] bg-background"
          />
        </FilterField>
        <FilterField label="From">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => onDateFrom(e.target.value)}
            className="h-8 text-[13px] bg-background"
          />
        </FilterField>
        <FilterField label="To">
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => onDateTo(e.target.value)}
            className="h-8 text-[13px] bg-background"
          />
        </FilterField>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {resultCount} of {totalCount} shown
        </span>
        <Button variant="ghost" size="sm" className="h-7 text-[12px]" onClick={onReset}>
          Reset filters
        </Button>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function TouchlogRow({
  touch: t,
  isLatest,
  authorName,
  correctedBy,
  correctionTargetDate,
  evidencedFor,
  canEdit,
  today,
  onCorrect,
}: {
  touch: Touch;
  isLatest: boolean;
  authorName: string;
  correctedBy: Touch | null;
  correctionTargetDate: string | null;
  /** Transitions this touch was recorded as evidence for; null = none. */
  evidencedFor: EvidencedTransition[] | null;
  canEdit: boolean;
  today: string;
  onCorrect: () => void;
}) {
  const isTouchpoint = t.entryType === "touchpoint" && t.touchType;
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
  if (isTouchpoint) {
    const Icon = TOUCH_TYPE_ICON[t.touchType as TouchType] ?? Phone;
    leftBadge = (
      <Badge
        variant="outline"
        className="text-[11px] h-5 px-1.5 font-medium bg-background gap-1 text-muted-foreground"
      >
        <Icon className="w-3 h-3" /> {TOUCH_TYPE_LABELS[t.touchType as TouchType]}
      </Badge>
    );
    heading = t.outcome ? (
      <span className="text-[13px] text-foreground font-medium">· {outcomeLabel(t.outcome)}</span>
    ) : null;
  } else if (t.entryType === "note") {
    leftBadge = <EntryBadge icon={StickyNote} label="Note" />;
  } else if (t.entryType === "task_update") {
    leftBadge = <EntryBadge icon={CheckSquare} label="Task update" />;
  } else {
    leftBadge = <EntryBadge icon={Info} label="System" />;
  }

  const followStatus = followUpStatus(t.nextFollowUpDate, today);

  return (
    // The anchor the status timeline's "evidence" link scrolls to (screen 6).
    <div id={`touch-${t.id}`} className="relative pl-6 border-l-2 border-muted pb-2 scroll-mt-24">
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
          {t.correctsTouchId ? (
            <Badge
              variant="outline"
              className="text-[11px] h-5 px-1.5 font-medium bg-[#FEF3C7] border-[#FDE68A] text-[#92400E] gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              {correctionTargetDate
                ? `Correction of ${fmtDate(correctionTargetDate)}`
                : "Correction"}
            </Badge>
          ) : null}
          {/* Reverse of the Status history panel's evidence link: a touch that
              moved the case says so on its own row and links back to the
              transition it evidenced. A touch evidencing nothing renders
              nothing. The target lives in the unfiltered history panel, so
              this anchor always resolves. */}
          {(evidencedFor ?? []).map((ev) => (
            <a
              key={ev.historyId}
              href={`#status-${ev.historyId}`}
              className="inline-flex h-5 items-center gap-1 rounded-[4px] border border-[#E8E5E0] bg-[var(--mp-brand-tint)] px-1.5 text-[11px] font-medium text-[var(--mp-brand-ink)] no-underline hover:underline"
            >
              <History className="w-3 h-3" />
              Evidence for {ev.fromStatus ? `${caseStatusLabel(ev.fromStatus)} → ` : ""}
              {caseStatusLabel(ev.toStatus)}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[12px] text-muted-foreground flex items-center gap-1">
            <User className="w-3 h-3" /> {authorName}
          </span>
          {canEdit && isTouchpoint ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[12px] text-muted-foreground"
              onClick={onCorrect}
            >
              Correct
            </Button>
          ) : null}
        </div>
      </div>

      {t.recipientName || t.recipientContact ? (
        <p className="text-[12px] text-muted-foreground mt-0.5">
          <span className="font-medium text-foreground">Recipient:</span>{" "}
          {[t.recipientName, t.recipientContact].filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {t.notes ? (
        <p className="text-[13px] text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-wrap">
          {t.notes}
        </p>
      ) : null}

      {correctedBy ? (
        <div className="mt-2 text-[12px] text-[#92400E] inline-flex items-center gap-1 font-medium bg-[#FEF3C7] px-2 py-0.5 rounded">
          <RotateCcw className="w-3 h-3" /> Corrected by a later entry (
          {fmtDate(correctedBy.touchDate)})
        </div>
      ) : null}

      {t.clearsFollowUp ? (
        <div className="mt-2 text-[12px] text-muted-foreground inline-flex items-center gap-1">
          <Calendar className="w-3 h-3" /> Follow-up cleared
        </div>
      ) : t.nextFollowUpDate ? (
        <div
          className={`mt-2 text-[12px] inline-flex items-center gap-1 font-medium px-2 py-0.5 rounded ${
            followStatus === "overdue"
              ? "text-[#B91C1C] bg-[#FEF2F2]"
              : "text-[#D97706] bg-[#FEF3C7]"
          }`}
        >
          <Calendar className="w-3 h-3" />
          {followStatus === "overdue" ? "Follow-up overdue: " : "Next follow-up: "}
          {fmtDate(t.nextFollowUpDate)}
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
