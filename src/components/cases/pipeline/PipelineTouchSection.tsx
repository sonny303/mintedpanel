// E4.1 F4.1.8 / TE-11 — the optional "Log this as a touch" section for pipeline
// transition dialogs. Off by default; when enabled it collects the same
// structured touch fields as the case Touchlog (type preselected from the
// transition, context prefilled from the reason). Controlled by the parent
// dialog (state + onChange) so the confirm handler can read the assembled touch;
// the pure pipelineTouchInput / pipelineTouchBlocked helpers keep the assembly
// and the "Other needs context" rule testable and out of the confirm path.
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
import { CANONICAL_TOUCH_TYPES, TOUCH_TYPE_LABELS } from "@/lib/touchTypes";
import {
  dispositionRequiresContext,
  OTHER_DISPOSITION,
  TOUCH_DISPOSITIONS,
} from "@/lib/touchDispositions";
import type { TouchInput } from "@/services/touches";
import type { TouchOutcome, TouchType } from "@/types";

const NO_OUTCOME = "__none__";

export interface PipelineTouchState {
  enabled: boolean;
  touchType: TouchType;
  outcome: string;
  recipientName: string;
  recipientContact: string;
  context: string;
  followUpDate: string;
}

export function initialPipelineTouchState(
  defaultType: TouchType,
  defaultContext: string,
): PipelineTouchState {
  return {
    enabled: false,
    touchType: defaultType,
    outcome: NO_OUTCOME,
    recipientName: "",
    recipientContact: "",
    context: defaultContext,
    followUpDate: "",
  };
}

// The assembled touch (source stays 'manual' via logTouch's default), or null
// when the section is disabled. Blocked states still return an input; the dialog
// gates confirm on pipelineTouchBlocked separately.
export function pipelineTouchInput(state: PipelineTouchState, today: string): TouchInput | null {
  if (!state.enabled) return null;
  return {
    touchDate: today,
    touchType: state.touchType,
    outcome: state.outcome === NO_OUTCOME ? null : (state.outcome as TouchOutcome),
    recipientName: state.recipientName.trim() ? state.recipientName.trim() : null,
    recipientContact: state.recipientContact.trim() ? state.recipientContact.trim() : null,
    notes: state.context.trim() ? state.context.trim() : null,
    nextFollowUpDate: state.followUpDate || null,
  };
}

// F4.1.4 — "Other" disposition requires a one-line context; block confirm until
// it is present (only when the section is enabled).
export function pipelineTouchBlocked(state: PipelineTouchState): boolean {
  return (
    state.enabled &&
    dispositionRequiresContext(state.outcome as TouchOutcome) &&
    !state.context.trim()
  );
}

export function PipelineTouchSection({
  state,
  onChange,
}: {
  state: PipelineTouchState;
  onChange: (next: PipelineTouchState) => void;
}) {
  const set = (patch: Partial<PipelineTouchState>) => onChange({ ...state, ...patch });

  return (
    <div className="rounded-md border border-[#E8E5E0] p-3 space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={state.enabled}
          onCheckedChange={(v) => set({ enabled: Boolean(v) })}
          aria-label="Log this as a touch"
        />
        <span className="text-[13px] font-medium">Log this as a touch</span>
      </label>

      {state.enabled ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Type
              </Label>
              <Select
                value={state.touchType}
                onValueChange={(v) => set({ touchType: v as TouchType })}
              >
                <SelectTrigger className="h-8 text-[13px]">
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
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Outcome <span className="normal-case text-muted-foreground/70">(optional)</span>
              </Label>
              <Select value={state.outcome} onValueChange={(v) => set({ outcome: v })}>
                <SelectTrigger className="h-8 text-[13px]">
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
                Recipient
              </Label>
              <Input
                value={state.recipientName}
                onChange={(e) => set({ recipientName: e.target.value })}
                placeholder="Who you contacted"
                className="h-8 text-[13px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Follow-up
              </Label>
              <Input
                type="date"
                value={state.followUpDate}
                onChange={(e) => set({ followUpDate: e.target.value })}
                className="h-8 text-[13px]"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {state.outcome === OTHER_DISPOSITION ? "Context (required for Other)" : "Context"}
            </Label>
            <Textarea
              value={state.context}
              onChange={(e) => set({ context: e.target.value })}
              placeholder="One line about this touch…"
              className="min-h-[52px] text-[13px] resize-none"
            />
            {pipelineTouchBlocked(state) ? (
              <p className="text-[11px] text-[#B91C1C]">
                A one-line context is required for “Other”.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
