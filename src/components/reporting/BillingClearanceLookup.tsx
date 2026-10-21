// Billing clearance lookup (Oct 20 review, RC-04): one search box for a
// clinician's name, NPI, state code, or location, then that clinician's
// readiness payer by payer. Selecting a payer row opens the full assessment.
import { useDeferredValue, useMemo, useState } from "react";
import { AlertCircle, ChevronLeft } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { ReadinessPill } from "@/components/reporting/ReadinessPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  providerPayerStatuses,
  searchBillingProviders,
  type BillingAssessment,
  type BillingPayerStatusRow,
  type BillingReadinessStatus,
} from "@/lib/billingReadiness";
import { fmtDate } from "@/lib/format";
import { taxonomyLabel } from "@/lib/providerTaxonomy";
import type { BillingReadinessQueryData } from "@/hooks/useBillingReadiness";

const STATUS_ORDER: BillingReadinessStatus[] = ["ready", "hold", "stop"];
const STATUS_SUMMARY: Record<BillingReadinessStatus, string> = {
  ready: "Billable Ready",
  hold: "Hold",
  stop: "Do Not Bill",
};

function providerIdentifier(npi: string | null, id: string): string {
  return npi ? `NPI ${npi}` : `Provider ID ${id}`;
}

function effectiveDateText(row: BillingPayerStatusRow): string {
  if (row.confirmedEffectiveDate) return fmtDate(row.confirmedEffectiveDate);
  if (row.expectedEffectiveDate) return `Expected ${fmtDate(row.expectedEffectiveDate)}`;
  return "Not recorded";
}

function AssessmentDetail({ row, asOf }: { row: BillingPayerStatusRow; asOf: string }) {
  const assessment: BillingAssessment | null = row.assessment;
  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13.5px] font-semibold text-foreground">
            {row.payer.name} · {row.facility?.name ?? "No linked location"}
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">Assessed {fmtDate(asOf)}</p>
        </div>
        <div data-testid="billing-assessment-status">
          <ReadinessPill status={row.status} label={row.label} reasons={[]} />
        </div>
      </div>

      {assessment ? (
        <dl className="grid gap-x-6 gap-y-3 border-y border-border py-3 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Group</dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {assessment.group?.name ?? "Not recorded"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Enrollment state</dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {assessment.state ?? "Not recorded"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Recorded confirmed effective date</dt>
            <dd className="mt-0.5 font-medium text-foreground">
              {assessment.confirmedEffectiveDate
                ? fmtDate(assessment.confirmedEffectiveDate)
                : "Not recorded"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Retro eligibility</dt>
            <dd className="mt-0.5 font-medium text-foreground">Not recorded</dd>
          </div>
          {assessment.expectedEffectiveDate ? (
            <div>
              <dt className="text-muted-foreground">Expected effective date</dt>
              <dd className="mt-0.5 font-medium text-foreground">
                {fmtDate(assessment.expectedEffectiveDate)}
              </dd>
            </div>
          ) : null}
          {assessment.estimatedDecisionDate ? (
            <div>
              <dt className="text-muted-foreground">Estimated decision date</dt>
              <dd className="mt-0.5 font-medium text-foreground">
                {fmtDate(assessment.estimatedDecisionDate)} · estimate
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {assessment?.isPta ? (
        <div className="rounded-md border border-border bg-background p-3 text-[12.5px] text-foreground">
          <p className="font-medium text-[var(--mp-warn-ink)]">
            CQ modifier guidance: PTA supervision is unverified.
          </p>
          <p className="mt-1">
            Same-facility PT clinicians are candidates only. Confirm supervision, payer, and service
            rules before billing.
          </p>
          {assessment.supervisorCandidates.length > 0 ? (
            <p className="mt-1">
              PT candidates:{" "}
              {assessment.supervisorCandidates.map((candidate) => candidate.name).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}
      {assessment?.isOta ? (
        <div className="rounded-md border border-border bg-background p-3 text-[12.5px] text-foreground">
          <p className="font-medium text-[var(--mp-warn-ink)]">
            CO modifier guidance: OTA supervision is unverified.
          </p>
          <p className="mt-1">Confirm supervision, payer, and service rules before billing.</p>
        </div>
      ) : null}

      {row.reasons.length > 0 ? (
        <div>
          <h4 className="mb-2 text-[12.5px] font-semibold text-foreground">Why billing is held</h4>
          <ul className="space-y-1.5">
            {row.reasons.map((reason) => (
              <li
                key={`${reason.severity}:${reason.label}`}
                className="flex items-start gap-2 text-[12.5px] text-foreground"
              >
                <AlertCircle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span>{reason.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-[11.5px] text-muted-foreground">
        Billable Ready reflects recorded prerequisites as of the assessment date. Confirm applicable
        payer, service, timely-filing, and retro rules for each claim.
        {assessment?.provider.taxonomyCode
          ? ` Clinician taxonomy: ${taxonomyLabel(assessment.provider.taxonomyCode) ?? assessment.provider.taxonomyCode}.`
          : ""}
      </p>
    </div>
  );
}

function ProviderPayerStatus({
  data,
  providerId,
  onBack,
}: {
  data: BillingReadinessQueryData;
  providerId: string;
  onBack: () => void;
}) {
  const [openKey, setOpenKey] = useState("");
  const provider = data.snapshot.providers.find((row) => row.id === providerId);
  const rows = useMemo(
    () => providerPayerStatuses(data.snapshot, providerId, data.asOf),
    [data, providerId],
  );
  const open = rows.find((row) => row.key === openKey) ?? null;
  if (!provider) {
    return <EmptyState message="This clinician is no longer in the organization's records." />;
  }
  const counts = STATUS_ORDER.map((status) => ({
    status,
    count: rows.filter((row) => row.status === status).length,
  })).filter((entry) => entry.count > 0);

  return (
    <Card className="rounded-md border-border shadow-none">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">
              {provider.firstName} {provider.lastName}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {providerIdentifier(provider.npi, provider.id)}
              {counts.length > 0
                ? ` · ${counts.map((entry) => `${entry.count} ${STATUS_SUMMARY[entry.status]}`).join(" · ")}`
                : ""}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to results
          </Button>
        </div>

        {rows.length === 0 ? (
          <EmptyState message="No enrollment cases are recorded for this clinician." />
        ) : (
          <TooltipProvider delayDuration={150}>
            <div className="overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payer</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Billing status</TableHead>
                    <TableHead>Effective date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.key}
                      data-state={row.key === openKey ? "selected" : undefined}
                    >
                      <TableCell className="text-[12.5px] font-medium">
                        <button
                          type="button"
                          aria-expanded={row.key === openKey}
                          aria-label={`${row.payer.name} at ${row.facility?.name ?? "no linked location"}: details`}
                          onClick={() => setOpenKey(row.key === openKey ? "" : row.key)}
                          className="text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        >
                          {row.payer.name}
                        </button>
                      </TableCell>
                      <TableCell className="text-[12.5px]">
                        {row.facility?.name ?? "No linked location"}
                      </TableCell>
                      <TableCell className="text-[12.5px]">{row.state ?? "Not recorded"}</TableCell>
                      <TableCell>
                        <ReadinessPill
                          status={row.status}
                          label={row.label}
                          reasons={row.reasons}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[12.5px]">
                        {effectiveDateText(row)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TooltipProvider>
        )}

        {open ? <AssessmentDetail row={open} asOf={data.asOf} /> : null}
      </CardContent>
    </Card>
  );
}

export function BillingClearanceLookup({ data }: { data: BillingReadinessQueryData | undefined }) {
  const [query, setQuery] = useState("");
  const [providerId, setProviderId] = useState("");
  const deferredQuery = useDeferredValue(query);
  const search = useMemo(
    () =>
      data
        ? searchBillingProviders(data.snapshot, deferredQuery, data.asOf)
        : { matches: [], total: 0 },
    [data, deferredQuery],
  );

  return (
    <div className="space-y-4 pt-3">
      <div className="space-y-1.5 rounded-md border border-border p-4">
        <label htmlFor="billing-lookup-search" className="text-[12px] font-medium text-foreground">
          Find a clinician
        </label>
        <Input
          id="billing-lookup-search"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setProviderId("");
          }}
          disabled={!data}
          className="h-9 max-w-xl text-[13px]"
        />
        <p className="text-[11.5px] text-muted-foreground">
          Search by name, NPI, state code (for example, NC), or location.
        </p>
      </div>

      {!data ? (
        <EmptyState
          message="A current readiness assessment is unavailable."
          description="Select an organization or retry after its source records load."
        />
      ) : providerId ? (
        <ProviderPayerStatus
          key={providerId}
          data={data}
          providerId={providerId}
          onBack={() => setProviderId("")}
        />
      ) : !query.trim() ? (
        <EmptyState message="Search for a clinician to see billing status for every payer." />
      ) : search.total === 0 ? (
        <EmptyState message="No clinicians match this search." />
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-muted-foreground" aria-live="polite">
            {search.total > search.matches.length
              ? `Showing ${search.matches.length} of ${search.total.toLocaleString()} matches. Add more detail to narrow the list.`
              : search.total === 1
                ? "1 match"
                : `${search.total} matches`}
          </p>
          <ul
            className="overflow-hidden rounded-md border border-border"
            aria-label="Matching clinicians"
          >
            {search.matches.map((match, i) => (
              <li key={match.provider.id} className={i > 0 ? "border-t border-border" : ""}>
                <button
                  type="button"
                  onClick={() => setProviderId(match.provider.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {match.name}
                    </span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {providerIdentifier(match.provider.npi, match.provider.id)}
                      {match.groupNames.length > 0 ? ` · ${match.groupNames.join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {match.states.length > 0 ? match.states.join(", ") : "No state recorded"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
