// MINT-107 — the admin editor for one purpose's notification sequence. It is
// controlled and holds no state of its own: the section owns the draft and
// the live-region message, every change here goes through the pure helpers
// in src/lib/notificationSequences.ts, and nothing is saved until the admin
// presses Save.
//
// Minted's default sits under every setting. A setting the org has not set
// shows the default and says so; the admin can override it (type a target,
// tick a stop condition, "Customize steps") or go back to it (clear the
// target, "Use Minted's default"). Compression and the digest's send time are
// Minted's alone: shown read-only, never editable here.
//
// Step slots are keyed by position, because the offset belongs to the slot.
// Moving a step's message therefore leaves focus in the old slot, so after a
// move the handler focuses the same arrow in the destination slot (or the
// other arrow at the top or bottom) and announces "Moved to step N".
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
  PLATFORM_DEFAULT_LABEL,
  PURPOSE_RULES,
  STOP_CONDITIONS,
  STOP_CONDITION_LABELS,
  addStep,
  describeSendTime,
  describeStep,
  moveStep,
  removeStep,
  resolveNotificationSequence,
  stepMoveFocusTarget,
  stepsFromDefault,
  toggleStopCondition,
  updateStep,
  type CcMemberOption,
  type NotificationSequenceConfig,
  type NotificationSequenceDefaultConfig,
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

/** Focus an element after React has committed the next render. Not a hook. */
function focusAfterRender(id: string) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.requestAnimationFrame(() => document.getElementById(id)?.focus());
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

/** The platform-managed settings, read-only: Minted sets them (Mission Control later). */
function PlatformSettings({
  purpose,
  saved,
  platformDefault,
}: {
  purpose: NotificationPurpose;
  saved: NotificationSequenceConfig | undefined;
  platformDefault: NotificationSequenceDefaultConfig;
}) {
  const rules = PURPOSE_RULES[purpose];
  // The saved row, not the draft: the draft never holds these settings.
  const effective = resolveNotificationSequence(purpose, saved, platformDefault);
  if (rules.hasSendTime) {
    const when = describeSendTime(effective.sendHour, effective.sendTimeZone);
    return when ? (
      <p className="text-[13px] text-foreground">{`Sent around ${when}. Minted sets this.`}</p>
    ) : null;
  }
  if (rules.hasIntakeSettings) {
    const effect = effective.compressTowardStartDate
      ? "reminders move closer together"
      : "reminders keep their days";
    return (
      <p className="text-[13px] text-foreground">{`Near a start date: ${effect}. Minted sets this.`}</p>
    );
  }
  return null;
}

export interface NotificationSequenceEditorProps {
  purpose: NotificationPurpose;
  draft: SequenceDraft;
  issues: SequenceIssue[];
  /** Minted's default for this purpose: what every unset setting uses. */
  platformDefault: NotificationSequenceDefaultConfig;
  /** The org's saved row, for the platform-managed overrides Minted may have set. */
  saved?: NotificationSequenceConfig;
  members: ReadonlyMap<string, CcMemberOption>;
  /** False while the member list is loading or failed. */
  membersLoaded?: boolean;
  /** No row exists yet: the draft is the starter. */
  isNew: boolean;
  dirty: boolean;
  saving: boolean;
  /** Another admin saved while this draft had unsaved edits. */
  staleNotice?: boolean;
  /** The polite live-region text, e.g. "Moved to step 2". */
  announcement?: string;
  onChange: (draft: SequenceDraft) => void;
  onAnnounce?: (message: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function NotificationSequenceEditor({
  purpose,
  draft,
  issues,
  platformDefault,
  saved,
  members,
  membersLoaded = true,
  isNew,
  dirty,
  saving,
  staleNotice = false,
  announcement = "",
  onChange,
  onAnnounce,
  onSave,
  onCancel,
}: NotificationSequenceEditorProps) {
  const rules = PURPOSE_RULES[purpose];
  const templates = selectableTemplates(purpose);
  const idPrefix = `notifications-${purpose}`;
  const ownSteps = draft.steps;
  const arrowId = (index: number, arrow: "up" | "down") =>
    `${idPrefix}-step-${index + 1}-move-${arrow}`;
  const move = (index: number, direction: -1 | 1) => {
    if (!ownSteps) return;
    const dest = index + direction;
    onChange(moveStep(draft, index, direction));
    onAnnounce?.(`Moved to step ${dest + 1}`);
    focusAfterRender(arrowId(dest, stepMoveFocusTarget(dest, direction, ownSteps.length)));
  };
  const sequenceIssues = (field: SequenceIssue["field"]) =>
    issues.filter((issue) => issue.stepIndex == null && issue.field === field);
  const defaultSteps = [...platformDefault.steps].sort((a, b) => a.position - b.position);
  const usesSms = (ownSteps ?? defaultSteps).some((step) => step.channel === "sms");
  const defaultTarget = platformDefault.targetDaysToReady;
  const stops = draft.stopConditions ?? platformDefault.stopConditions ?? [];

  return (
    <div className="space-y-4">
      {staleNotice ? (
        <p
          role="status"
          className="rounded-md border border-[var(--mp-warn-tint)] bg-[var(--mp-warn-tint)] px-3 py-2 text-[13px] text-[var(--mp-warn-ink)]"
        >
          Another admin saved changes. Reload to see them; your edits aren't saved.
        </p>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
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

      {ownSteps && rules.stepsEditable ? (
        <>
          <ol className="space-y-3" aria-label={`${rules.label} steps`}>
            {ownSteps.map((step, index) => {
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
                          id={arrowId(index, "up")}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Move step ${n} up`}
                          disabled={index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          type="button"
                          id={arrowId(index, "down")}
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Move step ${n} down`}
                          disabled={index === ownSteps.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={`Remove step ${n}`}
                          disabled={ownSteps.length === 1}
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
                          onChange(
                            updateStep(draft, index, { channel: value as NotificationChannel }),
                          )
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

                  {rules.hasCcList ? (
                    <NotificationCcRecipients
                      step={step}
                      stepNumber={n}
                      members={members}
                      membersLoaded={membersLoaded}
                      bounceNote={index === 0}
                      onChange={(next) => onChange(updateStep(draft, index, next))}
                    />
                  ) : null}
                  <IssueText issues={stepIssues} />
                </li>
              );
            })}
          </ol>
          <IssueText issues={sequenceIssues("steps")} />
          <div className="flex flex-wrap items-center gap-2">
            {ownSteps.length < rules.maxSteps ? (
              <AddButton label="Add step" onClick={() => onChange(addStep(purpose, draft))} />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...draft, steps: null })}
            >
              {`Use ${PLATFORM_DEFAULT_LABEL} steps`}
            </Button>
          </div>
        </>
      ) : (
        <section
          aria-label={`${rules.label} steps`}
          className="space-y-2 rounded-md border border-[var(--mp-border)] p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-[13px] font-semibold text-foreground">
              {ownSteps ? "Steps" : `${PLATFORM_DEFAULT_LABEL} steps`}
            </h4>
            {rules.stepsEditable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange({ ...draft, steps: stepsFromDefault(platformDefault) })}
              >
                Customize steps
              </Button>
            ) : null}
          </div>
          <ol className="space-y-1 text-[13px] text-foreground">
            {(ownSteps ?? defaultSteps).map((step, index) => (
              <li key={index}>
                {describeStep(purpose, {
                  position: index + 1,
                  offsetDays: step.offsetDays ?? 0,
                  channel: step.channel,
                  templateKey: step.templateKey,
                })}
              </li>
            ))}
          </ol>
          <p className="text-[12px] text-muted-foreground">
            {rules.hasCcList
              ? "Minted's default steps cc no one, so a bounce on step 1 reaches no one. Customize the steps to cc a member or a role."
              : "Goes to each coordinator only. No one is cc'd."}
          </p>
        </section>
      )}

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
              placeholder={defaultTarget == null ? undefined : String(defaultTarget)}
              aria-describedby={`${idPrefix}-target-help`}
              value={draft.targetDaysToReady ?? ""}
              onChange={(e) =>
                onChange({ ...draft, targetDaysToReady: parseWholeNumber(e.target.value) })
              }
            />
            <p id={`${idPrefix}-target-help`} className="text-[12px] text-muted-foreground">
              {draft.targetDaysToReady == null
                ? `Using ${PLATFORM_DEFAULT_LABEL}, ${defaultTarget} days. Enter a number to change it.`
                : `${PLATFORM_DEFAULT_LABEL} is ${defaultTarget} days. Clear the box to use it.`}
            </p>
            <IssueText issues={sequenceIssues("targetDaysToReady")} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-[12px] font-medium text-muted-foreground">
              Stop reminders when
            </legend>
            {STOP_CONDITIONS.map((condition) => {
              const id = `${idPrefix}-stop-${condition}`;
              return (
                <div key={condition} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={stops.includes(condition)}
                    onCheckedChange={(value) =>
                      onChange(
                        toggleStopCondition(draft, platformDefault, condition, value === true),
                      )
                    }
                  />
                  <Label htmlFor={id} className="text-[13px] font-normal">
                    {STOP_CONDITION_LABELS[condition]}
                  </Label>
                </div>
              );
            })}
            {draft.stopConditions == null ? (
              <p className="text-[12px] text-muted-foreground">{`Using ${PLATFORM_DEFAULT_LABEL}.`}</p>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Use ${PLATFORM_DEFAULT_LABEL} stop conditions`}
                onClick={() => onChange({ ...draft, stopConditions: null })}
              >
                {`Use ${PLATFORM_DEFAULT_LABEL}`}
              </Button>
            )}
            <IssueText issues={sequenceIssues("stopConditions")} />
          </fieldset>
        </div>
      ) : null}

      <PlatformSettings purpose={purpose} saved={saved} platformDefault={platformDefault} />

      {usesSms ? (
        <p className="text-[12px] text-muted-foreground">
          Text messages aren't switched on yet, so SMS steps are skipped for now. Once they are,
          texts go only to providers who agreed to them in the intake form.
        </p>
      ) : null}
      {rules.hasCcList ? (
        <p className="text-[12px] text-muted-foreground">
          People cc'd on a step get an email copy, even on a text step. Copies never include an SSN,
          a date of birth or document contents.
        </p>
      ) : null}

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
