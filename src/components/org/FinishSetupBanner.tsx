// E6.1 F6.1.4/F6.1.5 — the "Finish setup" banner on Org Detail: renders while
// the one-time onboarding wizard is incomplete and never again after (status
// is DERIVED live from the same section resolvers the wizard renders — the
// E1.0 derived-progress rule, no stored flags). Composed from existing
// primitives (card + button), superseding the E0.4 OnboardingBanner's
// disabled CTA with the real wizard entry.
import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { useOnboardingWizard } from "@/hooks/useOnboardingWizard";
import { useActiveMembership } from "@/lib/auth-store";

export function FinishSetupBanner() {
  const active = useActiveMembership();
  const { nextSection } = useOnboardingWizard();

  // undefined = reads still resolving (no flash); null = every section
  // complete → the banner is gone for good (F6.1.5 AC).
  if (!nextSection) return null;

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
