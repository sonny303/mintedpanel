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
  reconcileWithServer,
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
  membersLoaded,
  memberUserIds,
}: {
  purpose: NotificationPurpose;
  saved: NotificationSequenceConfig | undefined;
  members: ReadonlyMap<string, CcMemberOption>;
  membersLoaded: boolean;
  memberUserIds: ReadonlySet<string> | undefined;
}) {
  const save = useSaveNotificationSequence();
  // `base` is the saved config the open draft started from. A refetch that
  // brings a new revision is reconciled against it below, so another admin's
  // save never silently replaces unsaved edits.
  const [base, setBase] = useState<NotificationSequenceConfig | undefined>(saved);
  const [draft, setDraft] = useState<SequenceDraft | null>(() =>
    saved ? draftFromSequence(saved) : null,
  );
  const [ownSavedRevision, setOwnSavedRevision] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const sync = reconcileWithServer({ base, saved, draft, ownSavedRevision });
  if (sync === "adopt_server") {
    // Nothing unsaved would be lost: follow the server. Setting state while
    // rendering makes React re-render at once with it; the next pass is in
    // sync, so this cannot loop.
    setBase(saved);
    setDraft(saved ? draftFromSequence(saved) : null);
  }
  const followServer = () => {
    setBase(saved);
    setDraft(saved ? draftFromSequence(saved) : null);
  };

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
  const dirty = base ? !draftsEqual(draft, draftFromSequence(base)) : true;

  const handleSave = () => {
    // The revision the draft started from: if another admin has saved since,
    // the RPC answers with the conflict instead of overwriting their change.
    const payload = buildSavePayload(purpose, draft, base?.revision ?? null, { memberUserIds });
    save.mutate(
      { purpose, payload },
      {
        onSuccess: (config) => {
          setOwnSavedRevision(config.revision);
          toast.success(`${PURPOSE_RULES[purpose].label} saved`);
        },
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
      membersLoaded={membersLoaded}
      isNew={!base}
      dirty={dirty}
      saving={save.isPending}
      staleNotice={sync === "keep_draft"}
      announcement={announcement}
      onChange={setDraft}
      onAnnounce={setAnnouncement}
      onSave={handleSave}
      onCancel={() => (base || saved ? followServer() : setDraft(null))}
    />
  );
}

function SequenceSection({
  purpose,
  saved,
  isAdmin,
  members,
  membersLoaded,
  memberUserIds,
}: {
  purpose: NotificationPurpose;
  saved: NotificationSequenceConfig | undefined;
  isAdmin: boolean;
  members: ReadonlyMap<string, CcMemberOption>;
  membersLoaded: boolean;
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
        <AdminSequence
          purpose={purpose}
          saved={saved}
          members={members}
          membersLoaded={membersLoaded}
          memberUserIds={memberUserIds}
        />
      ) : saved ? (
        <NotificationSequenceSummary
          config={saved}
          members={members}
          membersLoaded={membersLoaded}
        />
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
  // Until the member list has loaded (or after it failed) a cc'd user cannot be
  // judged: they read as "Member", not "Former member", and do not block Save.
  const membersLoaded = membersQ.isSuccess;
  const memberUserIds = membersLoaded ? new Set(members.keys()) : undefined;
  const result = sequencesQ.data;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-1">
          <h2 className="text-[15px] font-semibold text-foreground">Notifications</h2>
          {result?.status === "unavailable" ? (
            // Deploy order: the migration is not applied to this database yet.
            <p className="text-[13px] text-muted-foreground">
              Notification settings will appear here once they're switched on for your organization.
            </p>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Reminder and digest schedules for this organization. Minted Panel doesn't send these
              messages yet; what you save here takes effect once sending is switched on. Nothing is
              sent while a schedule is off.
            </p>
          )}
        </div>
        {result?.status === "unavailable" ? null : sequencesQ.isLoading ? (
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
                saved={result?.status === "available" ? result.sequences[purpose] : undefined}
                isAdmin={isAdmin}
                members={members}
                membersLoaded={membersLoaded}
                memberUserIds={memberUserIds}
              />
            </div>
          ))
        )}
        {!isAdmin && result?.status === "available" ? (
          <p className="text-[12px] text-muted-foreground">Only admins can change notifications.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
