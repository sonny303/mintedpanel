// Minimal single-row footer.
import { Link } from "@tanstack/react-router";
import logoAsset from "@/assets/mpc-logo.png.asset.json";

export function LandingFooter() {
  return (
    <footer className="border-t border-[#E8E5E0] bg-[#F5F3EE]">
      <div className="max-w-6xl mx-auto px-6 h-16 flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#6B7280]">
        <div className="flex items-center gap-2 font-semibold text-[#1F2937]">
          <img src={logoAsset.url} alt="Minted Panel" className="w-6 h-6 object-contain" />
          Minted Panel
        </div>
        <div>© 2026 Minted Panel Credentialing</div>
        <Link to="/login" className="text-[#1B4D3E] hover:underline font-medium">
          Login
        </Link>
      </div>
    </footer>
  );
}
