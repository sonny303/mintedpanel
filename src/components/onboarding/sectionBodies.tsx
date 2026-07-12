// Active section bodies for the wizard's section-content mount contract
// (E1.0 F1.0.1). The route composes these per section key; E1.1 (Provider
// Group), E1.2 (Facilities), and E1.3 (Providers) land their forms by
// swapping their section's body component in the route's registry — no
// navigation or shell rework. Until a form lands, an active section renders
// its start state (never NotYetAvailable): what the section holds today and a
// real CTA to the surface where the data is entered right now. Progress is
// derived from row presence, so work done through those surfaces flips the
// wizard chips automatically (F1.0.2).
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import { OrgDetailsBody } from "@/components/onboarding/OrgDetailsBody";
import { ProviderGroupSection } from "@/components/onboarding/ProviderGroupSection";
import { FacilitySection } from "@/components/onboarding/FacilitySection";
import type { OnboardingWizardData } from "@/hooks/useOnboardingWizard";

export interface SectionBodyProps {
  wizard: OnboardingWizardData;
}

function ScopeCountBody({
  count,
  summary,
  startPrompt,
  ctaLabel,
  ctaTo,
}: {
  count: number;
  summary: string;
  startPrompt: string;
  ctaLabel: string;
  ctaTo: string;
}) {
  if (count > 0) {
    return <p className="text-[13px] text-foreground">{summary}</p>;
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-[13px] text-muted-foreground">{startPrompt}</p>
      <Link to={ctaTo} className={buttonVariants({ variant: "outline" })}>
        {ctaLabel}
      </Link>
    </div>
  );
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function OrgDetailsSectionBody({ wizard }: SectionBodyProps) {
  return <OrgDetailsBody orgName={wizard.orgName} contacts={wizard.contacts} />;
}

// E1.1: the real entity form/list replaced the E1.0 start placeholder here.
export function ProviderGroupSectionBody({ wizard }: SectionBodyProps) {
  return <ProviderGroupSection wizard={wizard} />;
}

// E1.2: the real CAQH facility form/list replaced the E1.0 start placeholder.
export function FacilitiesSectionBody({ wizard }: SectionBodyProps) {
  return <FacilitySection wizard={wizard} />;
}

export function ProvidersSectionBody({ wizard }: SectionBodyProps) {
  return (
    <ScopeCountBody
      count={wizard.providerCount}
      summary={`${plural(wizard.providerCount, "provider", "providers")} on the roster.`}
      startPrompt="Add the providers you'll credential for this organization."
      ctaLabel="Add provider"
      ctaTo="/providers/new"
    />
  );
}
