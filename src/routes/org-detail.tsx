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
import { AccountDetailSummary } from "@/components/org/AccountDetailSummary";
import { FinishSetupBanner } from "@/components/org/FinishSetupBanner";
import { CaptureLinkPanel } from "@/components/org/CaptureLinkPanel";
import { InboundLeadsPanel } from "@/components/org/InboundLeadsPanel";
import { PartiesManager } from "@/components/org/PartiesManager";
import { MembersPanel } from "@/components/settings/MembersPanel";
import { ProfilePanel } from "@/components/settings/ProfilePanel";

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
      {/* User-scoped: your display name ({{user.name}} on payer forms). */}
      <ProfilePanel />
    </div>
  );
}
