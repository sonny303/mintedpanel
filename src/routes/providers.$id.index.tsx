// The provider record — a TABBED one-page record (2026-07-21 provider-detail
// redesign, handoff issue 8: one section at a time so no sticky nav overlaps
// content). Tabs: Provider Info · Groups & facilities · Licenses · Enrollments
// · Cases (which also hosts the provider-scoped Readiness matrix, user ask) ·
// Documents · Internal Notes. The active tab is DERIVED from the URL hash, so
// the roster's gap-pill deep-links (#identity / #groups-facilities / #licenses)
// and the readiness fix-here anchors still activate the right tab.
//
// Provider Info is ONE master edit (whole form → one diff-only audited
// updateProvider patch; assignments stay untouchable by construction), laid
// out in three labeled sub-groups (Personal / Credentials & identifiers /
// Education & employment). Home address + malpractice were moved off this form
// (handoff: collected at creation / managed at the group level). Licenses
// follow the standard "+ Add license" pattern with per-row Edit/Remove; each
// write composes the full list into the audited updateProviderWithLicenses
// sync with an EMPTY provider patch.
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { format } from "date-fns";
import { Building2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StateSelect } from "@/components/StateSelect";
import { StatusPill } from "@/components/StatusPill";
import { CaseStatusPill } from "@/components/cases/CaseStatusPill";
import { isOpenCaseStatus } from "@/lib/caseStatus";
import { CaseNotesPanel } from "@/components/cases/CaseNotesPanel";
import { DocumentsPanel } from "@/components/documents/DocumentsPanel";
import { SsnVaultField } from "@/components/providers/SsnVaultField";
import { GroupsFacilitiesPanel } from "@/components/providers/GroupsFacilitiesPanel";
import { EnrollmentsPanel } from "@/components/providers/EnrollmentsPanel";
import { ProviderReadinessSection } from "@/components/providers/ProviderReadinessSection";
import { AddButton, RecordSectionCard } from "@/components/providers/RecordSectionCard";
import { EMPTY_LICENSE_DRAFT, type LicenseDraft } from "@/components/onboarding/licenseDraft";
import {
  useProvider,
  useProviderAssignments,
  useTerminateProvider,
  useUpdateProvider,
  useUpdateProviderWithLicenses,
} from "@/hooks/useProviders";
import {
  useCreateNote,
  useFacilities,
  useNotes,
  useStateLicensesByProvider,
} from "@/hooks/useLookups";
import type { StateLicense } from "@/services/lookups";
import { useCases, useCaseDenialEntries, useDenialReasonCodes } from "@/hooks/useCases";
import { useEnrollmentReadiness } from "@/hooks/useEnrollmentReadiness";
import { AddTouchDialog, type TouchCaseCandidate } from "@/components/cases/AddTouchDialog";
import { usePayers } from "@/hooks/useAdmin";
import { useCanWrite } from "@/lib/permissions";
import { isValidEmail } from "@/lib/contactValidation";
import { isValidNpi } from "@/lib/providerGroup";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LicenseInput, ProviderInput } from "@/services/providers";
import type { Provider } from "@/types";

export const Route = createFileRoute("/providers/$id/")({
  component: ProviderRecordPage,
});

// Tab bar. Readiness is NOT a tab of its own — it lives inside the Cases tab
// (user ask 2026-07-21), so #readiness maps to the Cases tab too.
const TABS = [
  { id: "identity", label: "Provider Info" },
  { id: "groups-facilities", label: "Groups & facilities" },
  { id: "licenses", label: "Licenses" },
  { id: "enrollments", label: "Enrollments" },
  { id: "cases", label: "Cases" },
  { id: "documents", label: "Documents" },
  { id: "notes", label: "Internal Notes" },
] as const;

const HASH_TO_TAB: Record<string, string> = {
  identity: "identity",
  "groups-facilities": "groups-facilities",
  licenses: "licenses",
  enrollments: "enrollments",
  readiness: "cases",
  cases: "cases",
  documents: "documents",
  notes: "notes",
};

function tabFromHash(hash: string | undefined): string | null {
  const h = (hash ?? "").replace(/^#/, "");
  return HASH_TO_TAB[h] ?? null;
}

function ProviderRecordPage() {
  const { id } = Route.useParams();
  const providerQ = useProvider(id);
  const canWrite = useCanWrite();
  const location = useLocation();
  const navigate = useNavigate();
  // Warm the Cases-tab caches on landing. Radix unmounts inactive tab
  // content, so without this the readiness/generation inputs only start
  // fetching when the user clicks Cases — and a stale 5-minute facts
  // cache then looks like "no group / payer" until refresh.
  useEnrollmentReadiness();

  const [activeTab, setActiveTab] = useState<string>(
    () => tabFromHash(location.hash) ?? "identity",
  );

  // Deep-links through the TanStack router (roster gap pills carry a #hash).
  useEffect(() => {
    const t = tabFromHash(location.hash);
    if (t) setActiveTab(t);
  }, [location.hash]);

  // Native hash changes — the Readiness fix-here anchors use <a href="#x">,
  // which the router does not observe. Keep the active tab in sync so those
  // "Fix in Licenses / Identity / Groups & facilities" links switch the tab.
  useEffect(() => {
    const onHash = () => {
      const t = tabFromHash(window.location.hash);
      if (t) setActiveTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const onTabChange = (v: string) => {
    setActiveTab(v);
    // Reflect the tab in the URL (replace — tabs are not history entries) so
    // deep-links stay consistent and a shared URL reopens the same tab.
    navigate({ to: "/providers/$id", params: { id }, hash: v, replace: true });
  };

  if (providerQ.isLoading) {
    return <div className="h-40 animate-pulse rounded-md bg-mp-muted" />;
  }
  const provider = providerQ.data;
  if (!provider) {
    return <p className="text-[13px] text-muted-foreground">Provider not found.</p>;
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <RecordHeader provider={provider} canWrite={canWrite} />

        <TabsPrimitive.Root value={activeTab} onValueChange={onTabChange} className="space-y-4">
          <TabsPrimitive.List
            aria-label="Provider sections"
            className="flex flex-wrap items-center gap-1 border-b border-[#E8E5E0]"
          >
            {TABS.map((t) => (
              <TabsPrimitive.Trigger
                key={t.id}
                value={t.id}
                className="-mb-px cursor-pointer whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-[#6B7280] outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-[rgba(27,77,62,.35)] data-[state=active]:border-[#1B4D3E] data-[state=active]:text-[#1B4D3E]"
              >
                {t.label}
              </TabsPrimitive.Trigger>
            ))}
          </TabsPrimitive.List>

          <TabsPrimitive.Content value="identity" className="outline-none">
            <IdentitySection provider={provider} canWrite={canWrite} />
          </TabsPrimitive.Content>

          <TabsPrimitive.Content value="groups-facilities" className="outline-none">
            <GroupsFacilitiesPanel providerId={provider.id} canWrite={canWrite} />
          </TabsPrimitive.Content>

          <TabsPrimitive.Content value="licenses" className="outline-none">
            <LicensesSection provider={provider} canWrite={canWrite} />
          </TabsPrimitive.Content>

          <TabsPrimitive.Content value="enrollments" className="outline-none">
            <EnrollmentsPanel providerId={provider.id} canWrite={canWrite} />
          </TabsPrimitive.Content>

          <TabsPrimitive.Content value="cases" className="outline-none">
            <div className="space-y-4">
              <CasesSection providerId={provider.id} />
              {/* Readiness lives on the Cases tab (user ask): the pre-flight
                  matrix right beside the casework it precedes. */}
              <RecordSectionCard id="readiness" title="Readiness">
                <ProviderReadinessSection providerId={provider.id} />
              </RecordSectionCard>
            </div>
          </TabsPrimitive.Content>

          <TabsPrimitive.Content value="documents" className="outline-none">
            <DocumentsPanel
              ownerType="provider"
              ownerId={provider.id}
              ownerName={`${provider.firstName} ${provider.lastName}`}
            />
          </TabsPrimitive.Content>

          <TabsPrimitive.Content value="notes" className="outline-none">
            <ProviderNotes providerId={provider.id} canEdit={canWrite} />
          </TabsPrimitive.Content>
        </TabsPrimitive.Root>
      </div>
    </TooltipProvider>
  );
}

function RecordHeader({ provider, canWrite }: { provider: Provider; canWrite: boolean }) {
  const [terminating, setTerminating] = useState(false);
  const assignQ = useProviderAssignments();
  const facilitiesQ = useFacilities();

  // The facility line replaces the old status badge + progress meter (handoff:
  // both removed as noise). Show the provider's primary facility (or the first
  // assignment) with its address.
  const facility = useMemo(() => {
    const mine = (assignQ.data ?? []).filter((a) => a.providerId === provider.id);
    const primary = mine.find((a) => a.isPrimary) ?? mine[0];
    if (!primary) return null;
    return (facilitiesQ.data ?? []).find((f) => f.id === primary.facilityId) ?? null;
  }, [assignQ.data, facilitiesQ.data, provider.id]);

  const facilityAddress = facility
    ? [facility.street, facility.city, [facility.state, facility.zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";

  // Edge states only — the routine Active/Onboarding badge is gone, but
  // Terminated / Pending verification / Reference are operationally meaningful
  // and must stay visible.
  const hasEdgePill =
    provider.status === "terminated" ||
    provider.verificationState === "pending_verification" ||
    provider.referenceOnly;

  return (
    <div className="rounded-md border border-[#E8E5E0] bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-foreground">
            {provider.firstName} {provider.lastName}
            {provider.credentials ? (
              <span className="font-medium text-muted-foreground">, {provider.credentials}</span>
            ) : null}
          </h1>

          {hasEdgePill ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {provider.status === "terminated" ? (
                <StatusPill status="neutral" label="Terminated" />
              ) : null}
              {provider.verificationState === "pending_verification" ? (
                <StatusPill status="amber" label="Pending verification" />
              ) : null}
              {provider.referenceOnly ? <StatusPill status="neutral" label="Reference" /> : null}
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <Building2 className="h-[15px] w-[15px] flex-none text-[#9CA3AF]" aria-hidden />
            {facility ? (
              <>
                <span className="font-medium text-foreground">{facility.name}</span>
                {facilityAddress ? (
                  <>
                    <span className="text-[#C9C5BE]" aria-hidden>
                      ·
                    </span>
                    <span>{facilityAddress}</span>
                  </>
                ) : null}
              </>
            ) : (
              <span>No facility assigned</span>
            )}
          </div>

          <p className="mt-2 text-[13px] text-muted-foreground">
            NPI <span className="font-mono text-foreground">{provider.npi ?? "—"}</span>
            <span className="mx-1.5 text-[#C9C5BE]">·</span>
            CAQH <span className="font-mono text-foreground">{provider.caqhId ?? "—"}</span>
            <span className="mx-1.5 text-[#C9C5BE]">·</span>
            Taxonomy{" "}
            <span className="font-mono text-foreground">{provider.taxonomyCode ?? "—"}</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {provider.status !== "terminated" ? (
            <Button asChild variant="outline" size="sm" className="h-[34px]">
              <Link to="/generation" search={{ provider: provider.id }}>
                Generate cases
              </Link>
            </Button>
          ) : null}
          {canWrite && provider.status !== "terminated" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-[34px] text-[#DC2626] hover:bg-[#FBEAEA]"
              onClick={() => setTerminating(true)}
            >
              Terminate provider
            </Button>
          ) : null}
        </div>
      </div>
      {terminating ? (
        <TerminateProviderDialog
          open={terminating}
          onOpenChange={setTerminating}
          provider={provider}
        />
      ) : null}
    </div>
  );
}

// ---------- Provider Info: ONE master edit, three labeled sub-groups ----------

interface FieldDef {
  label: string;
  key: keyof ProviderInput & string;
  value: string | null;
  type?: "text" | "date";
  validate?: (value: string) => string | null;
  masked?: boolean;
  mono?: boolean;
  display?: (value: string | null) => string;
}
type Cell = FieldDef | { ssn: true };

const CELL_LABEL = "text-[12px] font-semibold uppercase tracking-[0.05em] text-[#6B7280]";

function IdentitySection({ provider, canWrite }: { provider: Provider; canWrite: boolean }) {
  const update = useUpdateProvider(provider.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const dateDisplay = (v: string | null) => (v ? fmtDate(v) : "—");
  const groups: { title: string; cells: Cell[] }[] = [
    {
      title: "Personal",
      cells: [
        { label: "First name", key: "firstName", value: provider.firstName },
        { label: "Last name", key: "lastName", value: provider.lastName },
        {
          label: "Date of birth",
          key: "dateOfBirth",
          value: provider.dateOfBirth ?? null,
          type: "date",
          masked: true,
        },
        { ssn: true },
        {
          label: "Email",
          key: "email",
          value: provider.email ?? null,
          validate: (v) => (isValidEmail(v) ? null : "Enter a valid email address."),
        },
        { label: "Phone", key: "phone", value: provider.phone ?? null, mono: true },
      ],
    },
    {
      title: "Credentials & identifiers",
      cells: [
        { label: "Credentials", key: "credentials", value: provider.credentials ?? null },
        {
          label: "NPI",
          key: "npi",
          value: provider.npi ?? null,
          mono: true,
          validate: (v) => (isValidNpi(v) ? null : "NPI is 10 digits."),
        },
        { label: "CAQH ID", key: "caqhId", value: provider.caqhId ?? null, mono: true },
        { label: "Specialty", key: "specialty", value: provider.specialty ?? null },
        {
          label: "Taxonomy code",
          key: "taxonomyCode",
          value: provider.taxonomyCode ?? null,
          mono: true,
        },
        {
          label: "CAQH last attested",
          key: "caqhLastAttestedDate",
          value: provider.caqhLastAttestedDate ?? null,
          type: "date",
          display: dateDisplay,
        },
      ],
    },
    {
      title: "Education & employment",
      cells: [
        { label: "Degree", key: "degree", value: provider.degree ?? null },
        { label: "School", key: "schoolName", value: provider.schoolName ?? null },
        {
          label: "Graduation date",
          key: "graduationDate",
          value: provider.graduationDate ?? null,
          type: "date",
          display: dateDisplay,
        },
        {
          label: "Start date",
          key: "startDate",
          value: provider.startDate ?? null,
          type: "date",
          display: dateDisplay,
        },
      ],
    },
  ];
  const fields = groups.flatMap((g) => g.cells).filter((c): c is FieldDef => !("ssn" in c));

  const startEdit = () => {
    setDraft(Object.fromEntries(fields.map((f) => [f.key, f.value ?? ""])));
    setFieldErrors({});
    setSaveError(null);
    setEditing(true);
  };

  const save = async () => {
    const errors: Record<string, string> = {};
    for (const f of fields) {
      const v = (draft[f.key] ?? "").trim();
      // Validate only fields the user actually changed — a legacy invalid
      // value in an untouched field must not block an unrelated edit.
      const changed = (v === "" ? null : v) !== (f.value ?? null);
      if (changed && v !== "" && f.validate) {
        const message = f.validate(v);
        if (message) errors[f.key] = message;
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    // Diff-only patch: untouched fields never ride the write, so one save is
    // still one narrow audited UPDATE — and assignments stay untouchable from
    // here (the E6.4 wipe-defect protection holds by construction).
    const patch: Partial<ProviderInput> = {};
    for (const f of fields) {
      const trimmed = (draft[f.key] ?? "").trim();
      const next = trimmed === "" ? null : trimmed;
      if (next !== (f.value ?? null)) (patch as Record<string, string | null>)[f.key] = next;
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    try {
      await update.mutateAsync(patch);
      toast.success("Saved.");
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save.");
    }
  };

  const action = canWrite ? (
    editing ? (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-[34px]"
          disabled={update.isPending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-[34px] bg-[#1B4D3E] hover:bg-[#163F33]"
          disabled={update.isPending}
          onClick={() => void save()}
        >
          Save changes
        </Button>
      </div>
    ) : (
      <Button variant="outline" size="sm" className="h-[34px] gap-1.5" onClick={startEdit}>
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        Edit details
      </Button>
    )
  ) : undefined;

  return (
    <RecordSectionCard id="identity" title="Provider Info" action={action}>
      <div>
        {groups.map((g, i) => (
          <div key={g.title} className={i > 0 ? "mt-6 border-t border-[#F0EEEA] pt-6" : ""}>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9CA3AF]">
              {g.title}
            </div>
            <div
              className={cn(
                "grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3",
                editing ? "gap-y-3" : "gap-y-1",
              )}
            >
              {g.cells.map((c) => {
                if ("ssn" in c) {
                  return (
                    <div key="ssn" className={editing ? "space-y-1" : "py-1.5"}>
                      <p className={CELL_LABEL}>SSN</p>
                      <SsnVaultField provider={provider} />
                    </div>
                  );
                }
                if (!editing) {
                  return (
                    <div key={c.key} className="py-1.5">
                      <p className={CELL_LABEL}>{c.label}</p>
                      <p
                        className={cn(
                          "truncate text-[14px] text-foreground",
                          c.mono && "font-mono",
                        )}
                      >
                        {c.masked
                          ? c.value
                            ? "••••••••"
                            : "—"
                          : c.display
                            ? c.display(c.value)
                            : (c.value ?? "—")}
                      </p>
                    </div>
                  );
                }
                return (
                  <div key={c.key} className="space-y-1">
                    <Label htmlFor={`identity-${c.key}`} className={CELL_LABEL}>
                      {c.label}
                    </Label>
                    <Input
                      id={`identity-${c.key}`}
                      type={c.type === "date" ? "date" : "text"}
                      value={draft[c.key] ?? ""}
                      onChange={(e) => {
                        setDraft((d) => ({ ...d, [c.key]: e.target.value }));
                        setFieldErrors((prev) => ({ ...prev, [c.key]: "" }));
                      }}
                      className={cn("h-8 text-[13px]", c.mono && "font-mono")}
                    />
                    {fieldErrors[c.key] ? (
                      <p role="alert" className="text-[12px] text-[#B91C1C]">
                        {fieldErrors[c.key]}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {editing && saveError ? (
          <p role="alert" className="mt-3 text-[12px] text-[#B91C1C]">
            {saveError}
          </p>
        ) : null}
      </div>
    </RecordSectionCard>
  );
}

// ---------- Licenses: standard "+ Add" pattern, per-row Edit / Remove ----------
// Every write composes the FULL license list (unchanged rows pass through
// verbatim) into the ONE audited updateProviderWithLicenses sync with an
// EMPTY provider patch — identity fields and assignments are untouchable
// from here, and the PSV rules (verify/fail stamps server-side; the board
// URL is optional; renewal resets to Unverified) ride the same service path
// as before.

const licenseToInput = (l: StateLicense): LicenseInput => ({
  id: l.id,
  state: l.state,
  licenseNumber: l.licenseNumber,
  licenseType: l.licenseType,
  issueDate: l.issueDate,
  expirationDate: l.expirationDate,
  verifiedStatus: l.verifiedStatus ?? "unverified",
  verificationSourceUrl: l.verificationSourceUrl,
});

function LicensesSection({ provider, canWrite }: { provider: Provider; canWrite: boolean }) {
  const licensesQ = useStateLicensesByProvider(provider.id);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<StateLicense | null>(null);
  const [removing, setRemoving] = useState<StateLicense | null>(null);

  const rows = licensesQ.data ?? [];
  return (
    <>
      <RecordSectionCard
        id="licenses"
        title="Licenses"
        action={
          canWrite ? <AddButton label="Add license" onClick={() => setAdding(true)} /> : undefined
        }
      >
        {rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No state licenses recorded.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-[#F0EEE9] text-[12px] text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">State</th>
                <th className="py-1.5 pr-3 font-medium">Number</th>
                <th className="py-1.5 pr-3 font-medium">Type</th>
                <th className="py-1.5 pr-3 font-medium">Expires</th>
                <th className="py-1.5 font-medium">PSV</th>
                {canWrite ? (
                  <th className="py-1.5 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-[#F0EEE9] last:border-0">
                  <td className="py-1.5 pr-3 font-medium">{l.state}</td>
                  <td className="py-1.5 pr-3 font-mono text-[#9CA3AF]">{l.licenseNumber ?? "—"}</td>
                  <td className="py-1.5 pr-3">{l.licenseType ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    {l.expirationDate ? fmtDate(l.expirationDate) : "—"}
                  </td>
                  <td className="py-1.5">
                    {l.verifiedStatus === "verified" ? (
                      <StatusPill status="green" label="Verified" />
                    ) : l.verifiedStatus === "failed" ? (
                      <StatusPill status="red" label="Failed" />
                    ) : (
                      <StatusPill status="neutral" label="Unverified" />
                    )}
                  </td>
                  {canWrite ? (
                    <td className="py-1.5 text-right">
                      <span className="flex items-center justify-end gap-3">
                        <button
                          type="button"
                          className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          aria-label={`Edit ${l.state} license`}
                          onClick={() => setEditing(l)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                          aria-label={`Remove ${l.state} license`}
                          onClick={() => setRemoving(l)}
                        >
                          Remove
                        </button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RecordSectionCard>
      {adding ? (
        <LicenseDialog
          provider={provider}
          licenses={rows}
          license={null}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing ? (
        <LicenseDialog
          provider={provider}
          licenses={rows}
          license={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {removing ? (
        <RemoveLicenseDialog
          provider={provider}
          licenses={rows}
          license={removing}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}

function LicenseDialog({
  provider,
  licenses,
  license,
  onClose,
}: {
  provider: Provider;
  licenses: StateLicense[];
  /** null = add a new license; set = edit this one. */
  license: StateLicense | null;
  onClose: () => void;
}) {
  const update = useUpdateProviderWithLicenses(provider.id);
  const [draft, setDraft] = useState<LicenseDraft>(() =>
    license
      ? {
          id: license.id,
          state: license.state,
          licenseNumber: license.licenseNumber ?? "",
          licenseType: license.licenseType || "full",
          issueDate: license.issueDate ?? "",
          expirationDate: license.expirationDate ?? "",
          verifiedStatus: license.verifiedStatus ?? "unverified",
          verificationSourceUrl: license.verificationSourceUrl ?? "",
          storedExpirationDate: license.expirationDate,
          storedVerifiedAt: license.verifiedAt,
        }
      : { ...EMPTY_LICENSE_DRAFT },
  );
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<LicenseDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };

  const willReset =
    license !== null &&
    draft.expirationDate !== (draft.storedExpirationDate ?? "") &&
    draft.verifiedStatus !== "unverified";

  const save = () => {
    if (!draft.state.trim()) {
      setError("State is required.");
      return;
    }
    const edited: LicenseInput = {
      id: license?.id ?? null,
      state: draft.state,
      licenseNumber: draft.licenseNumber.trim() || null,
      licenseType: draft.licenseType.trim() || null,
      issueDate: draft.issueDate.trim() || null,
      expirationDate: draft.expirationDate.trim() || null,
      verifiedStatus: draft.verifiedStatus,
      verificationSourceUrl: draft.verificationSourceUrl.trim() || null,
    };
    const next = license
      ? licenses.map((l) => (l.id === license.id ? edited : licenseToInput(l)))
      : [...licenses.map(licenseToInput), edited];
    update.mutate(
      { patch: {}, licenses: next },
      {
        onSuccess: () => {
          toast.success(license ? "License saved." : "License added.");
          onClose();
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Could not save the license."),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{license ? "Edit license" : "Add license"}</DialogTitle>
          <DialogDescription>
            Licenses save on their own — nothing else on the record is touched. Editing an
            expiration date resets that license to Unverified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="license-state" className="text-[12px]">
                State
              </Label>
              <StateSelect
                id="license-state"
                value={draft.state}
                onChange={(s) => set({ state: s })}
                allowNone={false}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="license-number" className="text-[12px]">
                License number
              </Label>
              <Input
                id="license-number"
                value={draft.licenseNumber}
                onChange={(e) => set({ licenseNumber: e.target.value })}
                className="h-9 font-mono"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="license-type" className="text-[12px]">
                Type
              </Label>
              <Select
                value={draft.licenseType || "full"}
                onValueChange={(t) => set({ licenseType: t })}
              >
                <SelectTrigger id="license-type" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="license-issued" className="text-[12px]">
                Issued
              </Label>
              <Input
                id="license-issued"
                type="date"
                value={draft.issueDate}
                onChange={(e) => set({ issueDate: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="license-expires" className="text-[12px]">
                Expires
              </Label>
              <Input
                id="license-expires"
                type="date"
                value={draft.expirationDate}
                onChange={(e) => set({ expirationDate: e.target.value })}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="license-psv" className="text-[12px]">
                Verification
              </Label>
              <Select
                value={draft.verifiedStatus}
                onValueChange={(v) => set({ verifiedStatus: v as LicenseDraft["verifiedStatus"] })}
              >
                <SelectTrigger id="license-psv" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unverified">Unverified</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="license-url" className="text-[12px]">
              State-board lookup URL (optional)
            </Label>
            <Input
              id="license-url"
              value={draft.verificationSourceUrl}
              onChange={(e) => set({ verificationSourceUrl: e.target.value })}
              className="h-9"
            />
            <p className="text-[11.5px] text-muted-foreground">
              Link to the state board&apos;s verification page if you have one. You can also record
              Verified or Failed from email or another source and add the URL later.
            </p>
          </div>
          {willReset ? (
            <p className="rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">
              The expiration date changed — this license returns to Unverified on save (re-verify
              against the state board after renewal).
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-[12px] text-[#B91C1C]">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#163F33]"
            disabled={update.isPending}
            onClick={save}
          >
            {license ? "Save license" : "Add license"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveLicenseDialog({
  provider,
  licenses,
  license,
  onClose,
}: {
  provider: Provider;
  licenses: StateLicense[];
  license: StateLicense;
  onClose: () => void;
}) {
  const update = useUpdateProviderWithLicenses(provider.id);
  const [error, setError] = useState<string | null>(null);

  const remove = () => {
    update.mutate(
      {
        patch: {},
        licenses: licenses.filter((l) => l.id !== license.id).map(licenseToInput),
      },
      {
        onSuccess: () => {
          toast.success("License removed.");
          onClose();
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Could not remove the license."),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove this license?</DialogTitle>
          <DialogDescription>
            This deletes the {license.state} license
            {license.licenseNumber ? ` (#${license.licenseNumber})` : ""} from the record.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-[12px] text-[#B91C1C]">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            className="bg-[#1B4D3E] hover:bg-[#163F33]"
            disabled={update.isPending}
            onClick={remove}
          >
            Remove license
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Cases: read-only rows + preserved denial history (F6.4.5) ----------

function CasesSection({ providerId }: { providerId: string }) {
  const casesQ = useCases();
  const payersQ = usePayers();
  const denialsQ = useCaseDenialEntries();
  const reasonsQ = useDenialReasonCodes();
  const canWrite = useCanWrite();
  const [touchOpen, setTouchOpen] = useState(false);

  // F6.6.5 — "Add touch" is THE logging action on the record too: the
  // provider's open cases feed the same unified dialog the /cases toolbar
  // uses (one touch per selected case + suggested bumps where implied).
  const touchCandidates: TouchCaseCandidate[] = useMemo(() => {
    const payerName = new Map((payersQ.data ?? []).map((p) => [p.id, p.name]));
    return (casesQ.data ?? [])
      .filter((c) => c.providerId === providerId && isOpenCaseStatus(c.caseStatus))
      .map((c) => ({
        id: c.id,
        label: `${payerName.get(c.payerId) ?? "—"} · ${c.state}`,
        currentStatus: c.caseStatus,
      }));
  }, [casesQ.data, payersQ.data, providerId]);

  const rows = useMemo(() => {
    const payerName = new Map((payersQ.data ?? []).map((p) => [p.id, p.name]));
    const reasonLabel = new Map((reasonsQ.data ?? []).map((r) => [r.id, r.label]));
    const denialsByCase = new Map<string, { label: string; at: string }[]>();
    for (const d of denialsQ.data ?? []) {
      const list = denialsByCase.get(d.caseId) ?? [];
      list.push({
        label: d.reasonCodeId ? (reasonLabel.get(d.reasonCodeId) ?? "Denied") : "Denied",
        at: d.changedAt,
      });
      denialsByCase.set(d.caseId, list);
    }
    return (casesQ.data ?? [])
      .filter((c) => c.providerId === providerId)
      .map((c) => ({
        id: c.id,
        payerName: payerName.get(c.payerId) ?? "—",
        state: c.state,
        status: c.caseStatus,
        submittedDate: c.submittedDate ?? null,
        denials: denialsByCase.get(c.id) ?? [],
      }))
      .sort((a, b) => a.payerName.localeCompare(b.payerName) || a.state.localeCompare(b.state));
  }, [casesQ.data, payersQ.data, denialsQ.data, reasonsQ.data, providerId]);

  const action =
    canWrite && touchCandidates.length > 0 ? (
      <AddButton label="Add touch" onClick={() => setTouchOpen(true)} />
    ) : undefined;

  return (
    <>
      <RecordSectionCard id="cases" title="Cases" action={action}>
        {rows.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            No cases yet. Cases come through Generate cases on the group&apos;s Payer Network board.
          </p>
        ) : (
          <ul className="divide-y divide-[#F0EEE9] rounded-md border border-[#E8E5E0]">
            {rows.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Link
                    to="/cases/$id"
                    params={{ id: r.id }}
                    className="font-medium text-[#1B4D3E] underline-offset-2 hover:underline"
                  >
                    {r.payerName} — {r.state}
                  </Link>
                  <CaseStatusPill status={r.status} />
                  {r.submittedDate ? (
                    <span className="text-muted-foreground">
                      submitted {fmtDate(r.submittedDate)}
                    </span>
                  ) : null}
                </div>
                {/* The prior denial stays visible beneath the current cycle —
                  reapply continues the SAME case (E6.0), history is preserved. */}
                {r.denials.length > 0 && r.status !== "denied" ? (
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    Previously denied — {r.denials[0].label}, {fmtDate(r.denials[0].at)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </RecordSectionCard>
      {touchOpen ? (
        <AddTouchDialog
          open={touchOpen}
          candidates={touchCandidates}
          onClose={() => setTouchOpen(false)}
        />
      ) : null}
    </>
  );
}

// ---------- Notes + terminate (carried over) ----------

function ProviderNotes({ providerId, canEdit }: { providerId: string; canEdit: boolean }) {
  const notesQ = useNotes("provider", providerId);
  const createNoteM = useCreateNote();
  return (
    <CaseNotesPanel
      notes={notesQ.data ?? []}
      canEdit={canEdit}
      saving={createNoteM.isPending}
      onSaveNote={async (content) => {
        try {
          await createNoteM.mutateAsync({ entityType: "provider", entityId: providerId, content });
          toast.success("Note added");
        } catch (e) {
          toast.error((e as Error).message);
        }
      }}
    />
  );
}

interface TerminateProviderDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  provider: Provider;
}

function TerminateProviderDialog({ open, onOpenChange, provider }: TerminateProviderDialogProps) {
  const today = format(new Date(), "yyyy-MM-dd");
  const [terminationDate, setTerminationDate] = useState<string>(today);
  const [reason, setReason] = useState<string>("");
  const terminateM = useTerminateProvider(provider.id);
  const canSubmit = Boolean(terminationDate) && !terminateM.isPending;

  async function handleConfirm(): Promise<void> {
    try {
      const result = await terminateM.mutateAsync({
        terminationDate,
        reason: reason.trim() ? reason.trim() : null,
      });
      toast.success(
        result.tasksCreated > 0
          ? `Provider terminated. ${result.tasksCreated} termination task${result.tasksCreated === 1 ? "" : "s"} created.`
          : "Provider terminated.",
      );
      onOpenChange(false);
      setReason("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setTerminationDate(today);
          setReason("");
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Terminate provider</DialogTitle>
          <DialogDescription>
            This sets the provider to Terminated and creates a termination task for every active
            case. It does not delete anything.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Termination date
            </Label>
            <Input
              type="date"
              value={terminationDate}
              onChange={(e) => setTerminationDate(e.target.value)}
              className="h-9 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Reason
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional context for the termination"
              className="min-h-[80px] resize-none text-[13px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={terminateM.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canSubmit}>
            {terminateM.isPending ? "Terminating…" : "Terminate provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
