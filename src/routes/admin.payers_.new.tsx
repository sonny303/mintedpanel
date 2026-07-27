// Payer & Cases design bundle — the "+ Set up payer" destination (screen 2,
// Slice B). Slice A ships the ENTRY points (the Payer Setup toolbar button and
// the zero-payers "Add your first payer" CTA); this route is their interim
// landing until Slice B builds the two-step create form (name + near-match →
// details) on the E6.7 create_payer seam. Un-nested with the `payers_` idiom
// (the admin.payers_.$id.scorecard precedent) so the /admin/payers redirect
// shell never hijacks it.
import { createFileRoute, Link } from "@tanstack/react-router";
import { Landmark } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonVariants } from "@/components/ui/button";

export const Route = createFileRoute("/admin/payers_/new")({
  component: SetUpPayerPage,
});

function SetUpPayerPage() {
  return (
    <div>
      <PageHeader
        title="Set up payer"
        description="Create a payer deliberately — name it, then capture its states, kind, and the IDs it issues."
      />
      <div className="rounded-[6px] border border-[#E8E5E0] bg-white px-6 py-12">
        <EmptyState
          icon={<Landmark className="h-5 w-5 text-muted-foreground" />}
          message="The guided payer form arrives in the next update."
          description="It starts with a duplicate check against your existing payers, then captures states, kind, aliases, and ID expectations."
          action={
            <Link
              to="/admin/payer-admin/catalog"
              className={buttonVariants({ variant: "outline" })}
            >
              Back to Payer Setup
            </Link>
          }
        />
      </div>
    </div>
  );
}
