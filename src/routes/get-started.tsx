// Reserved org-scoped route (redesign E0.0, feature F0.0.1 / F0.0.6). "Get
// started" is the first journey slot; its Stage 1+ content is not built yet, so
// it renders the shared "not yet available" empty state — no dead link, no
// blank page.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { NotYetAvailable } from "@/components/empty/NotYetAvailable";

export const Route = createFileRoute("/get-started")({
  component: GetStartedPage,
});

function GetStartedPage() {
  return (
    <div>
      <PageHeader title="Get started" />
      <NotYetAvailable title="Get started" />
    </div>
  );
}
