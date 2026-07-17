// Admin → Import: the internal power-user roster import (F3.0.1 / E3.3 F3.3.3).
// The E3.0 20-column combined uploader is RETIRED (TE-7): this surface now
// offers the SAME three per-section uploads as the wizard — Provider Group,
// Facilities, Providers — each staging into import_runs/import_rows for the
// preview/commit flow (no direct live-table write path; importCommit.ts was
// retired in E3.0). The URL is kept (legacy-routes TS-23: old links render).
// Admin-gated by a render-time useIsAdmin() backstop mirroring the RLS
// admin-only writes.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ImportRunList } from "@/components/import/ImportRunList";
import { RosterUploader } from "@/components/import/RosterUploader";
import { useIsAdmin } from "@/lib/permissions";
import type { SectionEntityKind } from "@/lib/importSections";

export const Route = createFileRoute("/admin/import")({
  component: RosterImportPage,
});

const SECTIONS: Array<{ kind: SectionEntityKind; title: string; note: string }> = [
  {
    kind: "provider_group",
    title: "Provider groups",
    note: "Business entities — TIN, Type 2 NPI, operating states, and the billing/correspondence/credentialing address blocks.",
  },
  {
    kind: "facility",
    title: "Facilities",
    note: "Practice locations attached to an existing provider group (add the groups first).",
  },
  {
    kind: "provider",
    title: "Providers",
    note: "The CAQH roster attached to an existing provider group; one row per license.",
  },
];

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
        description="Upload each section's CSV against its template and stage it for review — nothing writes to live records until the staged run is committed. Uploads follow the org → group → facilities → providers ladder."
      />

      {SECTIONS.map((section) => (
        <section key={section.kind} className="space-y-3">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">{section.title}</h2>
            <p className="text-[12px] text-muted-foreground">{section.note}</p>
          </div>
          <RosterUploader source="internal" variant="internal" entityKind={section.kind} />
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="text-[14px] font-semibold text-foreground">Run history</h2>
        <ImportRunList />
      </section>
    </div>
  );
}
