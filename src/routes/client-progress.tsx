// Client Progress v1: read-only owner view at /client-progress. One card per
// provider in the active org; every status string maps through the locked
// owner-safe wording set in src/lib/clientProgress.ts — no internal jargon.
// Visible to admin and billing roles; zero mutations on this page.
import { useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { ProviderProgressCard } from "@/components/client-progress/ProviderProgressCard";
import { useClientProgressProviders } from "@/hooks/useClientProgress";
import { useCases } from "@/hooks/useCases";
import { usePayers, useStatusConfigs } from "@/hooks/useAdmin";
import { useRole } from "@/lib/auth-store";
import { buildClientProgress } from "@/lib/clientProgress";

export const Route = createFileRoute("/client-progress")({
  component: ClientProgressPage,
});

function ClientProgressPage() {
  const role = useRole();
  const providersQ = useClientProgressProviders();
  const casesQ = useCases();
  const payersQ = usePayers();
  const statusConfigsQ = useStatusConfigs("credentialing");

  const loading =
    providersQ.isLoading || casesQ.isLoading || payersQ.isLoading || statusConfigsQ.isLoading;
  const failed = providersQ.isError || casesQ.isError || payersQ.isError || statusConfigsQ.isError;

  const cards = useMemo(
    () =>
      buildClientProgress(
        providersQ.data ?? [],
        casesQ.data ?? [],
        payersQ.data ?? [],
        statusConfigsQ.data ?? [],
      ),
    [providersQ.data, casesQ.data, payersQ.data, statusConfigsQ.data],
  );

  if (role !== "admin" && role !== "billing") {
    return (
      <div className="max-w-3xl mx-auto">
        <PageHeader title="Client Progress" />
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6">
          <EmptyState
            message="Client Progress is available to admin and billing users."
            description="Ask an admin if you need access to this view."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Client Progress"
        description="Where each provider stands with every insurer."
      />
      {failed ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6 text-center text-[length:var(--mp-text-sm)] text-[color:var(--mp-danger)]">
          Couldn't load client progress. Refresh to retry.
        </div>
      ) : loading ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 rounded-[var(--mp-radius-lg)] bg-mp-muted animate-pulse" />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-[var(--mp-radius-lg)] border border-mp-border bg-mp-card p-6">
          <EmptyState
            message="No providers yet"
            description="Providers appear here as soon as they're added."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <ProviderProgressCard key={card.provider.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
