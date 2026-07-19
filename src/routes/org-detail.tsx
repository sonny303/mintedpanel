// E6.1 F6.1.4 — Org Detail (renamed from Account Detail), slimmed to the
// container page: org summary + authorized/organization contacts, People
// Enroll (party/role management), member management (relocated from the
// retired /admin/settings page), capture-link re-issue, and the Finish-setup
// banner while the one-time wizard is incomplete. Inbound-leads triage moved
// to the Reporting Center's Intake report (E6.6 F6.6.1), and the reason-code
// + queue-ranking editors are GONE — both vocabularies ship as fixed defaults
// (E6.6 F6.6.6; documented in src/services/cases.ts `listDenialReasonCodes`
// and src/lib/nextBestActions.ts). The user's own profile section (display
// name → the {{user.name}} preparer token) rides along from the retired
// Settings page — it has no other home until a dedicated user-scoped surface
// exists (flagged in the E6.1 PR).
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Separator } from "@/components/ui/separator";
import { AccountDetailSummary } from "@/components/org/AccountDetailSummary";
import { FinishSetupBanner } from "@/components/org/FinishSetupBanner";
import { CaptureLinkPanel } from "@/components/org/CaptureLinkPanel";
import { PartiesManager } from "@/components/org/PartiesManager";
import { MembersPanel } from "@/components/settings/MembersPanel";
import { ProfilePanel } from "@/components/settings/ProfilePanel";
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
      {/* E0.3: the org's people and their roles — People Enroll. */}
      <PartiesManager />
      {/* F6.1.4: member management (invite, role change) relocated from the
          retired Settings page. */}
      <MembersPanel />
      {/* E0.5 capture-link re-issue (BD-1/BD-2 — copy-able link + email). */}
      <CaptureLinkPanel />
      {/* E6.5/E6.6: of the payer-relevant org settings that moved here from
          the Payer Setup module, only resolution identifiers remain — the
          denial word-list and queue ranking are fixed defaults with no
          editors anywhere (F6.6.6). */}
      <Separator />
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
