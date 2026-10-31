// MINT-107 — the ordered cc list on one notification step. There is no
// default escalation chain: the list starts empty, and an admin adds members
// or whole roles and puts them in order with the arrow buttons (keyboard
// operable; no drag).
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CC_ROLES,
  CC_ROLE_LABELS,
  NOTIFICATION_LIMITS,
  addCcRecipient,
  ccRecipientLabel,
  moveCcRecipient,
  parseRecipientKey,
  recipientKey,
  removeCcRecipient,
  type CcMemberOption,
  type StepDraft,
} from "@/lib/notificationSequences";

export function NotificationCcRecipients({
  step,
  stepNumber,
  members,
  membersLoaded = true,
  bounceNote,
  onChange,
}: {
  step: StepDraft;
  stepNumber: number;
  members: ReadonlyMap<string, CcMemberOption>;
  /** False while the member list is loading or failed: no "Former member" yet. */
  membersLoaded?: boolean;
  /** True on intake step 1, where a bounce escalates to this list. */
  bounceNote: boolean;
  onChange: (step: StepDraft) => void;
}) {
  const listed = new Set(step.ccRecipients.map(recipientKey));
  const full = step.ccRecipients.length >= NOTIFICATION_LIMITS.maxCcRecipients;
  const memberOptions = [...members.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-2">
      <div className="text-[12px] font-medium text-muted-foreground">Cc on this step</div>
      {step.ccRecipients.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--mp-border)] px-3 py-2 text-[13px] text-muted-foreground">
          <p>No one is cc'd on this step.</p>
          <p className="text-[12px]">
            {bounceNote
              ? "If step 1 bounces, the people cc'd here are told. Add a member or a role so a bounce reaches someone."
              : "Add a member or a role to copy them on this step."}
          </p>
        </div>
      ) : (
        <ol className="space-y-1" aria-label={`People cc'd on step ${stepNumber}, in order`}>
          {step.ccRecipients.map((recipient, index) => {
            const label = ccRecipientLabel(recipient, members, membersLoaded);
            const last = index === step.ccRecipients.length - 1;
            return (
              <li
                key={recipientKey(recipient)}
                className="flex h-10 items-center justify-between gap-2 rounded-md border border-[var(--mp-border)] px-3"
              >
                <span className="flex min-w-0 items-center gap-2 text-[13px] text-foreground">
                  <span className="text-muted-foreground">{index + 1}.</span>
                  <span className="truncate">{label}</span>
                  <span className="text-[12px] text-muted-foreground">
                    {recipient.kind === "role" ? "Role" : "Member"}
                  </span>
                </span>
                <span className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Move ${label} up on step ${stepNumber}`}
                    disabled={index === 0}
                    onClick={() => onChange(moveCcRecipient(step, index, -1))}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Move ${label} down on step ${stepNumber}`}
                    disabled={last}
                    onClick={() => onChange(moveCcRecipient(step, index, 1))}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`Remove ${label} from step ${stepNumber}`}
                    onClick={() => onChange(removeCcRecipient(step, index))}
                  >
                    <X />
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <Select
        value=""
        disabled={full}
        onValueChange={(value) => {
          const recipient = parseRecipientKey(value);
          if (recipient) onChange(addCcRecipient(step, recipient));
        }}
      >
        <SelectTrigger
          className="h-9 w-full sm:w-[260px]"
          aria-label={`Add someone to cc on step ${stepNumber}`}
        >
          <SelectValue placeholder="Add a member or role" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Roles</SelectLabel>
            {CC_ROLES.map((role) => (
              <SelectItem key={role} value={`role:${role}`} disabled={listed.has(`role:${role}`)}>
                {CC_ROLE_LABELS[role]}
              </SelectItem>
            ))}
          </SelectGroup>
          {memberOptions.length > 0 ? (
            <SelectGroup>
              <SelectLabel>Members</SelectLabel>
              {memberOptions.map((member) => (
                <SelectItem
                  key={member.userId}
                  value={`user:${member.userId}`}
                  disabled={listed.has(`user:${member.userId}`)}
                >
                  {member.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
