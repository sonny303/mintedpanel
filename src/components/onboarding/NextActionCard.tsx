// The single persistent next-action affordance (E1.0 F1.0.3 / TE-4). Derived
// from the same ordered registry that renders the page — this IS the resume
// mechanism (no per-user "last section" storage, so it survives the E0.0
// org-switch state reset by design). No next action is computed while any
// required read is unresolved; with all four R1 sections complete it hands
// off to the authored Assignments preview instead of a CTA.
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ComingNextPill } from "@/components/onboarding/SectionStatusPill";
import { sectionHeadingId, type OnboardingSectionDef } from "@/lib/onboardingProgress";

// Opens the target section: scroll it into view and move focus to its heading
// (stable DOM id + tabIndex={-1}) — no route state, no Zustand state (TE-4).
function openSection(def: OnboardingSectionDef) {
  const card = document.getElementById(def.domId);
  card?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById(sectionHeadingId(def))?.focus({ preventScroll: true });
}

export function NextActionCard({
  nextSection,
}: {
  nextSection: OnboardingSectionDef | null | undefined;
}) {
  return (
    <Card>
      <CardContent className="flex min-h-[56px] items-center justify-between gap-3 p-4">
        {nextSection === undefined ? (
          <Skeleton className="h-8 w-52" />
        ) : nextSection === null ? (
          <>
            <div className="text-[13px] text-foreground">
              All scope sections are complete. Assignments is the next step in this journey.
            </div>
            <ComingNextPill />
          </>
        ) : (
          <>
            <div className="text-[13px] text-muted-foreground">
              Pick up where the scope journey left off.
            </div>
            <Button className="bg-[#1B4D3E]" onClick={() => openSection(nextSection)}>
              Next: {nextSection.title}
              <ArrowRight className="h-4 w-4" />
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
