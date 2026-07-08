// Redesign E0.0 shell sidebar (TE-6). Journey-ordered navigation for the
// Credentialing Manager workspace: Portfolio sits above the org context; the
// org switcher anchors the active org; the four org-scoped journey slots (Get
// started, Scope, Work, Outcomes) are grouped beneath it. No admin/config items
// (F0.0.1). The active org is always visible (F0.0.2) and Portfolio is a
// one-step return from every surface (F0.0.4). The org switcher rescopes the
// workspace (F0.0.3, paired with the <Outlet key={activeOrgId}> remount in
// __root). This same sidebar renders inside the mobile drawer, so the switcher
// and the Portfolio return survive the small-screen collapse (F0.0.1).
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAuthStore, useActiveMembership } from "@/lib/auth-store";
import logoAsset from "@/assets/minted-mark.png.asset.json";
import {
  LayoutGrid,
  Compass,
  Target,
  ListChecks,
  TrendingUp,
  ChevronDown,
  Check,
  LogOut,
} from "lucide-react";

type NavLink = {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
};

// Portfolio (cross-org) sits above the org context and is the one-step return.
const portfolioNav: NavLink = { to: "/portfolio", label: "Portfolio", icon: LayoutGrid };

// The org-scoped journey, in order (F0.0.1). Reserved routes until their stage
// ships; each resolves to the shared "not yet available" state, so no dead links.
const journeyNav: NavLink[] = [
  { to: "/get-started", label: "Get started", icon: Compass },
  { to: "/scope", label: "Scope", icon: Target },
  { to: "/work", label: "Work", icon: ListChecks },
  { to: "/outcomes", label: "Outcomes", icon: TrendingUp },
];

function initialsOf(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

const roleLabel: Record<string, string> = {
  specialist: "Specialist",
  billing: "Billing",
  admin: "Admin",
};

interface SidebarProps {
  onNavigate?: () => void;
}

const navItemClass = (activeItem: boolean) =>
  `flex items-center gap-3 px-3 py-2 rounded-[var(--mp-radius-sm)] text-[13px] transition-colors ${
    activeItem
      ? "bg-white/10 text-white font-medium"
      : "text-white/60 hover:text-white hover:bg-white/5"
  }`;

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const memberships = useAuthStore((s) => s.memberships);
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  const signOut = useAuthStore((s) => s.signOut);
  const user = useAuthStore((s) => s.user);
  const fullName = useAuthStore((s) => s.fullName);
  const active = useActiveMembership();
  const activeOrgName = active?.orgName ?? "—";
  const multiOrg = memberships.length > 1;

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login", replace: true });
  }

  function renderNavItem(item: NavLink) {
    const Icon = item.icon;
    const activeItem = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={activeItem ? "page" : undefined}
        className={navItemClass(activeItem)}
        onClick={onNavigate}
      >
        <Icon className="w-4 h-4" />
        {item.label}
      </Link>
    );
  }

  const orgTile = (
    <div className="w-7 h-7 rounded-[var(--mp-radius-sm)] bg-white flex items-center justify-center flex-shrink-0">
      <img src={logoAsset.url} alt="" className="w-5 h-5 object-contain" />
    </div>
  );

  return (
    <aside className="w-full md:w-[232px] flex-shrink-0 bg-mp-sidebar flex flex-col h-full">
      {/* Portfolio — above the org context, always a one-step return (F0.0.4). */}
      <div className="px-3 pt-4 pb-2">
        <nav aria-label="Portfolio">{renderNavItem(portfolioNav)}</nav>
      </div>

      <div className="mx-3 border-t border-white/10" />

      {/* Active-org context: switcher + the org-scoped journey grouped under it. */}
      <div className="px-3 pt-3 pb-2">
        {multiOrg ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Active organization: ${activeOrgName}. Switch organization`}
                className="w-full flex items-center gap-2.5 rounded-[var(--mp-radius-md)] px-2 py-2 text-left hover:bg-white/5 transition-colors"
              >
                {orgTile}
                <span className="flex-1 truncate text-[14px] font-semibold text-white">
                  {activeOrgName}
                </span>
                <ChevronDown className="w-4 h-4 text-white/50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium">
                Organizations
              </DropdownMenuLabel>
              {memberships.map((m) => (
                <DropdownMenuItem
                  key={m.orgId}
                  onSelect={() => setActiveOrg(m.orgId)}
                  className="flex items-center justify-between"
                >
                  <span>{m.orgName}</span>
                  {m.orgId === activeOrgId ? <Check className="w-4 h-4 text-primary" /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="w-full flex items-center gap-2.5 px-2 py-2">
            {orgTile}
            <span className="flex-1 truncate text-[14px] font-semibold text-white">
              {activeOrgName}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-1">
        <nav className="space-y-0.5" aria-label={`${activeOrgName} navigation`}>
          {journeyNav.map(renderNavItem)}
        </nav>
      </div>

      {/* User footer */}
      <div className="border-t border-white/10 p-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Account menu"
              className="w-full flex items-center gap-2.5 rounded-[var(--mp-radius-md)] px-2 py-2 text-left hover:bg-white/5 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-[11px] font-medium text-white flex-shrink-0">
                {initialsOf(fullName, user?.email ?? null)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-[13px] font-medium text-white">
                  {fullName ?? user?.email ?? "Signed in"}
                </div>
                <div className="truncate text-[11px] text-white/50">
                  {active ? (roleLabel[active.role] ?? active.role) : ""}
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-white/40" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-64">
            <div className="px-3 py-2">
              <div className="text-[13px] font-medium text-foreground truncate">
                {fullName ?? user?.email ?? "Signed in"}
              </div>
              <div className="text-[12px] text-muted-foreground truncate">{user?.email}</div>
              <div className="mt-2 flex items-center gap-2">
                {active ? (
                  <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {roleLabel[active.role] ?? active.role}
                  </span>
                ) : null}
                <span className="text-[11px] text-muted-foreground truncate">{activeOrgName}</span>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut} className="text-destructive">
              <LogOut className="w-4 h-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
