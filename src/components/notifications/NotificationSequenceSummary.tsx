// MINT-107 — the read-only view of one purpose's notification sequence, for
// members who are not admins. Specialists and billing members are the people
// these messages go to or cc, so they can see the schedule; only admins can
// change it (RLS enforces the same split).
import {
  CHANNEL_LABELS,
  STOP_CONDITIONS,
  STOP_CONDITION_LABELS,
  describeCcList,
  type CcMemberOption,
  type NotificationSequenceConfig,
} from "@/lib/notificationSequences";
import { getNotificationTemplate } from "@/lib/notificationTemplates";

export function NotificationSequenceSummary({
  config,
  members,
}: {
  config: NotificationSequenceConfig;
  members: ReadonlyMap<string, CcMemberOption>;
}) {
  const intake = config.purpose === "intake_reminder";
  const stops = STOP_CONDITIONS.filter((c) => config.stopConditions.includes(c));
  return (
    <div className="space-y-3 text-[13px] text-foreground">
      <ol className="space-y-2">
        {config.steps.map((step) => (
          <li key={step.id} className="rounded-md border border-[var(--mp-border)] px-3 py-2">
            <div className="font-medium">
              Step {step.position}
              {intake ? ` · day ${step.offsetDays} after the invite` : " · once a day"}
              {` · ${CHANNEL_LABELS[step.channel]}`}
              {` · ${getNotificationTemplate(step.templateKey)?.label ?? step.templateKey}`}
            </div>
            <div className="text-[12px] text-muted-foreground">
              Cc: {describeCcList(step.ccRecipients, members)}
            </div>
          </li>
        ))}
      </ol>
      {intake ? (
        <dl className="space-y-1 text-[13px]">
          <div>
            <dt className="inline text-muted-foreground">Target: </dt>
            <dd className="inline">{config.targetDaysToReady} days from invite to ready</dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Stops when: </dt>
            <dd className="inline">
              {stops.length > 0
                ? stops.map((c) => STOP_CONDITION_LABELS[c].toLowerCase()).join("; ")
                : "never stops early"}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Near a start date: </dt>
            <dd className="inline">
              {config.compressTowardStartDate
                ? "reminders move closer together"
                : "reminders keep their days"}
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
