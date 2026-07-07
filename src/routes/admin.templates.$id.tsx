// Admin > Templates — edit an existing template via the 4-step wizard,
// pre-filled from the loaded template. Save writes one update.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { TemplateWizard } from "@/components/templates/TemplateWizard";
import { useSop } from "@/hooks/useAdmin";

export const Route = createFileRoute("/admin/templates/$id")({
  component: EditTemplate,
});

function EditTemplate() {
  const { id } = Route.useParams();
  const tplQ = useSop(id);

  if (tplQ.isLoading) {
    return (
      <div className="p-6">
        <PageHeader title="Template" />
        <div className="border border-[#E8E5E0] rounded-md">
          <table className="w-full">
            <tbody>
              <TableSkeletonRows rows={8} cols={1} />
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (!tplQ.data) {
    return (
      <div className="p-6">
        <PageHeader title="Template not found" />
      </div>
    );
  }

  return <TemplateWizard initial={tplQ.data} />;
}
