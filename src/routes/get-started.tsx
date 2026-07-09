// Org workspace landing (redesign E0.0 F0.0.1 + E0.1 F0.1.5 / TE-4). This is
// where org creation lands (useCreateOrganization → /get-started). Rather than
// the generic "not yet available" reserved-route state, it shows a guided
// next-action that points straight at the first scope step — and deliberately
// offers NO return-to-Portfolio prompt here (F0.1.5); the sidebar keeps the
// one-step Portfolio return in the frame. Composed from existing primitives.
import { createFileRoute, Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { OrgContactsSection } from "@/components/org/OrgContactsSection";

export const Route = createFileRoute("/get-started")({
  component: GetStartedPage,
});

function GetStartedPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Get started" />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[15px] font-semibold text-foreground">
              Your organization is ready
            </div>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">
              Begin scoping this organization by adding its facilities and providers.
            </p>
          </div>
          <Link to="/scope" className={buttonVariants()}>
            Add facilities or providers
          </Link>
        </CardContent>
      </Card>
      {/* E0.2: the org's contacts (customer + sales rep) are always visible and
          editable here — the org overview until Stage 1 defines a richer one. */}
      <OrgContactsSection />
    </div>
  );
}
