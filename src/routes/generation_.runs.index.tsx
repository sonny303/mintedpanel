// E2.4 F2.4.1 — the generation-runs list (who, when, disposition counts).
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { RunHistoryContent } from "@/components/generation/RunHistoryContent";

export const Route = createFileRoute("/generation_/runs/")({
  component: RunHistoryPage,
});

function RunHistoryPage() {
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Generation run history"
        description="Every confirmed batch, immutable: what was proposed, created, skipped, or excluded — and why."
        actions={
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/generation">Back to generation</Link>
          </Button>
        }
      />
      <RunHistoryContent />
    </div>
  );
}
