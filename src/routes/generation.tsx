// E6.3 — /generation is ALIVE again as the decoupled generation grid: the one
// door cases come through, launched from the group's Payer Network board (or
// a payer row, a provider record, or a facility row — same screen,
// pre-filtered via search params). The E6.1 interim redirect to /groups is
// superseded; the legacy E4.2 `payerId`/`groupId` param spellings stay
// accepted so old links keep their scope.
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { GenerationGrid } from "@/components/generation/GenerationGrid";
import type { GridPivot } from "@/lib/generationGrid";

interface GenerationSearch {
  group?: string;
  payer?: string;
  provider?: string;
  facility?: string;
  pivot?: GridPivot;
  // Legacy spellings (E4.2 links: /generation?payerId=&groupId=).
  payerId?: string;
  groupId?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/generation")({
  validateSearch: (search: Record<string, unknown>): GenerationSearch => ({
    group: str(search.group),
    payer: str(search.payer),
    provider: str(search.provider),
    facility: str(search.facility),
    pivot: search.pivot === "payer" || search.pivot === "provider" ? search.pivot : undefined,
    payerId: str(search.payerId),
    groupId: str(search.groupId),
  }),
  component: GenerationPage,
});

function GenerationPage() {
  const search = Route.useSearch();
  const scope = {
    groupId: search.group ?? search.groupId,
    payerId: search.payer ?? search.payerId,
    providerId: search.provider,
    facilityId: search.facility,
  };
  // A payer-scoped entry (the board's payer row) reads best grouped by payer.
  const defaultPivot: GridPivot = search.pivot ?? (scope.payerId ? "payer" : "provider");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generate cases"
        description="Every provider × payer target lands in exactly one bucket — select what this batch creates; skipping keeps a candidate in the buffer. A human always confirms."
        actions={
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/generation/runs">Run history</Link>
          </Button>
        }
      />
      <GenerationGrid scope={scope} defaultPivot={defaultPivot} />
    </div>
  );
}
