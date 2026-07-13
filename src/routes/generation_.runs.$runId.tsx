// E2.4 F2.4.1 — one run's detail: every candidate row's disposition and
// reason exactly as recorded at confirm time. Deep-linked from case detail
// (F2.4.2) and the run list.
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { RunDetailContent } from "@/components/generation/RunDetailContent";

export const Route = createFileRoute("/generation_/runs/$runId")({
  component: RunDetailPage,
});

function RunDetailPage() {
  const { runId } = Route.useParams();
  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Generation run"
        description="The immutable record of this batch — dispositions and reasons as decided at confirm time."
        actions={
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/generation/runs">Run history</Link>
          </Button>
        }
      />
      <RunDetailContent runId={runId} />
    </div>
  );
}
