// Slice E (payer-and-cases screen 6) — the case's right-column Details card:
// ONE card, three labeled groups.
//   Case         — the dates the case carries, days open, coordinator, group,
//                  the facility WITH its full address, forwarding ID.
//   Identifiers  — provider/group identifiers, each copyable, plus the
//                  payer-issued IDs an approval captured. A payer that expects
//                  an ID whose approval acked it missing reads "Awaiting ID"
//                  (Slice D's derivation, reused verbatim — never re-derived).
//   Provenance   — the E2.4 origin + SOP version lines + reapply cycles
//                  (CaseProvenancePanel composed, never re-implemented).
// Read-only throughout; every value comes from the already-loaded case detail.
import { differenceInDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "@/components/CopyButton";
import { StatusPill } from "@/components/StatusPill";
import { CaseProvenancePanel } from "@/components/generation/CaseProvenancePanel";
import { facilityAddressLine } from "@/lib/caseDetailView";
import { fmtDate } from "@/lib/format";
import { enrollmentIdBadge } from "@/lib/payerIssuedIds";
import { resolveGroupIdentifierConfig } from "@/lib/payerResolutionIdentifier";
import type { CaseDetail, Task } from "@/types";

const GROUP_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function CaseDetailsPanel({
  c,
  tasks,
  coordinatorName,
}: {
  c: CaseDetail;
  tasks: Task[];
  coordinatorName: string;
}) {
  const daysOpen = c.submittedDate ? differenceInDays(new Date(), parseISO(c.submittedDate)) : null;
  const facilityAddress = facilityAddressLine(c.facility);
  const approved = c.caseStatus === "approved";
  // The provider-side badge is Slice D's shared derivation; the group side
  // mirrors it against the payer's own group-ID expectation.
  const providerIdBadge = approved ? enrollmentIdBadge(c.payer, c.payerIndividualProviderId) : null;
  const groupConfig = resolveGroupIdentifierConfig(c.payer);
  const groupIdValue = (c.payerGroupProviderId ?? "").trim();

  return (
    <Card role="region" aria-label="Details" className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border">
        <CardTitle className="text-[14px] font-semibold">Details</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <p className={GROUP_LABEL}>Case</p>
        <dl className="mt-2 space-y-3 text-[13px]">
          <Row label="Submitted" value={<Num>{fmtDate(c.submittedDate)}</Num>} />
          <Row label="Expected effective" value={<Num>{fmtDate(c.expectedEffectiveDate)}</Num>} />
          <Row label="Confirmed effective" value={<Num>{fmtDate(c.confirmedEffectiveDate)}</Num>} />
          <Row label="Contract executed" value={<Num>{fmtDate(c.contractExecutedDate)}</Num>} />
          <Row label="Days open" value={<Num>{daysOpen !== null ? `${daysOpen}d` : "—"}</Num>} />
          <Separator className="my-2" />
          <Row label="Coordinator" value={coordinatorName} />
          <Row label="Group" value={c.group?.name ?? "—"} />
          <Row
            label="Facility"
            value={
              c.facility ? (
                <span className="block">
                  {c.facility.name}
                  {facilityAddress ? (
                    <span className="mt-0.5 block text-[11.5px] font-normal text-muted-foreground">
                      {facilityAddress}
                    </span>
                  ) : null}
                </span>
              ) : (
                "—"
              )
            }
          />
          {c.caseEmailToken ? <IdRow label="Forwarding ID" value={c.caseEmailToken} /> : null}
        </dl>

        <Separator className="my-4" />
        <p className={GROUP_LABEL}>Identifiers</p>
        <dl className="mt-2 space-y-3 text-[13px]">
          <IdRow label="Provider NPI" value={c.provider?.npi ?? null} />
          <IdRow label="CAQH ID" value={c.provider?.caqhId ?? null} />
          <IdRow label="Taxonomy" value={c.provider?.taxonomyCode ?? null} />
          <IdRow label="Group NPI" value={c.group?.npiType2 ?? null} />
          <IdRow label="Group TIN" value={c.group?.tin ?? null} />
          {approved ? (
            <>
              <Separator className="my-2" />
              {/* The payer's own wording for each ID; an expected-but-acked
                  ID reads Awaiting ID until it is back-filled. */}
              {providerIdBadge?.kind === "value" ? (
                <IdRow label={providerIdBadge.label} value={providerIdBadge.value} />
              ) : providerIdBadge?.kind === "awaiting" ? (
                <PendingRow label={providerIdBadge.label} pill="Awaiting ID" tone="amber" />
              ) : null}
              {groupIdValue ? (
                <IdRow label={groupConfig.groupLabel} value={groupIdValue} />
              ) : groupConfig.expected ? (
                <PendingRow label={groupConfig.groupLabel} pill="Awaiting ID" tone="amber" />
              ) : null}
            </>
          ) : (
            <p className="text-[12px] text-muted-foreground">
              Payer-issued IDs appear here after approval.
            </p>
          )}
        </dl>

        <Separator className="my-4" />
        <p className={GROUP_LABEL}>Provenance</p>
        <div className="mt-2">
          <CaseProvenancePanel c={c} tasks={tasks} />
        </div>
      </CardContent>
    </Card>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="tabular-nums">{children}</span>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function IdRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-2">
        <span className="font-medium tabular-nums">{value ?? "—"}</span>
        {value ? <CopyButton value={value} label={label} /> : null}
      </dd>
    </div>
  );
}

function PendingRow({
  label,
  pill,
  tone,
}: {
  label: string;
  pill: string;
  tone: "amber" | "neutral";
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <StatusPill status={tone} label={pill} />
      </dd>
    </div>
  );
}
