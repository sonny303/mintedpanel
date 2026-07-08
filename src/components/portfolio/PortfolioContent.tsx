// Portfolio content (redesign E0.0, enabler TE-3 / feature F0.0.5).
//
// CHROME-DECOUPLED: this component and its subtree import NOTHING from
// src/components/layout/* — it takes its data from its own hook (usePortfolio)
// and composes only src/components/ui/* primitives, so the later standalone
// no-nav shareable Portfolio surface (out of scope here) can mount it directly.
// The workspace route (routes/portfolio.tsx) is what wraps it in the shell +
// PageHeader.
//
// It surfaces the two business metrics — "In motion" and "Prospects" — and
// excludes inactive/archived orgs from both (via the pure splitPortfolio). The
// internal lifecycle words are never shown as a status label (F0.0.2).
import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Building2, Plus, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthStore } from "@/lib/auth-store";
import { usePortfolio } from "@/hooks/usePortfolio";
import { splitPortfolio } from "@/lib/portfolio";
import type { PortfolioOrg } from "@/types";
import { CreateOrganizationModal } from "@/components/org/CreateOrganizationModal";

// The org-scoped journey opens at its first nav slot (F0.0.1, "Get started").
const WORKSPACE_ENTRY = "/get-started" as const;

function StatTile({
  icon: Icon,
  label,
  count,
}: {
  icon: typeof TrendingUp;
  label: string;
  count: number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[24px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {count}
          </div>
          <div className="mt-1 text-[13px] text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function OrgRow({ org, onOpen }: { org: PortfolioOrg; onOpen: (org: PortfolioOrg) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(org)}
      aria-label={`Open ${org.name}`}
      className="flex w-full items-center gap-3 rounded-md border border-[#E8E5E0] bg-card px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Building2 className="h-4 w-4" />
      </div>
      <span className="truncate text-[14px] font-medium text-foreground">{org.name}</span>
    </button>
  );
}

function OrgSection({
  title,
  orgs,
  onOpen,
}: {
  title: string;
  orgs: PortfolioOrg[];
  onOpen: (org: PortfolioOrg) => void;
}) {
  if (orgs.length === 0) return null;
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {orgs.map((org) => (
          <OrgRow key={org.id} org={org} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

export function PortfolioContent() {
  const navigate = useNavigate();
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  const { data, isLoading, isError } = usePortfolio();
  const [creating, setCreating] = useState(false);

  const buckets = useMemo(() => splitPortfolio(data ?? []), [data]);

  const openOrg = (org: PortfolioOrg) => {
    setActiveOrg(org.id);
    navigate({ to: WORKSPACE_ENTRY });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
          <Skeleton className="h-[74px] rounded-md" />
          <Skeleton className="h-[74px] rounded-md" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Skeleton className="h-[58px] rounded-md" />
          <Skeleton className="h-[58px] rounded-md" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#B91C1C]">
        We couldn't load your portfolio. Check your connection and try again.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
        <StatTile icon={TrendingUp} label="In motion" count={buckets.inMotionCount} />
        <StatTile icon={Sparkles} label="Prospects" count={buckets.prospectCount} />
      </div>

      {buckets.isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[15px] font-semibold text-foreground">No organizations yet</div>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Create your first organization to start tracking credentialing work.
              </p>
            </div>
            <Button
              onClick={() => setCreating(true)}
              className="bg-[#1B4D3E] hover:bg-[#163E32] text-white"
            >
              <Plus className="h-4 w-4" />
              Create organization
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          <OrgSection title="In motion" orgs={buckets.inMotion} onOpen={openOrg} />
          <OrgSection title="Prospects" orgs={buckets.prospects} onOpen={openOrg} />
        </div>
      )}

      {creating ? <CreateOrganizationModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
