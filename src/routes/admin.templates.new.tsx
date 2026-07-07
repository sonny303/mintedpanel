// Admin > Templates — create a new template via the 4-step wizard. Nothing is
// written until the wizard's final Save (one insert). Admin-only edit is
// enforced inside the wizard (render-time useIsAdmin backstop).
import { createFileRoute } from "@tanstack/react-router";
import { TemplateWizard } from "@/components/templates/TemplateWizard";

export const Route = createFileRoute("/admin/templates/new")({
  component: NewTemplate,
});

function NewTemplate() {
  return <TemplateWizard initial={null} />;
}
