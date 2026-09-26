import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import { StatusPill, type StatusColor } from "@/components/StatusPill";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { evaluateBillingReadiness, type BillingSelection } from "@/lib/billingReadiness";
import { fmtDate } from "@/lib/format";
import { taxonomyLabel } from "@/lib/providerTaxonomy";
import type { BillingReadinessQueryData } from "@/hooks/useBillingReadiness";

const STATUS_TONE: Record<"ready" | "hold" | "stop", StatusColor> = {
  ready: "green",
  hold: "amber",
  stop: "red",
};

function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

function providerIdentifier(npi: string | null, id: string): string {
  return npi ? `NPI ${npi}` : `Provider ID ${id}`;
}

function facilityIdentity(
  facility: { name: string; state: string | null; groupId: string | null },
  groups: { id: string; name: string }[],
): string {
  const groupName = groups.find((group) => group.id === facility.groupId)?.name;
  return `${facility.name} · ${facility.state ?? "State not recorded"} · ${groupName ?? "Group not recorded"}`;
}

export function BillingClearanceLookup({ data }: { data: BillingReadinessQueryData | undefined }) {
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<BillingSelection>({
    providerId: "",
    facilityId: "",
    payerId: "",
  });

  const providers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.snapshot.providers ?? [])
      .filter((provider) =>
        fullName(provider.firstName, provider.lastName).toLowerCase().includes(query),
      )
      .sort((a, b) =>
        fullName(a.firstName, a.lastName).localeCompare(fullName(b.firstName, b.lastName)),
      );
  }, [data?.snapshot.providers, search]);

  const facilities = useMemo(
    () => [...(data?.snapshot.facilities ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data?.snapshot.facilities],
  );
  const payers = useMemo(
    () => [...(data?.snapshot.payers ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data?.snapshot.payers],
  );
  const assessment = useMemo(
    () => (data ? evaluateBillingReadiness(data.snapshot, selection, data.asOf) : null),
    [data, selection],
  );

  return (
    <div className="space-y-4 pt-3">
      <div className="grid gap-3 rounded-md border border-border p-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5">
          <label
            htmlFor="billing-clinician-search"
            className="text-[12px] font-medium text-foreground"
          >
            Search clinicians
          </label>
          <Input
            id="billing-clinician-search"
            aria-label="Search clinicians"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={!data}
            className="h-9 text-[13px]"
          />
        </div>
        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-foreground">Clinician</span>
          <Select
            value={selection.providerId}
            onValueChange={(providerId) => setSelection((current) => ({ ...current, providerId }))}
            disabled={!data}
          >
            <SelectTrigger aria-label="Clinician" className="h-9 text-[13px]">
              <SelectValue placeholder="Select clinician" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {fullName(provider.firstName, provider.lastName)} ·{" "}
                  {providerIdentifier(provider.npi, provider.id)}
                </SelectItem>
              ))}
              {providers.length === 0 ? (
                <SelectItem value="no-match" disabled>
                  No matching clinicians.
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-foreground">Facility</span>
          <Select
            value={selection.facilityId}
            onValueChange={(facilityId) => setSelection((current) => ({ ...current, facilityId }))}
            disabled={!data}
          >
            <SelectTrigger aria-label="Facility" className="h-9 text-[13px]">
              <SelectValue placeholder="Select facility" />
            </SelectTrigger>
            <SelectContent>
              {facilities.map((facility) => (
                <SelectItem key={facility.id} value={facility.id}>
                  {facilityIdentity(facility, data?.snapshot.groups ?? [])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <span className="text-[12px] font-medium text-foreground">Payer</span>
          <Select
            value={selection.payerId}
            onValueChange={(payerId) => setSelection((current) => ({ ...current, payerId }))}
            disabled={!data}
          >
            <SelectTrigger aria-label="Payer" className="h-9 text-[13px]">
              <SelectValue placeholder="Select payer" />
            </SelectTrigger>
            <SelectContent>
              {payers.map((payer) => (
                <SelectItem key={payer.id} value={payer.id}>
                  {payer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!data ? (
        <EmptyState
          message="A current readiness assessment is unavailable."
          description="Select an organization or retry after its source records load."
        />
      ) : !selection.providerId || !selection.facilityId || !selection.payerId ? (
        <EmptyState message="Choose a clinician, facility, and payer to assess the exact enrollment match." />
      ) : !assessment ? (
        <EmptyState message="This combination cannot be assessed from the available organization records." />
      ) : (
        <Card className="rounded-md border-border shadow-none">
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-foreground">Current readiness</h2>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {assessment.provider.firstName} {assessment.provider.lastName} ·{" "}
                  {providerIdentifier(assessment.provider.npi, assessment.provider.id)} ·{" "}
                  {facilityIdentity(assessment.facility, data.snapshot.groups)} ·{" "}
                  {assessment.payer.name}
                </p>
              </div>
              <div data-testid="billing-assessment-status">
                <StatusPill status={STATUS_TONE[assessment.status]} label={assessment.label} />
              </div>
            </div>

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
              <div>
                <dt className="text-muted-foreground">Assessment date</dt>
                <dd className="mt-0.5 font-medium text-foreground">{fmtDate(data.asOf)}</dd>
              </div>
            </dl>

            {assessment.isPta ? (
              <div className="rounded-md border border-border bg-background p-3 text-[12.5px] text-foreground">
                <p className="font-medium text-[var(--mp-warn-ink)]">
                  CQ modifier guidance: PTA supervision is unverified.
                </p>
                <p className="mt-1">
                  Same-facility PT clinicians are candidates only. Confirm supervision, payer, and
                  service rules before billing.
                </p>
                {assessment.supervisorCandidates.length > 0 ? (
                  <p className="mt-1">
                    PT candidates:{" "}
                    {assessment.supervisorCandidates.map((candidate) => candidate.name).join(", ")}.
                  </p>
                ) : null}
              </div>
            ) : null}
            {assessment.isOta ? (
              <div className="rounded-md border border-border bg-background p-3 text-[12.5px] text-foreground">
                <p className="font-medium text-[var(--mp-warn-ink)]">
                  CO modifier guidance: OTA supervision is unverified.
                </p>
                <p className="mt-1">
                  Confirm supervision, payer, and service rules before billing.
                </p>
              </div>
            ) : null}

            {assessment.reasons.length > 0 ? (
              <div>
                <h3 className="mb-2 text-[12.5px] font-semibold text-foreground">
                  {assessment.status === "ready" ? "Readiness evidence" : "Why billing is held"}
                </h3>
                <ul className="space-y-1.5">
                  {assessment.reasons.map((reason) => (
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
              Billable Ready reflects recorded prerequisites as of the assessment date. Confirm
              applicable payer, service, timely-filing, and retro rules for each claim.
              {assessment.provider.taxonomyCode
                ? ` Clinician taxonomy: ${taxonomyLabel(assessment.provider.taxonomyCode) ?? assessment.provider.taxonomyCode}.`
                : ""}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
