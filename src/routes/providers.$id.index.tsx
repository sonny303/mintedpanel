// E6.4 F6.4.2/F6.4.3/F6.4.4/F6.4.5 — the one-page provider record. Section
// jump-nav (Identity · Groups & facilities · Licenses · Enrollments · Cases ·
// Documents, deep-linkable #anchors), in-place group/facility management
// (GroupsFacilitiesPanel — the existing assignment services, never the
// provider UPDATE), enrollment-fact capture (EnrollmentsPanel — facts, never
// auto-cases), and the read-only cases panel with denial history preserved
// beneath reapply cycles. The provider-detail "New case" manual door is
// retired (the /cases ManualCaseModal stays the ONE documented escape hatch,
// F6.3.5).
// 2026-07-21 user handoff: Identity is ONE master Edit — the whole form goes
// editable, one Save commits a DIFF-ONLY audited updateProvider patch (the
// per-field pencil editing was tedious; the assignment-wipe protection holds
// because the patch carries only identity columns, never assignments). The
// Licenses section follows the standard "+ Add license" pattern with per-row
// Edit/Remove — every write composes the full list into the audited
// updateProviderWithLicenses sync with an EMPTY provider patch (the service
// now skips the providers PATCH outright for empty patches; PostgREST 406s
// an empty PATCH under .single(), the 2026-07-21 save-failure root cause).
import React, { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { format } from "date-fns";
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
import { EMPTY_LICENSE_DRAFT, type LicenseDraft } from "@/components/onboarding/licenseDraft";
import {
  useProvider,
  useTerminateProvider,
  useUpdateProvider,
  useUpdateProviderWithLicenses,
} from "@/hooks/useProviders";
import { useCreateNote, useNotes, useStateLicensesByProvider } from "@/hooks/useLookups";
import type { StateLicense } from "@/services/lookups";
import { useCases, useCaseDenialEntries, useDenialReasonCodes } from "@/hooks/useCases";
import { AddTouchDialog, type TouchCaseCandidate } from "@/components/cases/AddTouchDialog";
import { usePayers } from "@/hooks/useAdmin";
import { useCanWrite } from "@/lib/permissions";
import { providerCaseProgress } from "@/lib/caseRollups";
import { isValidEmail } from "@/lib/contactValidation";
import { isValidNpi } from "@/lib/providerGroup";
import { fmtDate } from "@/lib/format";
import type { LicenseInput, ProviderInput } from "@/services/providers";
import type { Provider } from "@/types";

export const Route = createFileRoute("/providers/$id/")({
  component: ProviderRecordPage,
});

const STATUS_TONE: Record<string, "green" | "amber" | "neutral"> = {
  active: "green",
  onboarding: "amber",
  terminated: "neutral",
};

const SECTIONS = [
  { id: "identity", label: "Identity" },
  { id: "groups-facilities", label: "Groups & facilities" },
  { id: "licenses", label: "Licenses" },
  { id: "enrollments", label: "Enrollments" },
  // 2026-07-21 relocation: the wizard's Scope Review lives HERE now — the
  // provider-scoped readiness matrix, right before the casework it precedes.
  { id: "readiness", label: "Readiness" },
  { id: "cases", label: "Cases" },
  { id: "documents", label: "Documents" },
] as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-24 rounded-md border border-[#E8E5E0] bg-white p-4"
    >
      <h2 id={`${id}-heading`} className="mb-3 text-[14px] font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ProviderRecordPage() {
  const { id } = Route.useParams();
  const providerQ = useProvider(id);
  const canWrite = useCanWrite();
  const location = useLocation();

  // Deep-linked sections (#licenses …) scroll + focus their heading — the
  // roster's gap pills land here (F6.4.1).
  useEffect(() => {
    const hash = location.hash?.replace(/^#/, "");
    if (!hash || providerQ.data === undefined) return;
    const el = document.getElementById(hash);
    if (el) {
      el.scrollIntoView({ block: "start" });
      const heading = document.getElementById(`${hash}-heading`);
      heading?.setAttribute("tabindex", "-1");
      heading?.focus?.();
    }
  }, [location.hash, providerQ.data]);

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

        <nav
          aria-label="Record sections"
          className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1 rounded-md border border-[#E8E5E0] bg-white px-2 py-1.5"
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded px-2 py-1 text-[12.5px] text-muted-foreground hover:bg-[#F0EEE9] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgba(27,77,62,.4)]"
            >
              {s.label}
            </a>
          ))}
        </nav>

        <Section id="identity" title="Identity">
          <IdentitySection provider={provider} canWrite={canWrite} />
        </Section>

        <Section id="groups-facilities" title="Groups & facilities">
          <GroupsFacilitiesPanel providerId={provider.id} canWrite={canWrite} />
        </Section>

        <Section id="licenses" title="Licenses">
          <LicensesSection provider={provider} canWrite={canWrite} />
        </Section>

        <Section id="enrollments" title="Enrollments">
          <EnrollmentsPanel providerId={provider.id} canWrite={canWrite} />
        </Section>

        <Section id="readiness" title="Readiness">
          <ProviderReadinessSection providerId={provider.id} />
        </Section>

        <Section id="cases" title="Cases">
          <CasesSection providerId={provider.id} />
        </Section>

        <Section id="documents" title="Documents">
          <DocumentsPanel
            ownerType="provider"
            ownerId={provider.id}
            ownerName={`${provider.firstName} ${provider.lastName}`}
          />
        </Section>

        <ProviderNotes providerId={provider.id} canEdit={canWrite} />
      </div>
    </TooltipProvider>
  );
}

function RecordHeader({ provider, canWrite }: { provider: Provider; canWrite: boolean }) {
  const [terminating, setTerminating] = useState(false);
  const casesQ = useCases();
  const progress = useMemo(() => {
    const map = providerCaseProgress(
      (casesQ.data ?? []).map((c) => ({ providerId: c.providerId, status: c.caseStatus })),
    );
    return map.get(provider.id) ?? null;
  }, [casesQ.data, provider.id]);

  return (
    <div className="rounded-md border border-[#E8E5E0] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-foreground">
            {provider.firstName} {provider.lastName}
            {provider.credentials ? (
              <span className="text-muted-foreground">, {provider.credentials}</span>
            ) : null}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusPill
              status={STATUS_TONE[provider.status ?? "active"] ?? "neutral"}
              label={(provider.status ?? "active").replace(/^./, (c) => c.toUpperCase())}
            />
            {provider.verificationState === "pending_verification" ? (
              <StatusPill status="amber" label="Pending verification" />
            ) : null}
            {provider.referenceOnly ? <StatusPill status="neutral" label="Reference" /> : null}
            {progress ? (
              <span className="text-[12.5px] text-muted-foreground">
                {progress.approved} of {progress.total} approved
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            NPI {provider.npi ?? "—"} · CAQH {provider.caqhId ?? "—"} · Taxonomy{" "}
            {provider.taxonomyCode ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {provider.status !== "terminated" ? (
            <Button asChild variant="outline" size="sm" className="h-8">
              <Link to="/generation" search={{ provider: provider.id }}>
                Generate cases
              </Link>
            </Button>
          ) : null}
          {canWrite && provider.status !== "terminated" ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[#B91C1C]"
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

// ---------- Identity: ONE master edit — whole form, one diff-only save ----------

interface FieldDef {
  label: string;
  key: keyof ProviderInput & string;
  value: string | null;
  type?: "text" | "date" | "state";
  validate?: (value: string) => string | null;
  masked?: boolean;
  display?: (value: string | null) => string;
}

function IdentitySection({ provider, canWrite }: { provider: Provider; canWrite: boolean }) {
  const update = useUpdateProvider(provider.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const dateDisplay = (v: string | null) => (v ? fmtDate(v) : "—");
  const fields: FieldDef[] = [
    { label: "First name", key: "firstName", value: provider.firstName },
    { label: "Last name", key: "lastName", value: provider.lastName },
    { label: "Credentials", key: "credentials", value: provider.credentials ?? null },
    {
      label: "Email",
      key: "email",
      value: provider.email ?? null,
      validate: (v) => (isValidEmail(v) ? null : "Enter a valid email address."),
    },
    { label: "Phone", key: "phone", value: provider.phone ?? null },
    {
      label: "Date of birth",
      key: "dateOfBirth",
      value: provider.dateOfBirth ?? null,
      type: "date",
      masked: true,
    },
    { label: "Home street", key: "homeStreet", value: provider.homeStreet ?? null },
    { label: "Home city", key: "homeCity", value: provider.homeCity ?? null },
    { label: "Home state", key: "homeState", value: provider.homeState ?? null, type: "state" },
    { label: "Home ZIP", key: "homeZip", value: provider.homeZip ?? null },
    {
      label: "NPI",
      key: "npi",
      value: provider.npi ?? null,
      validate: (v) => (isValidNpi(v) ? null : "NPI is 10 digits."),
    },
    { label: "CAQH ID", key: "caqhId", value: provider.caqhId ?? null },
    {
      label: "CAQH last attested",
      key: "caqhLastAttestedDate",
      value: provider.caqhLastAttestedDate ?? null,
      type: "date",
      display: dateDisplay,
    },
    { label: "Taxonomy code", key: "taxonomyCode", value: provider.taxonomyCode ?? null },
    { label: "Specialty", key: "specialty", value: provider.specialty ?? null },
    {
      label: "Start date",
      key: "startDate",
      value: provider.startDate ?? null,
      type: "date",
      display: dateDisplay,
    },
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
      label: "Malpractice carrier",
      key: "malpracticeCarrier",
      value: provider.malpracticeCarrier ?? null,
    },
    {
      label: "Malpractice policy #",
      key: "malpracticePolicyNumber",
      value: provider.malpracticePolicyNumber ?? null,
    },
    {
      label: "Malpractice coverage start",
      key: "malpracticeCoverageStart",
      value: provider.malpracticeCoverageStart ?? null,
      type: "date",
      display: dateDisplay,
    },
    {
      label: "Malpractice coverage end",
      key: "malpracticeCoverageEnd",
      value: provider.malpracticeCoverageEnd ?? null,
      type: "date",
      display: dateDisplay,
    },
  ];

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
    // still one narrow audited UPDATE — and assignments stay untouchable
    // from here (the E6.4 wipe-defect protection holds by construction).
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

  if (!editing) {
    return (
      <div className="space-y-2">
        {canWrite ? (
          <Button variant="outline" size="sm" className="h-7 text-[12px]" onClick={startEdit}>
            Edit details
          </Button>
        ) : null}
        <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <div key={f.key} className="py-1.5">
              <p className="text-[12px] text-muted-foreground">{f.label}</p>
              <p className="truncate text-[13px] text-foreground">
                {f.masked
                  ? f.value
                    ? "••••••••"
                    : "—"
                  : f.display
                    ? f.display(f.value)
                    : (f.value ?? "—")}
              </p>
            </div>
          ))}
          <div className="py-1.5">
            <p className="text-[12px] text-muted-foreground">SSN</p>
            <SsnVaultField provider={provider} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`identity-${f.key}`} className="text-[12px]">
              {f.label}
            </Label>
            {f.type === "state" ? (
              <StateSelect
                id={`identity-${f.key}`}
                value={draft[f.key] ?? ""}
                onChange={(v) => {
                  setDraft((d) => ({ ...d, [f.key]: v }));
                  setFieldErrors((e) => ({ ...e, [f.key]: "" }));
                }}
                className="h-8 text-[13px]"
              />
            ) : (
              <Input
                id={`identity-${f.key}`}
                type={f.type === "date" ? "date" : "text"}
                value={draft[f.key] ?? ""}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, [f.key]: e.target.value }));
                  setFieldErrors((prev) => ({ ...prev, [f.key]: "" }));
                }}
                className="h-8 text-[13px]"
              />
            )}
            {fieldErrors[f.key] ? (
              <p role="alert" className="text-[12px] text-[#B91C1C]">
                {fieldErrors[f.key]}
              </p>
            ) : null}
          </div>
        ))}
        <div className="space-y-1">
          <p className="text-[12px] text-muted-foreground">SSN</p>
          <SsnVaultField provider={provider} />
        </div>
      </div>
      {saveError ? (
        <p role="alert" className="text-[12px] text-[#B91C1C]">
          {saveError}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-8 bg-[#1B4D3E] hover:bg-[#163F33]"
          disabled={update.isPending}
          onClick={() => void save()}
        >
          Save changes
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={update.isPending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------- Licenses: standard "+ Add" pattern, per-row Edit / Remove ----------
// Every write composes the FULL license list (unchanged rows pass through
// verbatim) into the ONE audited updateProviderWithLicenses sync with an
// EMPTY provider patch — identity fields and assignments are untouchable
// from here, and the PSV rules (verify/fail requires the board URL; renewal
// resets to Unverified) ride the same service path as before. The URL is
// OPTIONAL for unverified rows.

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
    <div className="space-y-2">
      {canWrite ? (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[12px]"
          onClick={() => setAdding(true)}
        >
          + Add license
        </Button>
      ) : null}
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
                <td className="py-1.5 pr-3">{l.licenseNumber ?? "—"}</td>
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
    </div>
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
    if (
      (draft.verifiedStatus === "verified" || draft.verifiedStatus === "failed") &&
      !draft.verificationSourceUrl.trim()
    ) {
      setError("PSV verify/fail requires the state board URL.");
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
                className="h-9"
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
              Required only to record Verified or Failed.
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

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No cases yet. Cases come through Generate cases on the group&apos;s Payer Network board.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {canWrite && touchCandidates.length > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setTouchOpen(true)}
          >
            Add touch
          </Button>
        </div>
      ) : null}
      {touchOpen ? (
        <AddTouchDialog
          open={touchOpen}
          candidates={touchCandidates}
          onClose={() => setTouchOpen(false)}
        />
      ) : null}
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
                <span className="text-muted-foreground">submitted {fmtDate(r.submittedDate)}</span>
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
    </div>
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
