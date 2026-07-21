// Active section bodies for the wizard's section-content mount contract
// (E1.0 F1.0.1). The route composes these per section key; E1.1 (Provider
// Group), E1.2 (Facilities), and E1.3 (Providers) land their forms by
// swapping their section's body component in the route's registry — no
// navigation or shell rework. Until a form lands, an active section renders
// its start state (never NotYetAvailable): what the section holds today and a
// real CTA to the surface where the data is entered right now. Progress is
// derived from row presence, so work done through those surfaces flips the
// wizard chips automatically (F1.0.2).
import { OrgDetailsBody } from "@/components/onboarding/OrgDetailsBody";
import { ProviderGroupSection } from "@/components/onboarding/ProviderGroupSection";
import { FacilitySection } from "@/components/onboarding/FacilitySection";
import { ProviderRosterSection } from "@/components/onboarding/ProviderRosterSection";
import { AssignmentSection } from "@/components/onboarding/AssignmentSection";
import { PayerNetworkSection } from "@/components/payers/PayerNetworkSection";
import type { OnboardingWizardData } from "@/hooks/useOnboardingWizard";

export interface SectionBodyProps {
  wizard: OnboardingWizardData;
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

// E1.3: the real CAQH roster form/list replaced the E1.0 start placeholder.
export function ProvidersSectionBody({ wizard }: SectionBodyProps) {
  return <ProviderRosterSection wizard={wizard} />;
}

// E1.4: the first R3 preview to activate — provider↔facility assignments.
export function AssignmentsSectionBody({ wizard }: SectionBodyProps) {
  return <AssignmentSection wizard={wizard} />;
}

// E1.5: the payer attachment surface — group×payer×state network targets.
export function PayerNetworkSectionBody({ wizard }: SectionBodyProps) {
  return <PayerNetworkSection wizard={wizard} />;
}

// E1.8: the derived enrollment-readiness matrix (advisory, never blocking).
