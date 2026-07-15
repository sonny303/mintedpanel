// E4.2 F4.2.1 — the module home: one owned configuration space consolidating the
// payer directory (with readiness/form/blocked + scorecard link + bulk generate
// entry), the reason-code vocabulary (F4.2.3), and the org queue settings
// (F4.2.5). Admin/config-role gated; non-admins are denied at the route.
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { PayerDirectory } from "@/components/payer-admin/PayerDirectory";
import { ReasonCodeManager } from "@/components/payer-admin/ReasonCodeManager";
import { QueueSettingsPanel } from "@/components/payer-admin/QueueSettingsPanel";
import { useIsAdmin } from "@/lib/permissions";

export const Route = createFileRoute("/admin/payer-admin/")({
  component: PayerAdminPage,
});

function PayerAdminPage() {
  const isAdmin = useIsAdmin();

  if (!isAdmin) {
    return (
      <div>
        <PageHeader
          title="Payer & SOP Setup"
          description="Upstream configuration for payers and SOPs."
        />
        <EmptyState message="This admin module is available to administrators only." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Payer & SOP Setup"
        description="Configure payers and SOPs upstream, so generated cases arrive with complete task checklists."
        actions={
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/admin/templates">
              <FileText className="mr-1 h-4 w-4" /> SOP templates
            </Link>
          </Button>
        }
      />
      <Tabs defaultValue="directory" className="mt-2">
        <TabsList>
          <TabsTrigger value="directory">Payer directory</TabsTrigger>
          <TabsTrigger value="reason-codes">Reason codes</TabsTrigger>
          <TabsTrigger value="queue">Queue settings</TabsTrigger>
        </TabsList>
        <TabsContent value="directory" className="pt-4">
          <PayerDirectory />
        </TabsContent>
        <TabsContent value="reason-codes" className="pt-4">
          <ReasonCodeManager />
        </TabsContent>
        <TabsContent value="queue" className="pt-4">
          <QueueSettingsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
