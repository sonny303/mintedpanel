// Onboarding next-action banner (redesign E0.4, feature F0.4.3 / enabler TE-4).
//
// Shown at the top of the org workspace home (/get-started) so a just-created or
// still-empty org always lands with a clear next step instead of a blank state.
// The guided onboarding flow is a Stage 1 surface, so the CTA uses the
// "not yet available" disabled affordance the epic explicitly allows ("even if
// not clickable"). Composed only from existing primitives (card + button) — no
// new primitive, no layout import (E0.4 is not a shell epic).
import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActiveMembership } from "@/lib/auth-store";

export function OnboardingBanner() {
  const active = useActiveMembership();
  const orgName = active?.orgName ?? "this organization";

  return (
    <Card className="border-[#E8E5E0]">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#1B4D3E]/10 text-[#1B4D3E]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[15px] font-semibold text-foreground">
              Welcome — let’s get {orgName} onboarded
            </div>
            <p className="mt-1 max-w-md text-[13px] text-muted-foreground">
              Guided onboarding to add facilities, providers, and payers is coming in the next
              release. You can start capturing the org’s people and roles below now.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          {/* Stage 1 target — disabled next-action, honest that it isn't live yet. */}
          <Button disabled className="bg-[#1B4D3E] text-white hover:bg-[#163F33]">
            Begin onboarding
          </Button>
          <span className="text-[11px] text-muted-foreground">Available in a later release</span>
        </div>
      </CardContent>
    </Card>
  );
}
