// E6.1 F6.1.4 — Org Detail (renamed from Account Detail), slimmed to the
// container page: org summary + authorized/organization contacts, People
// Enroll (party/role management), member management (relocated from the
// retired /admin/settings page), capture-link re-issue, and the Finish-setup
// banner while the one-time wizard is incomplete. The Organization-data
// (group/facility/roster summaries) and Payer-Network content move to the
// Groups item (E6.2; the /groups shell carries them meanwhile). The inbound
// leads triage queue stays here until E6.6 re-homes it into the Reporting
// Center (it renders only when leads await). The user's own profile section
// (display name → the {{user.name}} preparer token) rides along from the
// retired Settings page — it has no other home until a dedicated user-scoped
// surface exists (flagged in the E6.1 PR).
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Separator } from "@/components/ui/separator";
import { AccountDetailSummary } from "@/components/org/AccountDetailSummary";
import { FinishSetupBanner } from "@/components/org/FinishSetupBanner";
import { CaptureLinkPanel } from "@/components/org/CaptureLinkPanel";
import { InboundLeadsPanel } from "@/components/org/InboundLeadsPanel";
import { PartiesManager } from "@/components/org/PartiesManager";
import { MembersPanel } from "@/components/settings/MembersPanel";
import { ProfilePanel } from "@/components/settings/ProfilePanel";
import { QueueSettingsPanel } from "@/components/settings/QueueSettingsPanel";
import { ReasonCodeManager } from "@/components/settings/ReasonCodeManager";
import { ResolutionIdSettingsSection } from "@/components/settings/ResolutionIdSettingsSection";

export const Route = createFileRoute("/org-detail")({
  component: OrgDetailPage,
});

function OrgDetailPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Org Detail" />
      {/* F6.1.5: shown until the one-time wizard completes, then never again. */}
      <FinishSetupBanner />
      {/* Read-only summary of org intake outputs (org, authorized contact,
          organization contact, address). */}
      <AccountDetailSummary />
      {/* E0.5 F0.5.5 / TE-7: inbound "contact us" triage (renders only when
          leads await; E6.6 re-homes it into the Reporting Center). */}
      <InboundLeadsPanel />
      {/* E0.3: the org's people and their roles — People Enroll. */}
      <PartiesManager />
      {/* F6.1.4: member management (invite, role change) relocated from the
          retired Settings page. */}
      <MembersPanel />
      {/* E0.5 capture-link re-issue (BD-1/BD-2 — copy-able link + email). */}
      <CaptureLinkPanel />
      {/* E6.5: the payer-relevant ORGANIZATION settings moved here from the
          Payer Setup module's org-settings tab — org data lives with the org,
          the module keeps only the global authoring surfaces. */}
      <Separator />
      <section aria-labelledby="reason-codes-heading" className="space-y-3">
        <div>
          <h2 id="reason-codes-heading" className="text-[15px] font-semibold">
            Reason codes
          </h2>
          <p className="text-[12.5px] text-muted-foreground">
            The denial/return vocabulary used on case denials. Defaults are managed centrally;
            organization codes deactivate, never delete.
          </p>
        </div>
        <ReasonCodeManager />
      </section>
      <section aria-labelledby="queue-settings-heading" className="space-y-3">
        <div>
          <h2 id="queue-settings-heading" className="text-[15px] font-semibold">
            Queue settings
          </h2>
          <p className="text-[12.5px] text-muted-foreground">
            How this organization ranks the Cases to-do queue. The queue stays fully derived — this
            config is an input, never a stored priority.
          </p>
        </div>
        <QueueSettingsPanel />
      </section>
      <section aria-labelledby="resolution-ids-heading" className="space-y-3">
        <div>
          <h2 id="resolution-ids-heading" className="text-[15px] font-semibold">
            Resolution identifiers
          </h2>
          <p className="text-[12.5px] text-muted-foreground">
            What each payer calls its payer-issued enrollment ID at approval. Configured per
            organization; unconfigured payers fall back to the Minted default, then the generic
            “Payer-issued ID”.
          </p>
        </div>
        <ResolutionIdSettingsSection />
      </section>
      <Separator />
      {/* User-scoped: your display name ({{user.name}} on payer forms). */}
      <ProfilePanel />
    </div>
  );
}
