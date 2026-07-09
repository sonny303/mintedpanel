// Shared reserved-slot route (redesign E0.6, TE-2). Every reserved nav item
// (Payer Setup, SOP, Cases, Tasks, Facilities, Providers) routes here with its
// title, rendering the consistent "not yet available" empty state (E0.0
// reserved-slot rule) — one route instead of a file per placeholder.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { NotYetAvailable } from "@/components/empty/NotYetAvailable";

export const Route = createFileRoute("/soon")({
  validateSearch: (search: Record<string, unknown>): { title: string } => ({
    title: typeof search.title === "string" && search.title ? search.title : "This section",
  }),
  component: SoonPage,
});

function SoonPage() {
  const { title } = Route.useSearch();
  return (
    <div>
      <PageHeader title={title} />
      <NotYetAvailable title={title} />
    </div>
  );
}
