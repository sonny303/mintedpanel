// Disabled R3 preview section (E1.0 F1.0.1 / TE-7): visible so the full scope
// journey reads from day one, but non-interactive — no click handler,
// aria-disabled, visibly muted. Labeled with the authored "Coming next" chip;
// previews never participate in the R1 completion calculation (TE-3).
import { Card, CardContent } from "@/components/ui/card";
import { ComingNextPill } from "@/components/onboarding/SectionStatusPill";
import type { OnboardingSectionDef } from "@/lib/onboardingProgress";

export function PreviewSectionCard({ def }: { def: OnboardingSectionDef }) {
  return (
    <Card id={def.domId} aria-disabled="true" className="opacity-60">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <h2 className="text-[15px] font-semibold text-muted-foreground">{def.title}</h2>
        <ComingNextPill />
      </CardContent>
    </Card>
  );
}
