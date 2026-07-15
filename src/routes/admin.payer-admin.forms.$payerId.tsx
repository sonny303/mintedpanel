// E4.2 F4.2.7 — form onboarding & test runner for a payer, reached from the
// payer directory's form-readiness link. Admin-gated at render time.
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { FormOnboardingPanel } from "@/components/payer-admin/FormOnboardingPanel";
import { useIsAdmin } from "@/lib/permissions";

export const Route = createFileRoute("/admin/payer-admin/forms/$payerId")({
  component: FormOnboardingPage,
});

function FormOnboardingPage() {
  const { payerId } = Route.useParams();
  const isAdmin = useIsAdmin();

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title="Form onboarding" description="Test-run a payer's form fill." />
        <EmptyState message="This admin module is available to administrators only." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Form onboarding & test runner"
        description="Capture → train → dry-run fill against the test provider → fix & re-run."
        actions={
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link to="/admin/payer-admin">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back to Payer & SOP Setup
            </Link>
          </Button>
        }
      />
      <FormOnboardingPanel payerId={payerId} />
    </div>
  );
}
