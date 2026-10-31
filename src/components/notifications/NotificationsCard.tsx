// MINT-107 — the Notifications card on Org Detail: this organization's
// reminder and digest schedules. Organization-level only; there is no
// cross-tenant view (that is Mission Control M6).
//
// Admins edit. Every other member sees a read-only summary: specialists and
// billing members are who these messages go to or cc, so hiding the schedule
// would only surprise them. RLS gives members the same read and admins alone
// the write.
//
// A purpose with no saved row is off. "Set up" loads a suggested starter into
// the editor (switched off, cc'ing no one); nothing is written until Save.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useNotificationSequences,
  useSaveNotificationSequence,
} from "@/hooks/useNotificationSequences";
import { useMemberships } from "@/hooks/useOrgSettings";
import { useIsAdmin } from "@/lib/permissions";
import {
  NOTIFICATION_PURPOSES,
  PURPOSE_RULES,
  buildSavePayload,
  describeOffsets,
  draftFromSequence,
  draftsEqual,
  starterDraft,
  validateDraft,
  type CcMemberOption,
  type NotificationSequenceConfig,
  type SequenceDraft,
} from "@/lib/notificationSequences";
import type { NotificationPurpose } from "@/types";
import { NotificationSequenceEditor } from "./NotificationSequenceEditor";
import { NotificationSequenceSummary } from "./NotificationSequenceSummary";

function starterSummary(purpose: NotificationPurpose): string {
  const starter = starterDraft(purpose);
  if (purpose === "followup_digest") {
    return "Set up starts you with a suggestion: one email a day, cc'ing no one, switched off until you turn it on. You can change it before you save.";
  }
  const offsets = starter.steps.map((s) => s.offsetDays ?? 0);
  return `Set up starts you with a suggestion: ${starter.steps.length} emails, on ${describeOffsets(offsets)} after the invite, cc'ing no one, switched off until you turn it on. You can change any of it before you save.`;
}

function AdminSequence({
  purpose,
  saved,
  members,
  memberUserIds,
}: {
  purpose: NotificationPurpose;
  saved: NotificationSequenceConfig | undefined;
  members: ReadonlyMap<string, CcMemberOption>;
  memberUserIds: ReadonlySet<string> | undefined;
}) {
  const save = useSaveNotificationSequence();
  const [draft, setDraft] = useState<SequenceDraft | null>(() =>
    saved ? draftFromSequence(saved) : null,
  );

  if (!draft) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] text-muted-foreground">{starterSummary(purpose)}</p>
        <Button
          type="button"
          variant="outline"
          aria-label={`Set up ${PURPOSE_RULES[purpose].label.toLowerCase()}`}
          onClick={() => setDraft(starterDraft(purpose))}
        >
          Set up
        </Button>
      </div>
    );
  }

  const issues = validateDraft(purpose, draft, { memberUserIds });
  const dirty = saved ? !draftsEqual(draft, draftFromSequence(saved)) : true;

  const handleSave = () => {
    const payload = buildSavePayload(purpose, draft, saved?.revision ?? null, { memberUserIds });
    save.mutate(
      { purpose, payload },
      {
        onSuccess: () => toast.success(`${PURPOSE_RULES[purpose].label} saved`),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Couldn't save the notification settings."),
      },
    );
  };

  return (
    <NotificationSequenceEditor
      purpose={purpose}
      draft={draft}
      issues={issues}
      members={members}
      isNew={!saved}
      dirty={dirty}
      saving={save.isPending}
      onChange={setDraft}
      onSave={handleSave}
      onCancel={() => setDraft(saved ? draftFromSequence(saved) : null)}
    />
  );
}

function SequenceSection({
  purpose,
  saved,
  isAdmin,
  members,
  memberUserIds,
}: {
  purpose: NotificationPurpose;
  saved: NotificationSequenceConfig | undefined;
  isAdmin: boolean;
  members: ReadonlyMap<string, CcMemberOption>;
  memberUserIds: ReadonlySet<string> | undefined;
}) {
  const rules = PURPOSE_RULES[purpose];
  const headingId = `notifications-${purpose}-heading`;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-[13.5px] font-semibold text-foreground">
          {rules.label}
        </h3>
        {saved ? (
          <StatusPill
            status={saved.enabled ? "green" : "neutral"}
            label={saved.enabled ? "On" : "Off"}
          />
        ) : (
          <StatusPill status="gray" label="Not set up" />
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">{rules.description}</p>
      {isAdmin ? (
        // Remount on every saved revision so the draft restarts from what was saved.
        <AdminSequence
          key={saved ? `revision-${saved.revision}` : "new"}
          purpose={purpose}
          saved={saved}
          members={members}
          memberUserIds={memberUserIds}
        />
      ) : saved ? (
        <NotificationSequenceSummary config={saved} members={members} />
      ) : (
        <p className="text-[13px] text-muted-foreground">Not set up. An admin can set this up.</p>
      )}
    </section>
  );
}

export function NotificationsCard() {
  const isAdmin = useIsAdmin();
  const sequencesQ = useNotificationSequences();
  const membersQ = useMemberships();

  const members = useMemo(() => {
    const map = new Map<string, CcMemberOption>();
    for (const m of membersQ.data ?? []) {
      map.set(m.userId, { userId: m.userId, name: m.fullName || m.email || "Unnamed member" });
    }
    return map;
  }, [membersQ.data]);
  const memberUserIds = membersQ.data ? new Set(members.keys()) : undefined;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold text-foreground">Notifications</h2>
          <p className="text-[13px] text-muted-foreground">
            Reminder and digest schedules for this organization. Minted Panel doesn't send these
            messages yet; what you save here takes effect once sending is switched on. Nothing is
            sent while a schedule is off.
          </p>
        </div>
        {sequencesQ.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16 rounded-md" />
          </div>
        ) : sequencesQ.isError ? (
          <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
            We couldn't load this organization's notification settings.
          </div>
        ) : (
          NOTIFICATION_PURPOSES.map((purpose, index) => (
            <div key={purpose} className="space-y-4">
              {index > 0 ? <Separator /> : null}
              <SequenceSection
                purpose={purpose}
                saved={sequencesQ.data?.[purpose]}
                isAdmin={isAdmin}
                members={members}
                memberUserIds={memberUserIds}
              />
            </div>
          ))
        )}
        {!isAdmin && !sequencesQ.isLoading && !sequencesQ.isError ? (
          <p className="text-[12px] text-muted-foreground">Only admins can change notifications.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
