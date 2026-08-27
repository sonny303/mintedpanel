// Slice E (payer-and-cases screen 6) — the case's right-column Details card:
// ONE card, three labeled groups.
//   Case         — the dates the case carries, days open, coordinator, group,
//                  the case's Locations (E1.3, Track B: every case_facilities
//                  row, primary badged, editable for writers — provider×group
//                  assignment scoped), forwarding ID.
//   Identifiers  — provider/group identifiers, each copyable, plus the
//                  payer-issued IDs an approval captured. A payer that expects
//                  an ID whose approval acked it missing reads "Awaiting ID"
//                  (Slice D's derivation, reused verbatim — never re-derived).
//   Provenance   — the E2.4 origin + SOP version lines + reapply cycles
//                  (CaseProvenancePanel composed, never re-implemented).
import { differenceInDays, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "@/components/CopyButton";
import { StatusPill } from "@/components/StatusPill";
import { CaseDateField } from "@/components/cases/CaseDateField";
import { CaseLocationsSection } from "@/components/cases/CaseLocationsSection";
import { CaseProvenancePanel } from "@/components/generation/CaseProvenancePanel";
import { enrollmentIdBadge } from "@/lib/payerIssuedIds";
import { resolveGroupIdentifierConfig } from "@/lib/payerResolutionIdentifier";
import type { CaseDetail, CaseFacilityWithDetail, Facility, Task } from "@/types";
import type { SetCaseDatesInput } from "@/services/cases";

const GROUP_LABEL = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

export function CaseDetailsPanel({
  c,
  tasks,
  coordinatorName,
  locations = [],
  locationsLoading = false,
  facilityOptions = [],
  canEditLocations = false,
  savingLocations = false,
  onAddLocation,
  onRemoveLocation,
  onMakePrimaryLocation,
  canEditDates = false,
  savingDates = false,
  onSaveDates,
}: {
  c: CaseDetail;
  tasks: Task[];
  coordinatorName: string;
  /** The case's full location set (case_facilities, joined to facilities). */
  locations?: CaseFacilityWithDetail[];
  locationsLoading?: boolean;
  /** Provider×group facilities eligible to be added (already-attached ones
   * are filtered out by CaseLocationsSection itself). */
  facilityOptions?: Facility[];
  canEditLocations?: boolean;
  /** True while any of add/remove/make-primary is in flight. */
  savingLocations?: boolean;
  onAddLocation?: (facilityId: string) => Promise<void>;
  onRemoveLocation?: (facilityId: string) => Promise<void>;
  onMakePrimaryLocation?: (facilityId: string) => Promise<void>;
  /** Expected/Confirmed effective + Contract executed — direct corrections,
   * independent of the status machine (setCaseDates). */
  canEditDates?: boolean;
  savingDates?: boolean;
  onSaveDates?: (input: SetCaseDatesInput) => Promise<void>;
}) {
  const daysOpen = c.submittedDate ? differenceInDays(new Date(), parseISO(c.submittedDate)) : null;
  const approved = c.caseStatus === "approved";
  // The provider-side badge is Slice D's shared derivation; the group side
  // mirrors it against the payer's own group-ID expectation.
  const providerIdBadge = approved ? enrollmentIdBadge(c.payer, c.payerIndividualProviderId) : null;
  const groupConfig = resolveGroupIdentifierConfig(c.payer);
  const groupIdValue = (c.payerGroupProviderId ?? "").trim();
  // A payer may expect neither ID. Both rows below are independently
  // conditional, so their divider has to be too — otherwise an approved case
  // on such a payer renders a separator with nothing under it.
  const showsProviderIdRow =
    providerIdBadge?.kind === "value" || providerIdBadge?.kind === "awaiting";
  const showsGroupIdRow = Boolean(groupIdValue) || groupConfig.expected;
  const showsIssuedIdRows = showsProviderIdRow || showsGroupIdRow;

  return (
    <Card role="region" aria-label="Details" className="shadow-none border-border">
      <CardHeader className="p-4 pb-2 border-b border-border">
        <CardTitle className="text-[14px] font-semibold">Details</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <p className={GROUP_LABEL}>Case</p>
        <dl className="mt-2 space-y-3 text-[13px]">
          <CaseDateField
            label="Submitted"
            value={c.submittedDate ?? null}
            canEdit={Boolean(canEditDates && onSaveDates)}
            saving={savingDates}
            onSave={(next) => (onSaveDates ?? (async () => undefined))({ submittedDate: next })}
          />
          <CaseDateField
            label="Expected effective"
            value={c.expectedEffectiveDate ?? null}
            canEdit={Boolean(canEditDates && onSaveDates)}
            saving={savingDates}
            onSave={(next) =>
              (onSaveDates ?? (async () => undefined))({ expectedEffectiveDate: next })
            }
          />
          <CaseDateField
            label="Confirmed effective"
            value={c.confirmedEffectiveDate ?? null}
            canEdit={Boolean(canEditDates && onSaveDates)}
            saving={savingDates}
            onSave={(next) =>
              (onSaveDates ?? (async () => undefined))({ confirmedEffectiveDate: next })
            }
          />
          <CaseDateField
            label="Contract executed"
            value={c.contractExecutedDate ?? null}
            canEdit={Boolean(canEditDates && onSaveDates)}
            saving={savingDates}
            onSave={(next) =>
              (onSaveDates ?? (async () => undefined))({ contractExecutedDate: next })
            }
          />
          <Row label="Days open" value={<Num>{daysOpen !== null ? `${daysOpen}d` : "—"}</Num>} />
          <Separator className="my-2" />
          <Row label="Coordinator" value={coordinatorName} />
          <Row label="Group" value={c.group?.name ?? "—"} />
          <CaseLocationsSection
            locations={locations}
            loading={locationsLoading}
            facilityOptions={facilityOptions}
            canEdit={Boolean(
              canEditLocations && onAddLocation && onRemoveLocation && onMakePrimaryLocation,
            )}
            saving={savingLocations}
            onAdd={onAddLocation ?? (async () => undefined)}
            onRemove={onRemoveLocation ?? (async () => undefined)}
            onMakePrimary={onMakePrimaryLocation ?? (async () => undefined)}
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
              {showsIssuedIdRows ? <Separator className="my-2" /> : null}
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
