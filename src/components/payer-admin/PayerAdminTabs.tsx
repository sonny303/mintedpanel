// E6.5 F6.5.1 — the two-tab Payer Setup shell: Catalog and SOPs are REAL URL
// segments (shareable, no ?tab= state), plus the F6.5.6 interim-governance
// note that must stay visible while global authoring is open to all
// authenticated users (R7 introduces platform roles).
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export type PayerAdminTab = "catalog" | "sops";

const TABS: { key: PayerAdminTab; label: string; to: string }[] = [
  { key: "catalog", label: "Catalog", to: "/admin/payer-admin/catalog" },
  { key: "sops", label: "SOPs", to: "/admin/payer-admin/sops" },
];

export function PayerAdminTabs({ active }: { active: PayerAdminTab }) {
  return (
    <div className="space-y-3">
      <nav
        aria-label="Payer Setup areas"
        className="inline-flex items-center gap-1 rounded-[6px] bg-gray-100 p-1"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            to={tab.to}
            aria-current={active === tab.key ? "page" : undefined}
            className={cn(
              "rounded-[4px] px-3 py-1.5 text-[13px] font-medium transition-colors",
              active === tab.key
                ? "bg-white text-gray-900 shadow-none"
                : "text-gray-600 hover:text-gray-900",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {/* F6.5.6 AC — the interim governance posture stays on screen. */}
      <p className="rounded-[4px] border border-[#FDE68A] bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">
        Global SOPs, portals, and mappings are authored once and inherited by every organization.
        Authoring is open to all signed-in users for now; platform roles arrive in a later release.
      </p>
    </div>
  );
}
