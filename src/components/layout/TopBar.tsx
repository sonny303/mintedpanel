// Top bar: org switcher (dropdown when user has multiple orgs, static label otherwise),
// user menu showing name, role badge, active org, and sign out.
import React from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Search, Bell, Check } from "lucide-react";
import { useAuthStore, useActiveMembership } from "@/lib/auth-store";

function initialsOf(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return (first + second).toUpperCase() || "U";
}

const roleLabel: Record<string, string> = {
  specialist: "Specialist",
  billing: "Billing",
  admin: "Admin",
};

export function TopBar({ children }: { children?: React.ReactNode }) {
  const navigate = useNavigate();
  const memberships = useAuthStore((s) => s.memberships);
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  const signOut = useAuthStore((s) => s.signOut);
  const user = useAuthStore((s) => s.user);
  const fullName = useAuthStore((s) => s.fullName);
  const active = useActiveMembership();
  const activeOrgName = active?.orgName ?? "—";
  const initial = activeOrgName.charAt(0).toUpperCase();
  const multi = memberships.length > 1;

  async function handleSignOut() {
    await signOut();
    navigate({ to: "/login", replace: true });
  }

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center">
        {multi ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 px-2 flex items-center gap-2 font-semibold text-[14px] hover:bg-muted"
              >
                <div className="w-5 h-5 rounded bg-primary text-primary-foreground flex items-center justify-center text-[10px]">
                  {initial}
                </div>
                {activeOrgName}
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
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
          <div className="h-8 px-2 flex items-center gap-2 font-semibold text-[14px]">
            <div className="w-5 h-5 rounded bg-primary text-primary-foreground flex items-center justify-center text-[10px]">
              {initial}
            </div>
            {activeOrgName}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        {children}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Search"
          className="h-8 w-8 text-muted-foreground"
        >
          <Search className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="h-8 w-8 text-muted-foreground"
        >
          <Bell className="w-4 h-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Account menu"
              className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary font-medium text-[12px] hover:bg-primary/20 transition-colors"
            >
              {initialsOf(fullName, user?.email ?? null)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
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
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
