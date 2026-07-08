// Reserved org-scoped route (redesign E0.0, feature F0.0.1 / F0.0.6). "Work" is
// a Stage 1+ journey slot; content is not built yet, so it renders the shared
// "not yet available" empty state.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { NotYetAvailable } from "@/components/empty/NotYetAvailable";

export const Route = createFileRoute("/work")({
  component: WorkPage,
});

function WorkPage() {
  return (
    <div>
      <PageHeader title="Work" />
      <NotYetAvailable title="Work" />
    </div>
  );
}
