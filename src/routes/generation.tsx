// E2.0 — the case-generation preview surface ("Generate applications").
// Entered from the Scope Review readiness section (the same row universe per
// TE-4/Q1); URL-reachable like other pre-nav surfaces — Sidebar edits aren't
// §5-authorized for this epic. The page is readable by any member; exclusion
// and restore writes are admin-only and the controls mirror the RLS.
import { createFileRoute, Link } from "@tanstack/react-router";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { GenerationPreviewContent } from "@/components/generation/GenerationPreviewContent";

interface GenerationSearch {
  // E4.2 TE-6 — bulk generation entered from a payer's row pre-scopes the
  // preview to that payer (optionally a specific group). Absent = whole org.
  payerId?: string;
  groupId?: string;
}

export const Route = createFileRoute("/generation")({
  validateSearch: (search: Record<string, unknown>): GenerationSearch => ({
    payerId: typeof search.payerId === "string" ? search.payerId : undefined,
    groupId: typeof search.groupId === "string" ? search.groupId : undefined,
  }),
  component: GenerationPage,
});

function GenerationPage() {
  const { payerId, groupId } = Route.useSearch();
  const scoped = Boolean(payerId);
  return (
    <div>
      <PageHeader
        title="Generate applications"
        description={
          scoped
            ? "Scoped to the selected payer — every eligible provider × group × state combination for it, reviewed before anything is created."
            : "Every provider × group × payer × state combination the system can derive from your roster, clinic assignments, and payer targets — reviewed here before anything is created."
        }
        actions={
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/generation/runs">
              <History className="mr-1 h-4 w-4" /> Run history
            </Link>
          </Button>
        }
      />
      <GenerationPreviewContent scope={payerId ? { payerId, groupId } : undefined} />
    </div>
  );
}
