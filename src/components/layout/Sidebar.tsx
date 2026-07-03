// M1 shell sidebar: dark surface, org switcher, search trigger, main nav,
// permission-gated ADMIN section, user footer. Home and Launches stay behind
// flags until M5 / M4 (decisions B1 + spec nav).
import { useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { SearchDialog } from "@/components/layout/SearchDialog";
import { useAuthStore, useActiveMembership } from "@/lib/auth-store";
import { useIsAdmin } from "@/lib/permissions";
import logoAsset from "@/assets/minted-mark.png.asset.json";
import {
  Users,
  FileStack,
  BarChart3,
  FileText,
  Network,
  Building2,
  CheckCircle2,
  UserCog,
  House,
  Rocket,
  ChevronDown,
  Search,
  LogOut,
  Check,
} from "lucide-react";

// Nav items hidden until their milestone ships (B1 / spec nav section).
const SHOW_HOME_NAV = false; // M5
const SHOW_LAUNCHES_NAV = false; // M4

type NavLink = {
  to: string;
  label: string;
  icon: typeof Users;
  exact?: boolean;
};

const mainNav: NavLink[] = [
  // Home (M5) and Launches (M4) join here when their flags flip on.
  ...(SHOW_HOME_NAV ? [{ to: "/home", label: "Home", icon: House }] : []),
  { to: "/providers", label: "Providers", icon: Users },
  { to: "/cases", label: "Cases", icon: FileStack },
  ...(SHOW_LAUNCHES_NAV ? [{ to: "/launches", label: "Launches", icon: Rocket }] : []),
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

const adminNav: NavLink[] = [
  { to: "/admin/statuses", label: "Statuses", icon: CheckCircle2 },
  { to: "/admin/templates", label: "Templates", icon: FileText },
  { to: "/admin/mso-routing", label: "MSO Routing", icon: Network },
  { to: "/admin/payers", label: "Payers", icon: Building2 },
  { to: "/admin/audit", label: "Audit Log", icon: FileStack },
  { to: "/admin/settings", label: "Group & Locations", icon: Building2 },
  { to: "/admin/users", label: "Users", icon: UserCog },
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

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const memberships = useAuthStore((s) => s.memberships);
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  const signOut = useAuthStore((s) => s.signOut);
  const user = useAuthStore((s) => s.user);
  const fullName = useAuthStore((s) => s.fullName);
  const active = useActiveMembership();
  const activeOrgName = active?.orgName ?? "—";
  const multiOrg = memberships.length > 1;
  const [searchOpen, setSearchOpen] = useState(false);

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  const itemClass = (activeItem: boolean) =>
    `flex items-center gap-3 px-3 py-2 rounded-[var(--mp-radius-sm)] text-[13px] transition-colors ${
      activeItem
        ? "bg-white/10 text-white font-medium"
        : "text-white/60 hover:text-white hover:bg-white/5"
    }`;

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login", replace: true });
  }

  function renderNav(items: NavLink[], label: string) {
    return (
      <nav className="space-y-0.5" aria-label={label}>
        {items.map((item) => {
          const Icon = item.icon;
          const activeItem = isActive(item.to, item.exact);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={activeItem ? "page" : undefined}
              className={itemClass(activeItem)}
              onClick={onNavigate}
            >
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  const orgTile = (
    <div className="w-7 h-7 rounded-[var(--mp-radius-sm)] bg-white flex items-center justify-center flex-shrink-0">
      <img src={logoAsset.url} alt="" className="w-5 h-5 object-contain" />
    </div>
  );

  return (
    <aside className="w-full md:w-[232px] flex-shrink-0 bg-mp-sidebar flex flex-col h-full">
      {/* Org switcher */}
      <div className="px-3 pt-4 pb-2">
        {multiOrg ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
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

      {/* Search trigger */}
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="w-full flex items-center gap-2 rounded-[var(--mp-radius-sm)] border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white/50 hover:bg-white/10 hover:text-white/70 transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          Search
        </button>
      </div>
      {/* Mounted lazily so the search hooks only fire once the user opens it */}
      {searchOpen ? <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} /> : null}

      <div className="flex-1 overflow-y-auto px-3 py-1 flex flex-col gap-6">
        {renderNav(mainNav, "Main")}

        {isAdmin ? (
          <div>
            <h3 className="px-3 text-[10.5px] font-semibold uppercase tracking-wider text-white/40 mb-2">
              Admin
            </h3>
            {renderNav(adminNav, "Admin")}
          </div>
        ) : null}
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
