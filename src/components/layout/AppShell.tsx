// Redesign E0.0 app shell (TE-6). Fixed sidebar on desktop; hamburger slide-in
// drawer on mobile (translateX pattern, overlay dismiss, X to close). On small
// screens the sidebar collapses into the drawer while the mobile header keeps
// the active org visible (F0.0.2) and offers a one-tap return to the Portfolio
// (F0.0.4); the drawer itself still carries the org switcher and Portfolio
// return, so nothing is lost in the collapse (F0.0.1). Route pages render in the
// content area.
import React, { useState } from "react";
import { Menu, X, BarChart3 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Sidebar } from "./Sidebar";
import { useActiveMembership } from "@/lib/auth-store";

interface AppShellProps {
  children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);
  const active = useActiveMembership();
  const activeOrgName = active?.orgName ?? "Minted Panel";

  return (
    <div className="flex h-dvh w-full bg-background overflow-hidden font-sans text-foreground">
      {/* Desktop sidebar */}
      <div className="hidden md:block h-full">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      <div
        className={`fixed inset-0 z-50 md:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!drawerOpen}
      >
        <div
          className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
            drawerOpen ? "opacity-100" : "opacity-0"
          }`}
          onClick={closeDrawer}
        />
        <div
          className={`absolute inset-y-0 left-0 w-[280px] max-w-[85vw] transition-transform duration-200 ease-out ${
            drawerOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar onNavigate={closeDrawer} />
          <button
            type="button"
            aria-label="Close navigation"
            onClick={closeDrawer}
            className="absolute top-3 right-3 w-8 h-8 rounded-[var(--mp-radius-sm)] flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Mobile header: hamburger opens the drawer (org switcher + journey),
            the active org stays visible, and the icon returns to Portfolio. */}
        <header className="md:hidden h-14 flex items-center gap-3 px-4 border-b border-border bg-card flex-shrink-0">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            className="w-9 h-9 -ml-2 rounded-[var(--mp-radius-sm)] flex items-center justify-center text-foreground hover:bg-muted transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="flex-1 truncate font-semibold text-[15px] tracking-tight text-foreground">
            {activeOrgName}
          </span>
          <Link
            to="/reporting"
            aria-label="Open Reporting Center"
            className="w-9 h-9 -mr-2 rounded-[var(--mp-radius-sm)] flex items-center justify-center text-foreground hover:bg-muted transition-colors"
          >
            <BarChart3 className="w-5 h-5" />
          </Link>
        </header>

        <main className="flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  );
}
