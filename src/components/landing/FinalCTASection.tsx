// Closing CTA with meeting and login buttons.
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function FinalCTASection() {
  const navigate = useNavigate();
  return (
    <section className="max-w-4xl mx-auto px-6 py-24 text-center">
      <h2 className="text-[28px] md:text-[34px] font-bold text-[#1F2937] tracking-tight">
        Ready to hand off your credentialing?
      </h2>
      <p className="mt-4 text-[16px] text-[#6B7280] max-w-2xl mx-auto">
        Schedule a brief call to review your provider roster and target payers. See how Minted
        Panel gets your providers in-network faster. Existing clients can log in to access their
        dashboard.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
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
    </section>
  );
}
