// Demo mount for the cross-org provider lookup prototype (spike PoC).
//
// A dev route rather than a shell wiring: src/components/layout/* is protected,
// and the spike's job is to prove the interaction, not to ship a new shell
// affordance. Behind the same env flag idiom as /dev/primitives — visible in
// dev, or when VITE_DEV_GLOBAL_SEARCH=1 is set on a preview.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { GlobalProviderSearchDialog } from "@/components/search/GlobalProviderSearchDialog";
import { useAuthStore } from "@/lib/auth-store";

const enabled = import.meta.env.DEV || import.meta.env.VITE_DEV_GLOBAL_SEARCH === "1";

export const Route = createFileRoute("/dev/global-search")({
  beforeLoad: () => {
    if (!enabled) throw notFound();
  },
  component: GlobalSearchDemoPage,
});

function GlobalSearchDemoPage() {
  const [open, setOpen] = useState(false);
  const memberships = useAuthStore((s) => s.memberships);
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const session = useAuthStore((s) => s.session);

  const activeOrgName =
    memberships.find((m) => m.orgId === activeOrgId)?.orgName ?? "no active organization";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Global provider search"
        description="Spike prototype: find a provider by name or NPI across every organization you belong to. Shift+Space, or the footprint icon, loads that NPI's groups, facilities, and licenses without switching org."
      />

      <section className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-4">
        {!session ? (
          <p className="text-[13px] text-[color:var(--mp-ink-faint)]">
            Sign in first — the lookup searches your own memberships, so it returns nothing without
            a session.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[13px] text-[color:var(--mp-ink-faint)]">
              Active organization is <span className="text-foreground">{activeOrgName}</span>. The
              lookup spans all {memberships.length} of your memberships. Opening a result switches
              organization. The footprint inspector does not.
            </p>
            <Button onClick={() => setOpen(true)}>Open lookup</Button>
          </div>
        )}
      </section>

      <GlobalProviderSearchDialog open={open} onOpenChange={setOpen} enableDossier />
    </div>
  );
}
