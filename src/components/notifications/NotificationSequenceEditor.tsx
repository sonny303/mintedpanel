// MINT-107 — the admin editor for one purpose's notification sequence. It is
// controlled: the section owns the draft, every change here goes through the
// pure helpers in src/lib/notificationSequences.ts, and nothing is saved until
// the admin presses Save.
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { AddButton } from "@/components/providers/RecordSectionCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CHANNEL_LABELS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_LIMITS,
  PURPOSE_RULES,
  STOP_CONDITIONS,
  STOP_CONDITION_LABELS,
  addStep,
  moveStep,
  removeStep,
  updateStep,
  type CcMemberOption,
  type SequenceDraft,
  type SequenceIssue,
} from "@/lib/notificationSequences";
import {
  getNotificationTemplate,
  selectableTemplates,
  templateSupportsChannel,
} from "@/lib/notificationTemplates";
import type { NotificationChannel, NotificationPurpose } from "@/types";
import { NotificationCcRecipients } from "./NotificationCcRecipients";

function parseWholeNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function IssueText({ issues }: { issues: SequenceIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-[12px] text-[var(--mp-danger-ink)]">
      {issues.map((issue) => (
        <li key={`${issue.field}:${issue.message}`}>{issue.message}</li>
      ))}
    </ul>
  );
}

export interface NotificationSequenceEditorProps {
  purpose: NotificationPurpose;
  draft: SequenceDraft;
  issues: SequenceIssue[];
  members: ReadonlyMap<string, CcMemberOption>;
  /** No row exists yet: the draft is the starter. */
  isNew: boolean;
  dirty: boolean;
  saving: boolean;
  onChange: (draft: SequenceDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function NotificationSequenceEditor({
  purpose,
  draft,
  issues,
  members,
  isNew,
  dirty,
  saving,
  onChange,
  onSave,
  onCancel,
}: NotificationSequenceEditorProps) {
  const rules = PURPOSE_RULES[purpose];
  const templates = selectableTemplates(purpose);
  const idPrefix = `notifications-${purpose}`;
  const sequenceIssues = (field: SequenceIssue["field"]) =>
    issues.filter((issue) => issue.stepIndex == null && issue.field === field);
  const usesSms = draft.steps.some((step) => step.channel === "sms");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch
          id={`${idPrefix}-enabled`}
          checked={draft.enabled}
          onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
        />
        <Label htmlFor={`${idPrefix}-enabled`} className="text-[13px]">
          {rules.enabledLabel}
        </Label>
      </div>

      <ol className="space-y-3" aria-label={`${rules.label} steps`}>
        {draft.steps.map((step, index) => {
          const n = index + 1;
          const stepIssues = issues.filter((issue) => issue.stepIndex === index);
          const template = getNotificationTemplate(step.templateKey);
          const offsetId = `${idPrefix}-step-${n}-offset`;
          const channelId = `${idPrefix}-step-${n}-channel`;
          const templateId = `${idPrefix}-step-${n}-template`;
          return (
            <li key={n} className="space-y-3 rounded-md border border-[var(--mp-border)] p-4">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[13px] font-semibold text-foreground">Step {n}</h4>
                {rules.maxSteps > 1 ? (
                  <div className="flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Move step ${n} up`}
                      disabled={index === 0}
                      onClick={() => onChange(moveStep(draft, index, -1))}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Move step ${n} down`}
                      disabled={index === draft.steps.length - 1}
                      onClick={() => onChange(moveStep(draft, index, 1))}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Remove step ${n}`}
                      disabled={draft.steps.length === 1}
                      onClick={() => onChange(removeStep(draft, index))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {rules.fixedOffsetDays == null ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={offsetId} className="text-[12px] text-muted-foreground">
                      Days after invite
                    </Label>
                    <Input
                      id={offsetId}
                      type="number"
                      inputMode="numeric"
                      min={rules.minOffsetDays}
                      max={NOTIFICATION_LIMITS.maxOffsetDays}
                      step={1}
                      aria-label={`Step ${n} days after invite`}
                      value={step.offsetDays ?? ""}
                      onChange={(e) =>
                        onChange(
                          updateStep(draft, index, {
                            offsetDays: parseWholeNumber(e.target.value),
                          }),
                        )
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-[12px] font-medium text-muted-foreground">When</div>
                    <div className="flex h-9 items-center text-[13px] text-foreground">
                      Once a day
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor={channelId} className="text-[12px] text-muted-foreground">
                    Channel
                  </Label>
                  <Select
                    value={step.channel}
                    onValueChange={(value) =>
                      onChange(updateStep(draft, index, { channel: value as NotificationChannel }))
                    }
                  >
                    <SelectTrigger id={channelId} aria-label={`Step ${n} channel`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTIFICATION_CHANNELS.map((channel) => (
                        <SelectItem
                          key={channel}
                          value={channel}
                          disabled={!templateSupportsChannel(step.templateKey, channel)}
                        >
                          {CHANNEL_LABELS[channel]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={templateId} className="text-[12px] text-muted-foreground">
                    Message
                  </Label>
                  <Select
                    value={step.templateKey}
                    onValueChange={(templateKey) =>
                      onChange(updateStep(draft, index, { templateKey }))
                    }
                  >
                    <SelectTrigger id={templateId} aria-label={`Step ${n} message`}>
                      <SelectValue placeholder="Choose a message" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {template ? (
                <p className="text-[12px] text-muted-foreground">{template.description}</p>
              ) : null}

              <NotificationCcRecipients
                step={step}
                stepNumber={n}
                members={members}
                bounceNote={purpose === "intake_reminder" && index === 0}
                onChange={(next) => onChange(updateStep(draft, index, next))}
              />
              <IssueText issues={stepIssues} />
            </li>
          );
        })}
      </ol>
      <IssueText issues={sequenceIssues("steps")} />

      {draft.steps.length < rules.maxSteps ? (
        <AddButton label="Add step" onClick={() => onChange(addStep(purpose, draft))} />
      ) : null}

      {rules.hasIntakeSettings ? (
        <div className="space-y-4 rounded-md border border-[var(--mp-border)] p-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-target`} className="text-[12px] text-muted-foreground">
              Target days from invite to ready
            </Label>
            <Input
              id={`${idPrefix}-target`}
              type="number"
              inputMode="numeric"
              min={NOTIFICATION_LIMITS.minTargetDays}
              max={NOTIFICATION_LIMITS.maxTargetDays}
              step={1}
              className="w-full sm:w-[120px]"
              value={draft.targetDaysToReady ?? ""}
              onChange={(e) =>
                onChange({ ...draft, targetDaysToReady: parseWholeNumber(e.target.value) })
              }
            />
            <IssueText issues={sequenceIssues("targetDaysToReady")} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[12px] font-medium text-muted-foreground">
              Stop reminders when
            </legend>
            {STOP_CONDITIONS.map((condition) => {
              const id = `${idPrefix}-stop-${condition}`;
              const checked = draft.stopConditions.includes(condition);
              return (
                <div key={condition} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(value) =>
                      onChange({
                        ...draft,
                        stopConditions:
                          value === true
                            ? STOP_CONDITIONS.filter(
                                (c) => c === condition || draft.stopConditions.includes(c),
                              )
                            : draft.stopConditions.filter((c) => c !== condition),
                      })
                    }
                  />
                  <Label htmlFor={id} className="text-[13px] font-normal">
                    {STOP_CONDITION_LABELS[condition]}
                  </Label>
                </div>
              );
            })}
            <IssueText issues={sequenceIssues("stopConditions")} />
          </fieldset>

          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <Switch
                id={`${idPrefix}-compress`}
                checked={draft.compressTowardStartDate}
                onCheckedChange={(compressTowardStartDate) =>
                  onChange({ ...draft, compressTowardStartDate })
                }
              />
              <Label htmlFor={`${idPrefix}-compress`} className="text-[13px]">
                Move reminders closer together when a start date is near
              </Label>
            </div>
            <p className="text-[12px] text-muted-foreground">
              When a provider's start date comes before this schedule ends, the reminders are spread
              over the days left, and the last one goes out no later than the day before the start
              date.
            </p>
          </div>
        </div>
      ) : null}

      {usesSms ? (
        <p className="text-[12px] text-muted-foreground">
          Text messages aren't switched on yet, so SMS steps are skipped for now. Once they are,
          texts go only to providers who agreed to them in the intake form.
        </p>
      ) : null}
      <p className="text-[12px] text-muted-foreground">
        People cc'd on a step get an email copy, even on a text step. Copies never include an SSN, a
        date of birth or document contents.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          className="bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          disabled={saving || !dirty || issues.length > 0}
          onClick={onSave}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving || (!isNew && !dirty)}
          onClick={onCancel}
        >
          {isNew ? "Cancel" : "Discard changes"}
        </Button>
        {issues.length > 0 ? (
          <span className="text-[12px] text-[var(--mp-danger-ink)]">
            Fix the messages above to save.
          </span>
        ) : null}
      </div>
    </div>
  );
}
