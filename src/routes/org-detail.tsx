// E6.1 F6.1.4 — Org Detail (renamed from Account Detail), slimmed to the
// container page: org summary + authorized/organization contacts, People
// Enroll (party/role management), member management (relocated from the
// retired /admin/settings page), and the Finish-setup banner while the
// one-time wizard is incomplete. The E0.5 capture-link re-issue card was
// removed from MVP by user request (2026-07-19) — the /onboarding "Share
// onboarding link" journey and the public /capture/$token route remain the
// capture-link surfaces. Inbound-leads triage moved
// to the Reporting Center's Intake report (E6.6 F6.6.1), and the reason-code
// + queue-ranking editors are GONE — both vocabularies ship as fixed defaults
// (E6.6 F6.6.6; documented in src/services/cases.ts `listDenialReasonCodes`
// and src/lib/nextBestActions.ts). The user Profile section (display name →
// the {{user.name}} preparer token) was REMOVED 2026-07-21 by user request —
// the whole setter chain (ProfilePanel/useUserProfile/userProfile service)
// is deleted with it; {{user.name}} still resolves from auth user_metadata
// (src/server/userTokens.ts), already-set names persist unchanged.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { AccountDetailSummary } from "@/components/org/AccountDetailSummary";
import { FinishSetupBanner } from "@/components/org/FinishSetupBanner";
import { PartiesManager } from "@/components/org/PartiesManager";
import { MembersPanel } from "@/components/settings/MembersPanel";

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
      {/* E0.3: the org's people and their roles — People Enroll. */}
      <PartiesManager />
      {/* F6.1.4: member management (invite, role change) relocated from the
          retired Settings page. */}
      <MembersPanel />
      {/* 2026-07-20 re-scope: the Resolution identifiers table is GONE from
          Org Detail — a payer-issued enrollment ID is not an org-wide value.
          The issued VALUE is captured where it is issued (the provider's
          enrollment fact; the group's Payer Network entry) and the per-payer
          LABEL is a Minted-curated payer fact shown in Payer Setup. */}
    </div>
  );
}
