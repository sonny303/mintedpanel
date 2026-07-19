// E4.2 F4.2.1 + the unified-payer-setup consolidation (§5 amendment TE-19) —
// "Payer Setup" is THE administrative home for payers: one workspace answering
// which payers are selected, which group/state targets exist, which targets
// have payer SOP coverage, which providers are blocked, which forms are
// untrained, the single next action per payer, and whether generation preview
// is safe to open. Six areas composed over the EXISTING feature components —
// Setup (the per-payer funnel), Catalog (the shared PayerCatalogBrowser —
// since E6.1 the retired /payer-directory redirects here too), SOP templates
// (the shared TemplatesList; wizard routes unchanged), Forms & portals (the
// shared PortalsRegistry; the retired /admin/portals redirects here with its
// ?payerId= context), Needs attention (the Fix-it deck, E6.1 interim home
// until E6.5's drift-repair-in-the-editor), and Organization settings
// (payer-relevant org settings ONLY: reason codes, queue settings,
// org_payer_settings resolution IDs). The tab rides the URL (?tab=) so legacy
// redirects and deep links land on a specific area.
//
// E6.1 F6.1.1: Payer Setup renders for ALL roles for now (two trusted users;
// revisit at the third hire) — the former admin-only route denial is gone.
// Write affordances keep their own role gates (useIsAdmin/useCanWrite inside
// the composed components) and RLS backstops every write.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayerSetupList } from "@/components/payer-admin/PayerSetupList";
import { ReasonCodeManager } from "@/components/payer-admin/ReasonCodeManager";
import { QueueSettingsPanel } from "@/components/payer-admin/QueueSettingsPanel";
import { ResolutionIdSettingsSection } from "@/components/payer-admin/ResolutionIdSettingsSection";
import { PayerCatalogBrowser } from "@/components/payers/PayerCatalogBrowser";
import { PortalsRegistry } from "@/components/portals/PortalsRegistry";
import { TemplatesList } from "@/components/templates/TemplatesList";
import { FixitDeck } from "@/components/fixit/FixitDeck";

const WORKSPACE_TABS = [
  "setup",
  "catalog",
  "templates",
  "forms",
  "needs-attention",
  "org-settings",
] as const;
type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

interface PayerAdminSearch {
  tab?: WorkspaceTab;
  /** Payer-context deep link for the Forms & portals tab (the retired
   * /admin/portals ?payerId= contract — opens Add portal preselected). */
  payerId?: string;
}

export const Route = createFileRoute("/admin/payer-admin/")({
  validateSearch: (search: Record<string, unknown>): PayerAdminSearch => ({
    tab: WORKSPACE_TABS.includes(search.tab as WorkspaceTab)
      ? (search.tab as WorkspaceTab)
      : undefined,
    payerId: typeof search.payerId === "string" ? search.payerId : undefined,
  }),
  component: PayerAdminPage,
});

function PayerAdminPage() {
  const navigate = useNavigate({ from: "/admin/payer-admin" });
  const { tab, payerId } = Route.useSearch();
  const activeTab: WorkspaceTab = tab ?? "setup";

  return (
    <div>
      <PageHeader
        title="Payer Setup"
        description="One home for payer configuration — select payers, set credentialing scope, cover them with SOPs, ready their forms, and open generation with confidence."
      />
      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          navigate({
            search: { tab: v === "setup" ? undefined : (v as WorkspaceTab) },
            replace: true,
          })
        }
        className="mt-2"
      >
        <TabsList>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="templates">SOP templates</TabsTrigger>
          <TabsTrigger value="forms">Forms &amp; portals</TabsTrigger>
          <TabsTrigger value="needs-attention">Needs attention</TabsTrigger>
          <TabsTrigger value="org-settings">Organization settings</TabsTrigger>
        </TabsList>
        <TabsContent value="setup" className="pt-4">
          <PayerSetupList />
        </TabsContent>
        <TabsContent value="catalog" className="pt-4">
          <PayerCatalogBrowser />
        </TabsContent>
        <TabsContent value="templates" className="pt-4">
          <TemplatesList />
        </TabsContent>
        <TabsContent value="forms" className="pt-4">
          <PortalsRegistry initialAddPayerId={payerId ?? null} />
        </TabsContent>
        <TabsContent value="needs-attention" className="pt-4">
          {/* E6.1 F6.1.6 — the Fix-it deck's interim home (/fix-it redirects
              here); E6.5 supersedes it with drift repair inside the editor. */}
          <FixitDeck />
        </TabsContent>
        <TabsContent value="org-settings" className="pt-4">
          {/* Payer-relevant organization settings only (PM decision) — each
              section is visually separated from the per-payer setup checklist. */}
          <div className="max-w-[880px] space-y-6">
            <section aria-labelledby="reason-codes-heading" className="space-y-3">
              <div>
                <h2 id="reason-codes-heading" className="text-[15px] font-semibold">
                  Reason codes
                </h2>
                <p className="text-[12.5px] text-muted-foreground">
                  The denial/return vocabulary used by the payer pipeline. Defaults are managed
                  centrally; organization codes deactivate, never delete.
                </p>
              </div>
              <ReasonCodeManager />
            </section>
            <Separator />
            <section aria-labelledby="queue-settings-heading" className="space-y-3">
              <div>
                <h2 id="queue-settings-heading" className="text-[15px] font-semibold">
                  Queue settings
                </h2>
                <p className="text-[12.5px] text-muted-foreground">
                  How this organization ranks the My Cases queue. The queue stays fully derived —
                  this config is an input, never a stored priority.
                </p>
              </div>
              <QueueSettingsPanel />
            </section>
            <Separator />
            <section aria-labelledby="resolution-ids-heading" className="space-y-3">
              <div>
                <h2 id="resolution-ids-heading" className="text-[15px] font-semibold">
                  Resolution identifiers
                </h2>
                <p className="text-[12.5px] text-muted-foreground">
                  What each payer calls its payer-issued enrollment ID at approval. Configured per
                  organization; unconfigured payers fall back to the Minted default, then the
                  generic “Payer-issued ID”.
                </p>
              </div>
              <ResolutionIdSettingsSection />
            </section>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
