
// 2026-10-20 — Provider Onboarding report card. First card under Reporting >
// Intake. Owner + coordinator only. Mirrors the Enrollment Explorer card shape.
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { useProviderOnboardingReport } from "@/hooks/useProviderOnboardingReport";
import { useActiveOrg } from "@/lib/auth-store";

export const Route = createFileRoute("/reporting/provider-onboarding")({
  component: ProviderOnboardingReportPage,
});

function ProviderOnboardingReportPage() {
  const orgId = useActiveOrg()?.id;
  const { data, isLoading, isError } = useProviderOnboardingReport(orgId);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Provider credentialing onboarding"
        subtitle="Whose waiting on whom, and how Minted's 2-business-day target is doing."
      />
      {isLoading ? <p className="text-[13px] text-muted-foreground">Loading…</p> : null}
      {isError ? <p className="text-[13px] text-[#B91C1C]">Couldn't load the report.</p> : null}
      {data ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>In onboarding now</CardTitle>
            </CardHeader>
            <CardContent className="text-[13px]">
              {data.hires.length === 0 ? (
                <p className="text-muted-foreground">No providers are in onboarding right now.</p>
              ) : (
                <ul className="space-y-1">
                  {data.hires.map((h) => (
                    <li key={h.provider_id} className="flex items-center justify-between">
                      <span>{h.provider_id.slice(0, 8)}…</span>
                      <span className="text-muted-foreground">{h.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Needs a human</CardTitle>
            </CardHeader>
            <CardContent className="text-[13px]">
              {data.needs_a_human.length === 0 ? (
                <p className="text-muted-foreground">Nothing blocked on a person.</p>
              ) : (
                <ul className="space-y-1">
                  {data.needs_a_human.map((n) => (
                    <li key={`${n.provider_id}-${n.opened_at}`} className="flex items-center justify-between">
                      <span>{n.reason}</span>
                      <span className="text-muted-foreground">{n.provider_id.slice(0, 8)}…</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Target: 2 business days</CardTitle>
            </CardHeader>
            <CardContent className="text-[13px]">
              <p>
                Current median:{" "}
                <strong>
                  {data.current_median_business_days ?? "—"} {data.current_median_business_days != null ? "business days" : ""}
                </strong>
              </p>
              <p className="text-[12px] text-muted-foreground">
                Measured from onboarding.admitted to first payer application submitted. Measured only — never shown in product.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Provider pace (measured only)</CardTitle>
            </CardHeader>
            <CardContent className="text-[13px]">
              <p>Invitation → first sign-in p50: <strong>{data.provider_pace_measured_only.invitation_to_first_signin_p50_hours ?? "—"} hours</strong></p>
              <p>Invitation → submit p50: <strong>{data.provider_pace_measured_only.invitation_to_submit_p50_hours ?? "—"} hours</strong></p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
