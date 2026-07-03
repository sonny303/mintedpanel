// M1 app shell: fixed dark sidebar on desktop, hamburger slide-in drawer on
// mobile (translateX pattern, overlay dismiss, X to close). Route pages render
// unmodified in the content area. TopBar is retired from the layout but its
// file stays until M6 cleanup.
import React, { useState } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import logoAsset from "@/assets/minted-mark.png.asset.json";

interface AppShellProps {
  children: React.ReactNode;
  topBarContent?: React.ReactNode;
}

export function AppShell({ children, topBarContent }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = () => setDrawerOpen(false);

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
        {/* Mobile header */}
        <header className="md:hidden h-14 flex items-center gap-3 px-4 border-b border-border bg-card flex-shrink-0">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setDrawerOpen(true)}
            className="w-9 h-9 -ml-2 rounded-[var(--mp-radius-sm)] flex items-center justify-center text-foreground hover:bg-muted transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 font-semibold text-[15px] tracking-tight">
            <div className="w-6 h-6 rounded bg-mp-primary flex items-center justify-center">
              <img
                src={logoAsset.url}
                alt=""
                className="w-4 h-4 object-contain brightness-0 invert"
              />
            </div>
            Minted Panel
          </div>
        </header>

        {topBarContent ? (
          <div className="hidden md:flex h-14 items-center justify-end px-6 border-b border-border bg-card flex-shrink-0">
            {topBarContent}
          </div>
        ) : null}

        <main className="flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  );
}
