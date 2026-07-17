// Admin > Templates list. The list body is the shared TemplatesList (E4.2
// unified payer setup, TE-19 — also composed by the Payer Setup workspace's
// "SOP templates" tab); row click / "+ New Template" open the wizard routes.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { TemplatesList } from "@/components/templates/TemplatesList";

export const Route = createFileRoute("/admin/templates/")({
  component: TemplatesIndex,
});

function TemplatesIndex() {
  return (
    <div className="p-6">
      <PageHeader
        title="Templates"
        description="Reusable SOP definitions. A case resolves the most specific match by payer + state + group — an organization SOP overrides a global payer SOP, and the generic fallback applies only when no payer SOP matches."
      />
      <TemplatesList />
    </div>
  );
}
