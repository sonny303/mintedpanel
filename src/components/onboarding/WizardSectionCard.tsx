// Active scope-section shell (E1.0 F1.0.1 / TE-1, TE-4, TE-5, TE-7). One
// shadowless white card per section with the design-token border and 6px
// panel radius (the Card default), a stable DOM id the next-action CTA
// targets, and a focusable heading. Handles the three read states uniformly:
// section-shaped skeleton while loading, an inline retriable error that is
// NEVER rendered as "Not started", and the section content once resolved.
// E1.1–E1.3 mount their forms as this card's children via the wizard route's
// section-content registry — the shell itself never changes.
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionStatusPill } from "@/components/onboarding/SectionStatusPill";
import { sectionHeadingId, type OnboardingSectionDef } from "@/lib/onboardingProgress";
import type { OnboardingSectionState } from "@/hooks/useOnboardingWizard";

interface WizardSectionCardProps {
  def: OnboardingSectionDef;
  state: OnboardingSectionState;
  children: ReactNode;
}

export function WizardSectionCard({ def, state, children }: WizardSectionCardProps) {
  return (
    <Card id={def.domId} aria-labelledby={sectionHeadingId(def)} role="region">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2
            id={sectionHeadingId(def)}
            tabIndex={-1}
            className="text-[15px] font-semibold text-foreground outline-none"
          >
            {def.title}
          </h2>
          {state.status ? <SectionStatusPill status={state.status} /> : null}
        </div>
        {state.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16 rounded-md" />
          </div>
        ) : state.isError ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3">
            <span className="text-[13px] text-[#B91C1C]">
              We couldn't load this section. Progress is unknown until it loads.
            </span>
            <Button variant="outline" size="sm" onClick={() => state.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
