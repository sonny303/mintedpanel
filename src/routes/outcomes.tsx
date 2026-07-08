// Reserved org-scoped route (redesign E0.0, feature F0.0.1 / F0.0.6).
// "Outcomes" is the final Stage 1+ journey slot; content is not built yet, so it
// renders the shared "not yet available" empty state.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { NotYetAvailable } from "@/components/empty/NotYetAvailable";

export const Route = createFileRoute("/outcomes")({
  component: OutcomesPage,
});

function OutcomesPage() {
  return (
    <div>
      <PageHeader title="Outcomes" />
      <NotYetAvailable title="Outcomes" />
    </div>
  );
}
