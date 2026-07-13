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

export const Route = createFileRoute("/generation")({
  component: GenerationPage,
});

function GenerationPage() {
  return (
    <div>
      <PageHeader
        title="Generate applications"
        description="Every provider × group × payer × state combination the system can derive from your roster, clinic assignments, and payer targets — reviewed here before anything is created."
        actions={
          // E2.4 F2.4.1 — run history lives off the generation surface
          // ([r4-review] Q10: no new nav item).
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/generation/runs">
              <History className="mr-1 h-4 w-4" /> Run history
            </Link>
          </Button>
        }
      />
      <GenerationPreviewContent />
    </div>
  );
}
