// Template Editor — create a new template via the 3-step wizard. Nothing is
// written until the wizard's final Create (one insert). Every create authors a
// GLOBAL row (payer-and-cases §2.4 — the editor never creates org-tier rows),
// so the legacy ?tier=global spelling is accepted for old links but no longer
// changes anything.
//
// E4.2: the match key can be prefilled from a "Needs template" link
// (?payerId/state/groupId, TE-4 — the payer half becomes the FIXED payer
// context), and an existing draft can be resumed (?draftId, F4.2.1).
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { TemplateWizard } from "@/components/templates/TemplateWizard";
import { useSopTemplateDraft } from "@/hooks/useSopTemplateDrafts";

interface NewTemplateSearch {
  payerId?: string;
  state?: string;
  groupId?: string;
  draftId?: string;
  /** Legacy spelling (E6.5 funnel links) — creates are always global now. */
  tier?: "global";
}

export const Route = createFileRoute("/admin/templates/new")({
  validateSearch: (search: Record<string, unknown>): NewTemplateSearch => ({
    payerId: typeof search.payerId === "string" ? search.payerId : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    groupId: typeof search.groupId === "string" ? search.groupId : undefined,
    draftId: typeof search.draftId === "string" ? search.draftId : undefined,
    tier: search.tier === "global" ? "global" : undefined,
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
