// Redesign E0.6 sidebar (TE-2) — the segmented navigation IA that SUPERSEDES the
// E0.0 journey-ordered sidebar. Two segments:
//   TOP — Employee / cross-org work (Home, Reporting Center; reserved Setup/Config
//         → Payer Setup / SOP, reserved Cases / Tasks). Does not require an org.
//   BOTTOM — Organization (the active-org header IS the switcher; Account Detail;
//         reserved Facilities / Providers). Org-scoped.
// Portfolio is no longer a top-level item — it is report #1 inside the Reporting
// Center. Reserved items route to the shared "not yet available" state (/soon).
// When no org is active, the bottom segment shows a "select an organization"
// prompt rather than collapsing. Org switch clears view state via the existing
// <Outlet key={activeOrgId}> remount + setActiveOrg → removeQueries. Renders in
// both the desktop rail and the mobile drawer.
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
  Home,
  BarChart3,
  CreditCard,
  FileText,
  FolderKanban,
  ListChecks,
  Building,
  Users,
  Contact,
  ChevronDown,
  Check,
  Plus,
  LogOut,
} from "lucide-react";

type Icon = typeof Home;

// A real route the operator can open now.
type NavLink = { to: string; label: string; icon: Icon };
// A reserved slot — routes to the shared /soon state carrying its title.
type ReservedLink = { title: string; label: string; icon: Icon };

const topNav: NavLink[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/reporting", label: "Reporting Center", icon: BarChart3 },
];

const setupReserved: ReservedLink[] = [
  { title: "Payer Setup", label: "Payer Setup", icon: CreditCard },
  { title: "SOP", label: "SOP", icon: FileText },
];

const topReserved: ReservedLink[] = [
  { title: "Cases", label: "Cases", icon: FolderKanban },
  { title: "Tasks", label: "Tasks", icon: ListChecks },
];

const orgNav: NavLink[] = [{ to: "/get-started", label: "Account Detail", icon: Contact }];

const orgReserved: ReservedLink[] = [
  { title: "Facilities", label: "Facilities", icon: Building },
  { title: "Providers", label: "Providers", icon: Users },
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

const navItemClass = (activeItem: boolean) =>
  `flex items-center gap-3 px-3 py-2 rounded-[var(--mp-radius-sm)] text-[13px] transition-colors ${
    activeItem
      ? "bg-white/10 text-white font-medium"
      : "text-white/60 hover:text-white hover:bg-white/5"
  }`;

interface SidebarProps {
  onNavigate?: () => void;
}

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

  // "/" is Home = the E0.4 landing resolver; highlight it only on the marketing
  // root, never as a prefix of every route.
  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");

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

  function renderReserved(item: ReservedLink) {
    const Icon = item.icon;
    return (
      <Link
        key={item.title}
        to="/soon"
        search={{ title: item.title }}
        className={navItemClass(false)}
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
      {/* Branding (E0.8 F0.8.6) */}
      <div className="px-5 pt-4 pb-2 flex items-center gap-2">
        <img src={logoAsset.url} alt="Minted Panel" className="w-6 h-6 object-contain" />
        <span className="text-[14px] font-semibold text-white">Minted Panel</span>
      </div>

      {/* TOP segment — cross-org work. */}
      <div className="px-3 pt-0 pb-2">
        <div className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-white/35">
          Workspace
        </div>
        <nav className="space-y-0.5" aria-label="Cross-organization">
          {topNav.map(renderNavItem)}
        </nav>
        <div className="mt-2 px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-white/35">
          Setup / Config
        </div>
        <nav className="space-y-0.5" aria-label="Setup and configuration">
          {setupReserved.map(renderReserved)}
        </nav>
        <nav className="mt-2 space-y-0.5" aria-label="Work">
          {topReserved.map(renderReserved)}
        </nav>
      </div>

      <div className="mx-3 border-t border-white/10" />

      {/* BOTTOM segment — the active organization. The header IS the switcher. */}
      <div className="flex-1 overflow-y-auto px-3 pt-3 pb-1">
        {active ? (
          <>
            <div className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-white/35">
              Org space
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Active organization: ${active.orgName}. Switch organization`}
                  className="w-full flex items-center gap-2.5 rounded-[var(--mp-radius-md)] px-2 py-2 text-left hover:bg-white/5 transition-colors"
                >
                  {orgTile}
                  <span className="flex-1 truncate text-[14px] font-semibold text-white">
                    {active.orgName}
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate({ to: "/onboarding" })}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add organization
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <nav className="mt-1 space-y-0.5" aria-label={`${active.orgName} navigation`}>
              {orgNav.map(renderNavItem)}
              {orgReserved.map(renderReserved)}
            </nav>
          </>
        ) : (
          // No active org (e.g. while in a cross-org surface with zero orgs):
          // prompt rather than collapse (TE-2).
          <div className="rounded-[var(--mp-radius-md)] border border-white/10 px-3 py-3 text-[12px] text-white/50">
            Select an organization to see its details.
          </div>
        )}
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
              {active ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
                    {roleLabel[active.role] ?? active.role}
                  </span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {active.orgName}
                  </span>
                </div>
              ) : null}
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
