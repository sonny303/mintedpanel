// MINT-107 — the read-only view of one purpose's notification sequence, for
// members who are not admins. Specialists and billing members are the people
// these messages go to or cc, so they can see the schedule; only admins can
// change it (RLS enforces the same split). It shows the effective sequence:
// the org's own values, and Minted's default, marked as such, wherever the
// org left one unset.
import {
  PLATFORM_DEFAULT_LABEL,
  PURPOSE_RULES,
  STOP_CONDITION_LABELS,
  describeCcList,
  describeSendTime,
  describeStep,
  resolveNotificationSequence,
  type CcMemberOption,
  type NotificationSequenceConfig,
  type NotificationSequenceDefaultConfig,
} from "@/lib/notificationSequences";

const DEFAULT_SUFFIX = ` (${PLATFORM_DEFAULT_LABEL})`;

export function NotificationSequenceSummary({
  config,
  platformDefault,
  members,
  membersLoaded = true,
}: {
  config: NotificationSequenceConfig;
  platformDefault: NotificationSequenceDefaultConfig;
  members: ReadonlyMap<string, CcMemberOption>;
  /** False while the member list is loading or failed: no "Former member" yet. */
  membersLoaded?: boolean;
}) {
  const rules = PURPOSE_RULES[config.purpose];
  const effective = resolveNotificationSequence(config.purpose, config, platformDefault);
  const mark = (inherited: boolean) => (inherited ? DEFAULT_SUFFIX : "");
  const sendTime = describeSendTime(effective.sendHour, effective.sendTimeZone);
  return (
    <div className="space-y-3 text-[13px] text-foreground">
      {effective.inherited.steps ? (
        <div className="text-[12px] text-muted-foreground">{`${PLATFORM_DEFAULT_LABEL} steps`}</div>
      ) : null}
      <ol className="space-y-2">
        {effective.steps.map((step) => (
          <li key={step.position} className="rounded-md border border-[var(--mp-border)] px-3 py-2">
            <div className="font-medium">{describeStep(config.purpose, step)}</div>
            {rules.hasCcList ? (
              <div className="text-[12px] text-muted-foreground">
                Cc: {describeCcList(step.ccRecipients, members, membersLoaded)}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {rules.hasIntakeSettings ? (
        <dl className="space-y-1 text-[13px]">
          <div>
            <dt className="inline text-muted-foreground">Target: </dt>
            <dd className="inline">
              {`${effective.targetDaysToReady} days from invite to ready${mark(effective.inherited.targetDaysToReady)}`}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Stops when: </dt>
            <dd className="inline">
              {`${
                effective.stopConditions.length > 0
                  ? effective.stopConditions
                      .map((c) => STOP_CONDITION_LABELS[c].toLowerCase())
                      .join("; ")
                  : "never stops early"
              }${mark(effective.inherited.stopConditions)}`}
            </dd>
          </div>
          <div>
            <dt className="inline text-muted-foreground">Near a start date: </dt>
            <dd className="inline">
              {`${
                effective.compressTowardStartDate
                  ? "reminders move closer together"
                  : "reminders keep their days"
              }. Minted sets this.`}
            </dd>
          </div>
        </dl>
      ) : null}
      {rules.hasSendTime && sendTime ? <p>{`Sent around ${sendTime}. Minted sets this.`}</p> : null}
      {!rules.hasCcList ? (
        <p className="text-[12px] text-muted-foreground">
          Goes to each coordinator only. No one is cc'd.
        </p>
      ) : null}
    </div>
  );
}
