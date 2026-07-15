// Sidebar IA v2 (redesign E0.9 F0.9.3, per the approved spec
// docs/redesign/design-system/design-system-reference/Sidebar Nav.dc.html +
// the NAVIGATION section of the reference readme). Supersedes the E0.6
// segmented nav and the E0.8 "Org space" label.
//
// IA top-to-bottom: Workspace (Home, My Cases — the E2.3 queue, its one
// authorized shell edit —, Cases + open-case CountBadge) · Payers
// (Payer Management) · Reporting Center (standalone — section labels only
// over 2+ item groups) · generous break + divider · org zone (the switcher IS
// the header: a contained tile with an ORGANIZATION eyebrow; children Account
// Detail / Facilities (reserved) / Providers; dashed prompt tile when no org) · user
// footer (menu opens upward: identity, Settings, Sign out).
//
// Switcher menu groups orgs by lifecycle (Active / Prospects / Inactive —
// group headings ONLY, never a per-org status label, E0.0 locked decision);
// search appears above 10 orgs, recents-only at 100+; footer = Add
// organization (→ /onboarding, the E0.8 entry point) + View all organizations
// (→ /reporting/portfolio). Org switch keeps the E0.0 TE-4 semantics
// (<Outlet key={activeOrgId}> remount + setActiveOrg → removeQueries).
//
// Focus on the dark rail uses a white-alpha ring — the app's soft green ring
// is invisible on forest. Renders in both the desktop rail and mobile drawer.
import { useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuthStore, useActiveMembership, type MembershipEntry } from "@/lib/auth-store";
import { useCases } from "@/hooks/useCases";
import { useStatusConfigs } from "@/hooks/useAdmin";
import { useIsAdmin } from "@/lib/permissions";
// The approved white layered-jack mark (E1.0 F1.0.4 / TE-8), copied from
// docs/redesign/design-system/design-system-reference/assets/logo-white.png —
// replaces the wrong minted-mark asset. Paired with the Geist 600 wordmark on
// the #0C2A1D rail; never recolored or given effects (brand guideline).
import logoWhite from "@/assets/logo-white.png";
import {
  Home,
  FolderKanban,
  ListChecks,
  CreditCard,
  BarChart3,
  Contact,
  Building,
  Users,
  ChevronDown,
  Check,
  Plus,
  ArrowRight,
  Search,
  Settings,
  SlidersHorizontal,
  LogOut,
} from "lucide-react";

type Icon = typeof Home;

// A real route the operator can open now.
type NavLink = { to: string; label: string; icon: Icon };
// A reserved slot — routes to the shared /soon state carrying its title.
type ReservedLink = { title: string; label: string; icon: Icon };

const orgReserved: ReservedLink[] = [{ title: "Facilities", label: "Facilities", icon: Building }];

// Switcher scale rules (reference readme NAVIGATION): ≤10 orgs plain grouped
// list; above 10 a search field + scroll; at 100+ recents only (the active org
// is the only tracked recent today) with "View all" exiting to the portfolio.
const SEARCH_ABOVE = 10;
const RECENTS_AT = 100;

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

// Nav focus uses a white-alpha ring — the global soft green ring is invisible
// on the forest rail (F0.9.3).
const navFocus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(255,255,255,0.35)]";

const navItemClass = (activeItem: boolean) =>
  `flex items-center gap-3 px-3 py-2 rounded-[var(--mp-radius-control)] text-[13px] transition-colors ${navFocus} ${
    activeItem
      ? "bg-white/10 text-white font-medium shadow-[inset_2px_0_0_#C8DBD4]"
      : "text-white/60 hover:text-white hover:bg-white/5"
  }`;

const sectionLabelClass =
  "px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-white/35";

// Open cases = credentialing status not in the 'complete' action bucket;
// status-less cases count as open (the same open-case rule the extension's
// case list uses). Shares the /cases page cache keys — no polling (E0.9 TD-2).
function useOpenCaseCount(): number | null {
  const casesQ = useCases();
  const statusQ = useStatusConfigs("credentialing");
  return useMemo(() => {
    if (!casesQ.data) return null;
    const completeIds = new Set(
      (statusQ.data ?? []).filter((s) => s.actionBucket === "complete").map((s) => s.id),
    );
    return casesQ.data.filter(
      (c) => !c.credentialingStatusId || !completeIds.has(c.credentialingStatusId),
    ).length;
  }, [casesQ.data, statusQ.data]);
}

// Lifecycle-grouped switcher entries. Group headings only — never a per-org
// status label (E0.0 locked decision, same mechanism as the Portfolio).
const LIFECYCLE_GROUPS = [
  { key: "active", label: "Active" },
  { key: "prospect", label: "Prospects" },
  { key: "inactive", label: "Inactive" },
] as const;

function groupMemberships(memberships: MembershipEntry[], query: string) {
  const q = query.trim().toLowerCase();
  const matches = (m: MembershipEntry) => !q || m.orgName.toLowerCase().includes(q);
  return LIFECYCLE_GROUPS.map((g) => ({
    ...g,
    orgs: memberships.filter((m) => (m.lifecycleState ?? "active") === g.key && matches(m)),
  })).filter((g) => g.orgs.length > 0);
}

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
  const openCases = useOpenCaseCount();
  // E4.2 TE-1 — the admin-only Payer & SOP Setup module link (the one
  // authorized shell edit for this epic; non-admins never see it).
  const isAdmin = useIsAdmin();
  const [orgQuery, setOrgQuery] = useState("");

  // "/" is Home = the E0.4 landing resolver; highlight it only on the root,
  // never as a prefix of every route.
  const isActive = (to: string) =>
    to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(to + "/");

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login", replace: true });
  }

  function renderNavItem(item: NavLink, trailing?: React.ReactNode) {
    const ItemIcon = item.icon;
    const activeItem = isActive(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        aria-current={activeItem ? "page" : undefined}
        className={navItemClass(activeItem)}
        onClick={onNavigate}
      >
        <ItemIcon className="w-4 h-4 flex-none" />
        <span className="flex-1">{item.label}</span>
        {trailing}
      </Link>
    );
  }

  function renderReserved(item: ReservedLink) {
    const ItemIcon = item.icon;
    return (
      <Link
        key={item.title}
        to="/soon"
        search={{ title: item.title }}
        className={navItemClass(false)}
        onClick={onNavigate}
      >
        <ItemIcon className="w-4 h-4 flex-none" />
        {item.label}
      </Link>
    );
  }

  const showSearch = memberships.length > SEARCH_ABOVE;
  const recentsOnly = memberships.length >= RECENTS_AT && orgQuery.trim() === "";
  const visibleGroups = recentsOnly
    ? groupMemberships(
        memberships.filter((m) => m.orgId === activeOrgId),
        "",
      )
    : groupMemberships(memberships, orgQuery);

  return (
    <aside className="w-full md:w-[232px] flex-shrink-0 bg-mp-sidebar flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 pt-4 pb-2.5 flex items-center gap-2">
        <img src={logoWhite} alt="Minted Panel" className="w-6 h-6 object-contain" />
        <span className="text-[14px] font-semibold text-white">Minted Panel</span>
      </div>

      {/* Workspace — cross-org work */}
      <div className="px-3 pt-1.5">
        <div className={sectionLabelClass}>Workspace</div>
        <nav className="space-y-0.5" aria-label="Workspace">
          {renderNavItem({ to: "/", label: "Home", icon: Home })}
          {/* E2.3 TE-8 (the epic's one authorized shell edit): the
              next-best-action queue's Workspace entry — label "My Cases"
              per the PM decision ([r4-review] Q9); the route keeps the
              reserved /work path. */}
          {renderNavItem({ to: "/work", label: "My Cases", icon: ListChecks })}
          {renderNavItem(
            { to: "/cases", label: "Cases", icon: FolderKanban },
            openCases !== null ? (
              <span
                aria-label={`${openCases} open cases`}
                className="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-white/[0.14] px-[5px] text-[11px] font-semibold tabular-nums text-white"
              >
                {openCases}
              </span>
            ) : undefined,
          )}
        </nav>
      </div>

      {/* Payers */}
      <div className="px-3 pt-3.5">
        <div className={sectionLabelClass}>Payers</div>
        <nav className="space-y-0.5" aria-label="Payers">
          {renderNavItem({ to: "/admin/payers", label: "Payer Management", icon: CreditCard })}
          {isAdmin
            ? renderNavItem({
                to: "/admin/payer-admin",
                label: "Payer & SOP Setup",
                icon: SlidersHorizontal,
              })
            : null}
        </nav>
      </div>

      {/* Reporting Center — standalone (labels only over 2+ item groups) */}
      <nav className="px-3 pt-3.5 space-y-0.5" aria-label="Reporting">
        {renderNavItem({ to: "/reporting", label: "Reporting Center", icon: BarChart3 })}
      </nav>

      {/* Generous break + divider before the org zone */}
      <div className="mx-3 mt-10 border-t border-white/10" />

      {/* Org zone — the switcher tile IS the header (no "Org space" label). */}
      <div className="flex-1 overflow-y-auto px-3 pt-6 pb-1">
        {active ? (
          <>
            <DropdownMenu onOpenChange={(open) => !open && setOrgQuery("")}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Active organization: ${active.orgName}. Switch organization`}
                  className={`w-full flex items-center gap-2.5 rounded-[var(--mp-radius-sm)] border border-white/[0.08] bg-white/[0.06] px-3 py-[9px] mb-1.5 text-left hover:bg-white/10 transition-colors ${navFocus}`}
                >
                  <span className="flex-1 min-w-0 flex flex-col gap-px">
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-white/40">
                      Organization
                    </span>
                    <span className="truncate text-[14px] font-semibold text-white">
                      {active.orgName}
                    </span>
                  </span>
                  <ChevronDown className="w-4 h-4 flex-none text-white/50" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64 p-0">
                {showSearch ? (
                  <div className="border-b border-[var(--mp-border-subtle)] p-2">
                    <div className="flex h-[30px] items-center gap-2 rounded-[var(--mp-radius-control)] bg-[var(--mp-muted)] px-[9px]">
                      <Search className="h-[13px] w-[13px] flex-none text-[var(--mp-ink-faint)]" />
                      <input
                        value={orgQuery}
                        onChange={(e) => setOrgQuery(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder="Search organizations…"
                        aria-label="Search organizations"
                        className="w-full bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-[var(--mp-ink-faint)]"
                      />
                    </div>
                  </div>
                ) : null}
                <div className="max-h-[252px] overflow-y-auto py-1">
                  {recentsOnly ? (
                    <div className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground">
                      Showing recent organizations — search to find others.
                    </div>
                  ) : null}
                  {visibleGroups.map((group, gi) => (
                    <div
                      key={group.key}
                      className={gi > 0 ? "mt-1 border-t border-[var(--mp-border-faint)]" : ""}
                    >
                      <div className="px-3 pb-[3px] pt-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--mp-ink-faint)]">
                        {group.label}
                      </div>
                      {group.orgs.map((m) => (
                        <DropdownMenuItem
                          key={m.orgId}
                          onSelect={() => setActiveOrg(m.orgId)}
                          className={`flex items-center justify-between gap-2 px-3 py-[7px] text-[13px] ${
                            group.key === "inactive" ? "text-[var(--mp-ink-faint)]" : ""
                          }`}
                        >
                          <span className={m.orgId === activeOrgId ? "font-medium" : ""}>
                            {m.orgName}
                          </span>
                          {m.orgId === activeOrgId ? (
                            <Check className="w-3.5 h-3.5 text-primary" />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                    </div>
                  ))}
                  {visibleGroups.length === 0 ? (
                    <div className="px-3 py-2 text-[12.5px] text-muted-foreground">
                      No organizations match.
                    </div>
                  ) : null}
                </div>
                <div className="border-t border-[var(--mp-border-subtle)]">
                  <DropdownMenuItem
                    onSelect={() => navigate({ to: "/onboarding" })}
                    className="gap-2 px-3 py-[9px] font-medium text-primary"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add organization
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => navigate({ to: "/reporting/portfolio" })}
                    className="gap-2 border-t border-[var(--mp-border-faint)] px-3 py-[9px] text-[12.5px] text-muted-foreground"
                  >
                    View all organizations
                    <ArrowRight className="w-[13px] h-[13px]" />
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
            <nav className="space-y-0.5" aria-label={`${active.orgName} navigation`}>
              {renderNavItem({ to: "/get-started", label: "Account Detail", icon: Contact })}
              {orgReserved.map(renderReserved)}
              {renderNavItem({ to: "/providers", label: "Providers", icon: Users })}
            </nav>
          </>
        ) : (
          // No org selected → dashed-border prompt tile (F0.9.3).
          <div className="rounded-[var(--mp-radius-sm)] border border-dashed border-white/[0.22] px-3 py-3 text-[12px] leading-normal text-white/50">
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
              className={`w-full flex items-center gap-2.5 rounded-[var(--mp-radius-sm)] px-2 py-2 text-left bg-white/5 hover:bg-white/10 transition-colors ${navFocus}`}
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
          <DropdownMenuContent align="start" side="top" className="w-[230px]">
            <div className="px-3 py-2">
              <div className="text-[13px] font-medium text-foreground truncate">
                {fullName ?? user?.email ?? "Signed in"}
              </div>
              <div className="text-[12px] text-muted-foreground truncate">{user?.email}</div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                onNavigate?.();
                navigate({ to: "/admin/settings" });
              }}
              className="gap-2.5"
            >
              <Settings className="w-[15px] h-[15px] text-muted-foreground" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut} className="gap-2.5 text-destructive">
              <LogOut className="w-[15px] h-[15px]" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
