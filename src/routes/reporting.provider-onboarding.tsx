// Provider Onboarding funnel (Oct 20 review, RC-06). Org-scoped; the content
// gates itself on an active org.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProviderOnboardingReport } from "@/components/reporting/ProviderOnboardingReport";

export const Route = createFileRoute("/reporting/provider-onboarding")({
  component: ProviderOnboardingPage,
});

function ProviderOnboardingPage() {
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
        title="Provider Onboarding"
        description="Where every provider stands before credentialing can start, and what each one still needs."
      />
      <ProviderOnboardingReport />
    </div>
  );
}
