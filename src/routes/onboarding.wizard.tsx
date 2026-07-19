// Onboarding wizard — Stage 1 front door (redesign E1.0). Replaces the E0.8
// placeholder sections with the R1 scope-section framework: the full journey
// rendered from the ordered registry in src/lib/onboardingProgress (four
// active sections, then the R3 previews), per-section status chips DERIVED
// from scope data at render time (F1.0.2 — no stored wizard flags), and one
// persistent "Next: …" affordance that is also the resume mechanism (F1.0.3).
// The route is only the page composer (TE-1): data flows through the
// useOnboardingWizard composition hook, section UI lives in
// src/components/onboarding/, and E1.1–E1.3 mount their forms via the
// SECTION_BODIES registry.
import { useEffect, type ComponentType } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { buttonVariants } from "@/components/ui/button";
import { NextActionCard } from "@/components/onboarding/NextActionCard";
import { PreviewSectionCard } from "@/components/onboarding/PreviewSectionCard";
import { WizardSectionCard } from "@/components/onboarding/WizardSectionCard";
import { openSection } from "@/components/onboarding/openSection";
import {
  AssignmentsSectionBody,
  FacilitiesSectionBody,
  OrgDetailsSectionBody,
  PayerNetworkSectionBody,
  ProviderGroupSectionBody,
  ProvidersSectionBody,
  ScopeReviewSectionBody,
  type SectionBodyProps,
} from "@/components/onboarding/sectionBodies";
import { useOnboardingWizard } from "@/hooks/useOnboardingWizard";
import {
  ACTIVE_SECTIONS,
  ONBOARDING_SECTIONS,
  type ActiveSectionKey,
} from "@/lib/onboardingProgress";

interface WizardSearch {
  /** Deep-link a section to focus (e.g. the E4.2 "Configure credentialing
   * scope" hand-off from the payer catalog lands on Payer Network). */
  section?: ActiveSectionKey;
}

export const Route = createFileRoute("/onboarding/wizard")({
  validateSearch: (search: Record<string, unknown>): WizardSearch => {
    const raw = typeof search.section === "string" ? search.section : undefined;
    const match = ACTIVE_SECTIONS.find((d) => d.key === raw);
    return match ? { section: match.key } : {};
  },
  component: OnboardingWizardPage,
});

// The section-content mount registry (F1.0.1): E1.1–E1.3 drop their forms in
// by swapping their section's entry. Keys and order come from the shared
// registry in src/lib/onboardingProgress — never a second ordering.
const SECTION_BODIES: Record<ActiveSectionKey, ComponentType<SectionBodyProps>> = {
  org_details: OrgDetailsSectionBody,
  provider_group: ProviderGroupSectionBody,
  facilities: FacilitiesSectionBody,
  providers: ProvidersSectionBody,
  assignments: AssignmentsSectionBody,
  payer_network: PayerNetworkSectionBody,
  scope_review: ScopeReviewSectionBody,
};

function OnboardingWizardPage() {
  const wizard = useOnboardingWizard();
  const { section } = Route.useSearch();

  useEffect(() => {
    if (!section) return;
    const def = ACTIVE_SECTIONS.find((d) => d.key === section);
    if (!def) return;
    // Defer to after the section cards paint, then scroll + focus + highlight.
    const raf = requestAnimationFrame(() => openSection(def));
    return () => cancelAnimationFrame(raf);
  }, [section]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboarding"
        actions={
          <Link to="/org-detail" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="h-4 w-4" />
            Org Detail
          </Link>
        }
      />

      <NextActionCard nextSection={wizard.nextSection} />

      {ONBOARDING_SECTIONS.map((def) => {
        if (def.kind === "preview") return <PreviewSectionCard key={def.key} def={def} />;
        const Body = SECTION_BODIES[def.key];
        return (
          <WizardSectionCard key={def.key} def={def} state={wizard.sections[def.key]}>
            <Body wizard={wizard} />
          </WizardSectionCard>
        );
      })}
    </div>
  );
}
