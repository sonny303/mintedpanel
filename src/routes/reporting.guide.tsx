// Reporting Guide — self-service help and the data dictionary for the
// Reporting Center. Static content from src/lib/reportingGuide.ts; the open
// article is the `topic` search param and a dictionary term is `term`, so
// both deep-link. Client-audience users see only what applies to them.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ReportingGuide } from "@/components/reporting/guide/ReportingGuide";
import { useAuthStore } from "@/lib/auth-store";
import { guideAudienceFor, resolveGuideTopic } from "@/lib/reportingGuide";

export const Route = createFileRoute("/reporting/guide")({
  validateSearch: (search: Record<string, unknown>): { topic?: string; term?: string } => ({
    topic: typeof search.topic === "string" ? search.topic : undefined,
    term: typeof search.term === "string" ? search.term : undefined,
  }),
  component: ReportingGuidePage,
});

function ReportingGuidePage() {
  const search = Route.useSearch();
  const audience = guideAudienceFor(useAuthStore((s) => s.accessContext?.audience));
  const topic = resolveGuideTopic(search.term ? "dictionary" : search.topic, audience);

  return (
    <div>
      <Link
        to="/reporting"
        className="mb-3 inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Reporting Center
      </Link>
      <PageHeader
        title="Guide & definitions"
        description={
          audience === "client"
            ? "How to read your enrollment report, and what the terms mean."
            : "How each report works, what it counts, and what every term means."
        }
      />
      <ReportingGuide topic={topic} term={search.term} audience={audience} />
    </div>
  );
}
