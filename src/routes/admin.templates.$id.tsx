// Template Editor — edit an existing template via the 3-step wizard,
// pre-filled from the loaded template. Save writes one update (match key) or
// one published version (content).
//
// Slice F: a readiness CTA can deep-link one of the five online-form modes
// (?intent=register|capture|train|repair|prove) — the wizard lands on
// Tasks & steps with the owning form panel expanded and a derived context
// banner. The wizard remounts when current_version changes (restore-as-new
// publishes a new version and the restored content must become the working
// copy).
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { TableSkeletonRows } from "@/components/TableSkeletonRows";
import { TemplateWizard } from "@/components/templates/TemplateWizard";
import { useSop } from "@/hooks/useAdmin";
import { parseTemplateEditorIntent, type TemplateEditorIntent } from "@/lib/templateEditorIntent";

interface EditTemplateSearch {
  intent?: TemplateEditorIntent;
}

export const Route = createFileRoute("/admin/templates/$id")({
  validateSearch: (search: Record<string, unknown>): EditTemplateSearch => ({
    intent: parseTemplateEditorIntent(search.intent) ?? undefined,
  }),
  component: EditTemplate,
});

function EditTemplate() {
  const { id } = Route.useParams();
  const { intent } = Route.useSearch();
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

  return (
    <TemplateWizard
      key={`${id}:${tplQ.data.currentVersion ?? 1}`}
      initial={tplQ.data}
      intent={intent ?? null}
    />
  );
}
