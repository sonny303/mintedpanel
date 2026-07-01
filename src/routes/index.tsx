// Public marketing landing page for Minted Panel Credentialing.
// Composed from small section components under src/components/landing/.
import { createFileRoute } from '@tanstack/react-router';
import { LandingNav } from '@/components/landing/LandingNav';
import { HeroSection } from '@/components/landing/HeroSection';
import { StatsSection } from '@/components/landing/StatsSection';
import { AudienceSection } from '@/components/landing/AudienceSection';
import { ProblemSection } from '@/components/landing/ProblemSection';
import { HowItWorksSection } from '@/components/landing/HowItWorksSection';
import { ServicesSection } from '@/components/landing/ServicesSection';
import { ScaleSection } from '@/components/landing/ScaleSection';
import { WhySection } from '@/components/landing/WhySection';
import { TestimonialSection } from '@/components/landing/TestimonialSection';
import { FinalCTASection } from '@/components/landing/FinalCTASection';
import { LandingFooter } from '@/components/landing/LandingFooter';

export const Route = createFileRoute('/')({
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-dvh bg-[#FDFDFC] text-[#1F2937] font-sans">
      <LandingNav />
      <main>
        <HeroSection />
        <StatsSection />
        <AudienceSection />
        <ProblemSection />
        <HowItWorksSection />
        <ServicesSection />
        <ScaleSection />
        <WhySection />
        <TestimonialSection />
        <FinalCTASection />
      </main>
      <LandingFooter />
    </div>
  );
}
