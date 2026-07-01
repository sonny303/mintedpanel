// Hero section: eyebrow, headline, subtext, two CTAs, and abstract graphic.
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Eyebrow } from './Eyebrow';
import heroAsset from '@/assets/provider-hero.png.asset.json';

export function HeroSection() {
  const navigate = useNavigate();
  return (
    <section className="max-w-6xl mx-auto px-6 pt-16 pb-20 grid gap-12 md:grid-cols-2 items-center">
      <div>
        <Eyebrow>Managed Credentialing &amp; Contracting</Eyebrow>
        <h1 className="mt-4 text-[36px] md:text-[44px] leading-tight font-bold text-[#1F2937] tracking-tight">
          Your providers see patients. We get them on panels.
        </h1>
        <p className="mt-5 text-[17px] leading-relaxed text-[#6B7280] max-w-xl">
          Minted Panel handles credentialing and contracting for healthcare provider groups —
          across payers and states — so your team can focus on care.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button className="bg-[#1B4D3E] text-white hover:bg-[#163e32] h-11 px-6">
            Schedule a Meeting
          </Button>
          <Button
            variant="outline"
            className="border-[#1B4D3E] text-[#1B4D3E] hover:bg-[#1B4D3E]/5 h-11 px-6"
            onClick={() => navigate({ to: '/login' })}
          >
            Login to Dashboard
          </Button>
        </div>
      </div>
      <div className="flex justify-center md:justify-end">
        <HeroGraphic className="w-full max-w-[480px] h-auto" />
      </div>
    </section>
  );
}
