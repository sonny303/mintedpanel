// E3.1 — the staged-import preview + commit page for one run. Reached from
// the internal tool (/admin/import run panel) and the wizard's streamlined
// uploader; admin-gated by a render-time useIsAdmin() backstop mirroring the
// import_runs admin-only RLS writes (the beforeLoad store is empty on a hard
// load — the known-wart pattern).
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportPreviewContent } from "@/components/import/ImportPreviewContent";
import { PayerAttachImportPreview } from "@/components/import/PayerAttachImportPreview";
import { SectionImportPreview } from "@/components/import/SectionImportPreview";
import { useImportRun } from "@/hooks/useImportRuns";
import { useIsAdmin } from "@/lib/permissions";

export const Route = createFileRoute("/import/$runId")({
  component: ImportPreviewPage,
});

// The preview surface is chosen by the run's entity_kind (E3.3 TE-8): the
// provider (and legacy 'combined') grain runs the rich dedupe/conflict engine;
// the simpler provider_group / facility grains run the section preview.
function PreviewForRun({ runId }: { runId: string }) {
  const runQ = useImportRun(runId);
  if (runQ.isLoading) return <Skeleton className="h-40 w-full" />;
  const kind = runQ.data?.entityKind;
  if (kind === "provider_group" || kind === "facility") {
    return <SectionImportPreview runId={runId} entityKind={kind} />;
  }
  // E6.2 — the group×payer attach CSV rides the same machine with its own
  // simpler create/restore/skip preview.
  if (kind === "payer_attach") {
    return <PayerAttachImportPreview runId={runId} />;
  }
  return <ImportPreviewContent runId={runId} />;
}

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
      <PreviewForRun runId={runId} />
    </div>
  );
}
