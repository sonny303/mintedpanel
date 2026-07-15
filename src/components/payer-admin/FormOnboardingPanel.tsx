// E4.2 F4.2.7 — form onboarding & test runner. For a payer whose SOP has
// extension_fill tasks: capture (open the portal so the extension proposes field
// maps) → train (the existing /portals/$key/train deck) → dry-run fill against
// the designated test provider (per-field filled / skipped-unmapped /
// empty-token, nothing submitted) → fix & re-run. The test provider is an
// ordinary providers row (isTestProvider), excluded from every work surface. The
// dry run records a marked (is_test) fill session excluded from all metrics.
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { usePayers } from "@/hooks/useAdmin";
import { useProvider, useProviders } from "@/hooks/useProviders";
import { usePortals, usePortalFieldMaps } from "@/hooks/usePortals";
import { useRecordTestFill, useTestFills } from "@/hooks/useFormOnboarding";
import {
  computeTestRun,
  resolveTestProviderTokens,
  summarizeTestFill,
  type DryRunFieldMap,
} from "@/lib/testRunResults";
import type { Portal, Provider } from "@/types";

function PortalTestRun({ portal, provider }: { portal: Portal; provider: Provider }) {
  const fieldMapsQ = usePortalFieldMaps(portal.portalKey);
  const testFillsQ = useTestFills(portal.portalKey);
  const record = useRecordTestFill();

  const run = () => {
    const maps: DryRunFieldMap[] = (fieldMapsQ.data ?? []).map((m) => ({
      selector: m.selector,
      token: m.token,
      fieldLabel: m.fieldLabel,
      status: m.status,
    }));
    const tokens = resolveTestProviderTokens(provider);
    const result = computeTestRun(maps, tokens);
    record.mutate(
      {
        providerId: provider.id,
        portalKey: portal.portalKey,
        fieldsFilled: result.fieldsFilled,
        fieldsSkipped: result.fieldsSkipped,
      },
      {
        onSuccess: () => toast.success("Dry run recorded — nothing was submitted."),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not run the dry fill."),
      },
    );
  };

  const latest = testFillsQ.data?.[0];
  const summary = latest ? summarizeTestFill(latest.fieldsFilled, latest.fieldsSkipped) : null;

  return (
    <div className="rounded-md border border-[#E8E5E0] bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">{portal.name}</span>
        {portal.formUrl ? (
          <a
            href={portal.formUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[12px] text-[#1B4D3E] underline underline-offset-2"
          >
            Open portal (capture mode) <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
        <Link
          to="/portals/$portalKey/train"
          params={{ portalKey: portal.portalKey }}
          className="text-[12px] text-[#1B4D3E] underline underline-offset-2"
        >
          Train fields
        </Link>
        <Button
          size="sm"
          className="ml-auto h-7 bg-[#1B4D3E] text-white hover:bg-[#163F33]"
          disabled={record.isPending || fieldMapsQ.data === undefined}
          onClick={run}
        >
          {record.isPending ? "Running…" : "Run dry fill"}
        </Button>
      </div>

      {summary ? (
        <div className="space-y-2 text-[13px]">
          <p className="text-muted-foreground">
            Last run: <span className="font-medium text-[#166534]">{summary.filled} filled</span> ·{" "}
            <span className="font-medium text-[#B45309]">{summary.unmapped.length} unmapped</span> ·{" "}
            <span className="font-medium text-[#B45309]">
              {summary.emptyToken.length} empty token
            </span>
          </p>
          {summary.unmapped.length > 0 ? (
            <div>
              <p className="text-[12px] font-medium">Unmapped — needs training:</p>
              <ul className="mt-1 space-y-0.5">
                {summary.unmapped.map((f) => (
                  <li key={f.selector} className="text-[12px] text-muted-foreground">
                    {f.label}{" "}
                    <Link
                      to="/portals/$portalKey/train"
                      params={{ portalKey: portal.portalKey }}
                      className="text-[#1B4D3E] underline underline-offset-2"
                    >
                      train
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {summary.emptyToken.length > 0 ? (
            <div>
              <p className="text-[12px] font-medium">Empty token — needs profile data:</p>
              <ul className="mt-1 space-y-0.5">
                {summary.emptyToken.map((f) => (
                  <li key={f.selector} className="text-[12px] text-muted-foreground">
                    {f.label}{" "}
                    <Link
                      to="/providers/$id"
                      params={{ id: provider.id }}
                      className="text-[#1B4D3E] underline underline-offset-2"
                    >
                      edit profile
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          No test run yet. Train the fields, then run a dry fill against the test provider.
        </p>
      )}
    </div>
  );
}

export function FormOnboardingPanel({ payerId }: { payerId: string }) {
  const payersQ = usePayers();
  const portalsQ = usePortals();
  const providersQ = useProviders();

  const testProviderRow = (providersQ.data ?? []).find((p) => p.isTestProvider);
  const fullTestProviderQ = useProvider(testProviderRow?.id);

  if (!payersQ.data || !portalsQ.data || !providersQ.data) {
    return <Skeleton className="h-40 w-full" />;
  }

  const payer = payersQ.data.find((p) => p.id === payerId) ?? null;
  const portals = portalsQ.data.filter((p) => p.payerId === payerId);

  if (!testProviderRow) {
    return (
      <EmptyState message="Designate a test provider first (an ordinary provider marked as the test provider) to run dry fills." />
    );
  }
  if (portals.length === 0) {
    return (
      <EmptyState
        message={`No portals registered for ${payer?.name ?? "this payer"}. Register the payer's portal in Admin > Portals to onboard its form.`}
      />
    );
  }
  const testProvider = fullTestProviderQ.data;
  if (!testProvider) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">
        Onboarding forms for <span className="font-medium">{payer?.name}</span> using test provider{" "}
        <span className="font-medium">
          {testProvider.firstName} {testProvider.lastName}
        </span>
        . Nothing is ever submitted to the payer.
      </p>
      {portals.map((portal) => (
        <PortalTestRun key={portal.id} portal={portal} provider={testProvider} />
      ))}
    </div>
  );
}
