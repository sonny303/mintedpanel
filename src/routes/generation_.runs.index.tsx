// E2.4 F2.4.1 — the generation run history list, RESTORED by E6.3 (reachable
// from the grid + the group board; no nav item, per [r4-review] Q10).
import { Link, createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { RunHistoryContent } from "@/components/generation/RunHistoryContent";

export const Route = createFileRoute("/generation_/runs/")({
  component: RunHistoryPage,
});

function RunHistoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Generation run history"
        description="Every confirmed run with its immutable per-candidate disposition ledger."
        actions={
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/generation">Back to Generate cases</Link>
          </Button>
        }
      />
      <RunHistoryContent />
    </div>
  );
}
