// Public read-only portfolio share (redesign E0.6, F0.6.5 / TE-6). The app's
// SECOND public unauthenticated surface (after E0.5's capture link), but
// READ-ONLY — no write RPC. Rendered outside the app shell by __root. A SECURITY
// DEFINER RPC hash-validates the token and returns ONLY the in-scope orgs (the
// full/single-org filter is enforced server-side); this view renders the
// chrome-decoupled PortfolioContent with that data, read-only, no workspace nav.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PortfolioContent } from "@/components/portfolio/PortfolioContent";
import { validateReportShare } from "@/services/reportShares";

export const Route = createFileRoute("/share/$token")({
  component: SharePage,
});

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1B4D3E] text-white">
            <BarChart3 className="h-4 w-4" />
          </div>
          <span className="text-[15px] font-semibold text-foreground">Minted Panel</span>
        </div>
        {children}
      </div>
    </div>
  );
}

function Lockdown({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Clock className="h-5 w-5" />
        </div>
        <div className="text-[16px] font-semibold text-foreground">{title}</div>
        <p className="max-w-sm text-[13px] text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function SharePage() {
  const { token } = Route.useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["report-share", token],
    queryFn: () => validateReportShare(token),
    retry: false,
    staleTime: 0,
  });

  if (isLoading) {
    return (
      <Shell>
        <div className="text-[13px] text-muted-foreground">Loading…</div>
      </Shell>
    );
  }

  if (isError || !data || data.state !== "active" || !data.orgs) {
    return (
      <Shell>
        <Lockdown
          title={
            data?.state === "expired"
              ? "This link has expired"
              : "This link is no longer valid"
          }
          message="This shared report is no longer available. Contact the person who shared it for a new link."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-4">
        <h1 className="text-[20px] font-semibold text-foreground">Portfolio</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          A read-only view shared with you. {data.scope === "single_org" ? "One organization." : ""}
        </p>
      </div>
      {/* Server already scope-filtered `orgs`; render read-only, no workspace nav. */}
      <PortfolioContent orgs={data.orgs} readOnly />
    </Shell>
  );
}
