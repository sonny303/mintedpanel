// Admin → Import: the E3.0 internal power-user roster import (F3.0.1). This
// SUPERSEDES the legacy Epic 2c three-file direct-commit importer that lived
// at this URL (TE-8): uploads now stage into import_runs/import_rows for
// E3.1's preview/commit — there is NO direct live-table write path here
// anymore (src/services/importCommit.ts was retired with it). The URL is kept
// (legacy-routes TS-23: old links render, never dead-end). Admin-gated by a
// render-time useIsAdmin() backstop, mirroring the RLS admin-only writes.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ImportRunList } from "@/components/import/ImportRunList";
import { RosterUploader } from "@/components/import/RosterUploader";
import { useIsAdmin } from "@/lib/permissions";

export const Route = createFileRoute("/admin/import")({
  component: RosterImportPage,
});

function RosterImportPage() {
  const isAdmin = useIsAdmin();

  if (!isAdmin) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Roster Import" />
        <div className="rounded-md border border-[#E8E5E0] bg-white p-6">
          <EmptyState
            message="Roster import is available to admins."
            description="Ask an admin if you need to onboard roster data."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Roster Import"
        description="Upload a roster CSV, validate it against the template, and stage it for review — nothing writes to live records until the staged run is committed."
      />

      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold text-foreground">Upload</h2>
        <RosterUploader source="internal" variant="internal" />
      </section>

      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold text-foreground">Run history</h2>
        <ImportRunList />
      </section>
    </div>
  );
}
