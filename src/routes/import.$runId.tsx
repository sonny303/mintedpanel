// E3.1 — the staged-import preview + commit page for one run. Reached from
// the internal tool (/admin/import run panel) and the wizard's streamlined
// uploader; admin-gated by a render-time useIsAdmin() backstop mirroring the
// import_runs admin-only RLS writes (the beforeLoad store is empty on a hard
// load — the known-wart pattern).
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { ImportPreviewContent } from "@/components/import/ImportPreviewContent";
import { useIsAdmin } from "@/lib/permissions";

export const Route = createFileRoute("/import/$runId")({
  component: ImportPreviewPage,
});

function ImportPreviewPage() {
  const { runId } = Route.useParams();
  const isAdmin = useIsAdmin();

  if (!isAdmin) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Import preview" />
        <div className="rounded-md border border-[#E8E5E0] bg-white p-6">
          <EmptyState
            message="Reviewing an import run is available to admins."
            description="Ask an admin to review and commit this roster import."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Review import"
        description="Confirm what will be created and updated before anything is written to live records. Committing is final."
        actions={
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/admin/import">Back to import</Link>
          </Button>
        }
      />
      <ImportPreviewContent runId={runId} />
    </div>
  );
}
