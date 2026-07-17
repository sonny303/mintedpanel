// Admin > Templates — create a new template via the 4-step wizard. Nothing is
// written until the wizard's final Save (one insert). Admin-only edit is
// enforced inside the wizard (render-time useIsAdmin backstop).
//
// E4.2: the match key can be prefilled from a "Needs SOP" directory link
// (?payerId/state/groupId, TE-4), and an existing draft can be resumed
// (?draftId, F4.2.1).
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { TemplateWizard } from "@/components/templates/TemplateWizard";
import { useSopTemplateDraft } from "@/hooks/useSopTemplateDrafts";

interface NewTemplateSearch {
  payerId?: string;
  state?: string;
  groupId?: string;
  draftId?: string;
}

export const Route = createFileRoute("/admin/templates/new")({
  validateSearch: (search: Record<string, unknown>): NewTemplateSearch => ({
    payerId: typeof search.payerId === "string" ? search.payerId : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    groupId: typeof search.groupId === "string" ? search.groupId : undefined,
    draftId: typeof search.draftId === "string" ? search.draftId : undefined,
  }),
  component: NewTemplate,
});

function NewTemplate() {
  const { payerId, state, groupId, draftId } = Route.useSearch();
  const draftQ = useSopTemplateDraft(draftId);

  if (draftId && draftQ.isLoading) {
    return <Skeleton className="m-6 h-64 w-full max-w-3xl" />;
  }

  return (
    <TemplateWizard
      initial={null}
      prefill={payerId || state || groupId ? { payerId, state, groupId } : undefined}
      draft={draftId ? (draftQ.data ?? null) : null}
    />
  );
}
