// E2.3 TE-8 — the reserved E0.0 "Work" journey slot activated as the
// next-best-action queue, nav label "My Cases" ([r4-review] Q9). The
// post-generation landing (F2.3.2): E2.1's confirm navigates here with
// ?run=<uuid>; the filter is URL-state (validateSearch), shareable, and
// cleared by param removal — the /providers?chip= idiom.
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { NextBestActionQueue } from "@/components/work/NextBestActionQueue";

interface WorkSearch {
  run?: string;
}

export const Route = createFileRoute("/work")({
  component: WorkPage,
  validateSearch: (search: Record<string, unknown>): WorkSearch => ({
    run: typeof search.run === "string" && search.run ? search.run : undefined,
  }),
});

function WorkPage() {
  const { run } = Route.useSearch();
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="My Cases"
        description="Every open case, ordered by its earliest deadline — start at the top."
      />
      <NextBestActionQueue run={run} />
    </div>
  );
}
