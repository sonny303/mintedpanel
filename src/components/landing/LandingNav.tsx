// Sticky top navigation for the public landing page.
// Wordmark lockup on the left, single Login button on the right.
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import logoAsset from '@/assets/mpc-logo.png.asset.json';

export function LandingNav() {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-[#E8E5E0]">
      <div className="max-w-6xl mx-auto h-16 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold text-[16px] tracking-tight text-[#1F2937]">
          <img src={logoAsset.url} alt="Minted Panel" className="w-7 h-7 object-contain" />
          Minted Panel
        </div>
        <Button
          variant="outline"
          className="border-[#1B4D3E] text-[#1B4D3E] hover:bg-[#1B4D3E]/5"
          onClick={() => navigate({ to: '/login' })}
        >
          Login
        </Button>
      </div>
    </header>
  );
}
