// E6.1 F6.1.4 — the "Finish setup" banner on Org Detail: renders while the
// onboarding wizard is incomplete (status is DERIVED live from the same
// section resolvers the wizard renders — the E1.0 derived-progress rule, no
// stored flags). Once every section is complete the big banner yields to a
// compact persistent "Setup wizard" entry (PM decision 2026-07-21 — the
// wizard must stay reachable from Org Detail; supersedes F6.1.5's
// never-again rule). Composed from existing primitives (card + button).
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { useOnboardingWizard } from "@/hooks/useOnboardingWizard";
import { useActiveMembership } from "@/lib/auth-store";

export function FinishSetupBanner() {
  const active = useActiveMembership();
  const { nextSection } = useOnboardingWizard();

  // undefined = reads still resolving (no flash).
  if (nextSection === undefined) return null;

  // Every section complete: the loud banner yields to a quiet persistent
  // entry so the wizard's review surfaces stay one click away.
  if (nextSection === null) {
    return (
      <div className="flex items-center justify-between rounded-md border border-[#E8E5E0] px-4 py-2.5">
        <p className="text-[12.5px] text-muted-foreground">
          Setup is complete. You can revisit any setup section at any time.
        </p>
        <Link
          to="/onboarding/wizard"
          className={`${buttonVariants({ variant: "outline", size: "sm" })} shrink-0`}
        >
          Open setup wizard
        </Link>
      </div>
    );
  }

  return (
    <Card className="border-[#E8E5E0]">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#1B4D3E]/10 text-[#1B4D3E]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-foreground">
              Finish setting up {active?.orgName ?? "this organization"}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Next up: {nextSection.title}. The setup wizard walks the remaining sections in order.
            </p>
          </div>
        </div>
        <Link
          to="/onboarding/wizard"
          className={`${buttonVariants({ size: "sm" })} shrink-0 bg-[#1B4D3E] text-white hover:bg-[#163F33]`}
        >
          Finish setup
        </Link>
      </CardContent>
    </Card>
  );
}
