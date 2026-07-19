// E2.4 F2.4.1 — one run's detail (every candidate's disposition + confirm-time
// reason), RESTORED by E6.3.
import { Link, createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { RunDetailContent } from "@/components/generation/RunDetailContent";

export const Route = createFileRoute("/generation_/runs/$runId")({
  component: RunDetailPage,
});

function RunDetailPage() {
  const { runId } = Route.useParams();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Generation run"
        description="The immutable per-candidate record of one confirm."
        actions={
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/generation/runs">All runs</Link>
          </Button>
        }
      />
      <RunDetailContent runId={runId} />
    </div>
  );
}
